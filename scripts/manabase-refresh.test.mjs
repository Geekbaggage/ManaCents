// ManaBase nightly refresh regression tests — the ACTUAL JavaScript
// producer (scripts/manabase-refresh.mjs), not the Python converter.
// Every network/filesystem operation is mocked; every write is
// intercepted. Run: node --test scripts/manabase-refresh.test.mjs
//
// These tests reproduce Charlie's 2026-11-06 negative cases against the
// real refresh path: empty GC response, truncated pagination, missing
// verge dependency, banned-card writes, and validate-before-write.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  runRefresh, fetchGameChangers, buildConditionalColors,
} from "./manabase-refresh.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_SEED = JSON.parse(
  readFileSync(join(HERE, "..", "web", "functions", "api", "_manabase_seed_v042.json"), "utf8")
);

// --- Mock fetch ------------------------------------------------------------
function ok(json) {
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => json,
  };
}

// gcPages: GC search pages returned in order. cardLegalities: name ->
// "legal" | "banned" | "unknown" (default legal).
function mockFetchFactory({ gcPages, cardLegalities = {} } = {}) {
  let gcCalls = 0;
  const fetchFn = async (url) => {
    if (url.includes("is%3Agamechanger")) {
      const page = gcPages[Math.min(gcCalls, gcPages.length - 1)];
      gcCalls++;
      return ok(page);
    }
    const m = url.match(/q=([^&]+)/);
    const name = decodeURIComponent(m[1]);
    const legality = cardLegalities[name] ?? "legal";
    return ok({
      object: "list", total_cards: 1, has_more: false,
      data: [{
        object: "card", id: `id-${name}`, name, set: "trk",
        collector_number: "1", prices: { usd: "1.00" },
        legalities: { commander: legality },
        scryfall_uri: "https://example.test/x",
      }],
    });
  };
  return { fetchFn, getGcCalls: () => gcCalls };
}

function gcCard(name) {
  return { object: "card", id: `gc-${name}`, name };
}

function gcPage(names, { total = names.length, hasMore = false } = {}) {
  return {
    object: "list", total_cards: total, has_more: hasMore,
    next_page: hasMore ? "https://api.scryfall.com/cards/search?q=is%3Agamechanger&page=2" : null,
    data: names.map(gcCard),
  };
}

// --- Mock filesystem -------------------------------------------------------
// In-memory files; writes are intercepted, renames move content.
function mockFs(seedObj, servingOld = '{"land_count":43,"old":true}') {
  const files = new Map();
  files.set("/fixture/seed.json", JSON.stringify(seedObj));
  files.set("/fixture/serving.json", servingOld);
  const writes = [];
  return {
    files,
    writes,
    readFile: (p) => {
      if (!files.has(p)) throw new Error(`mock fs: no such file ${p}`);
      return files.get(p);
    },
    writeFile: (p, content) => { files.set(p, content); writes.push(p); },
    mkdir: () => {},
    rename: (from, to) => {
      if (!files.has(from)) throw new Error(`mock fs: no such temp file ${from}`);
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}

const noSleep = async () => {};

function deps(fs, fetchFn, seedObj) {
  return {
    fetchFn,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    mkdir: fs.mkdir,
    rename: fs.rename,
    sleepFn: noSleep,
    today: "2026-11-06",
    seedPath: "/fixture/seed.json",
    servingPath: "/fixture/serving.json",
    evidenceDir: "/fixture/evidence",
  };
}

function cloneSeed(mutator) {
  const s = JSON.parse(JSON.stringify(REAL_SEED));
  if (mutator) mutator(s);
  return s;
}

function vergeRow(seed, name) {
  return seed.rows.find((r) => r.name === name);
}

// --- GC retrieval ----------------------------------------------------------
test("GC: empty {} response is malformed, not an empty list", async () => {
  const { fetchFn } = mockFetchFactory({ gcPages: [{}] });
  await assert.rejects(
    () => fetchGameChangers(fetchFn, noSleep),
    /unexpected response shape/
  );
});

test("GC: response without a data array is malformed", async () => {
  const { fetchFn } = mockFetchFactory({
    gcPages: [{ object: "list", total_cards: 0, has_more: false }],
  });
  await assert.rejects(
    () => fetchGameChangers(fetchFn, noSleep),
    /unexpected response shape/
  );
});

test("GC: pagination is followed fully (two pages, 53 cards)", async () => {
  const page1 = gcPage(Array.from({ length: 30 }, (_, i) => `GC-${i}`),
    { total: 53, hasMore: true });
  const page2 = gcPage(Array.from({ length: 23 }, (_, i) => `GC-${30 + i}`),
    { total: 53, hasMore: false });
  const { fetchFn, getGcCalls } = mockFetchFactory({ gcPages: [page1, page2] });
  const gc = await fetchGameChangers(fetchFn, noSleep);
  assert.equal(getGcCalls(), 2);
  assert.equal(gc.pages, 2);
  assert.equal(gc.total, 53);
  assert.equal(gc.names.size, 53);
});

test("GC: has_more=true with no next_page aborts (incomplete list)", async () => {
  const page = gcPage(["A", "B"], { total: 5, hasMore: true });
  page.next_page = null; // malformed: claims more pages but gives no link
  const { fetchFn } = mockFetchFactory({ gcPages: [page] });
  await assert.rejects(
    () => fetchGameChangers(fetchFn, noSleep),
    /has_more=true but no next_page/
  );
});

test("GC: collected count must match total_cards", async () => {
  const page = gcPage(["A", "B"], { total: 5, hasMore: false });
  const { fetchFn } = mockFetchFactory({ gcPages: [page] });
  await assert.rejects(
    () => fetchGameChangers(fetchFn, noSleep),
    /incomplete: collected 2 records, expected 5/
  );
});

test("GC: malformed card record (missing id) aborts", async () => {
  const page = gcPage(["A"]);
  page.data[0] = { object: "card", name: "A" }; // no id
  const { fetchFn } = mockFetchFactory({ gcPages: [page] });
  await assert.rejects(
    () => fetchGameChangers(fetchFn, noSleep),
    /malformed card record/
  );
});

// --- Verge dependency ------------------------------------------------------
test("Verge: missing dependency fails closed (no silent drop)", () => {
  const seed = cloneSeed((s) => {
    const row = vergeRow(s, "Floodfarm Verge");
    const mode = row.mana_modes.find((m) => m.unconditional === false);
    delete mode.dependency;
  });
  const row = vergeRow(seed, "Floodfarm Verge");
  assert.throws(
    () => buildConditionalColors(row),
    /missing its "Control \.\.\." dependency/
  );
});

test("Verge: malformed dependency prefix fails closed", () => {
  const seed = cloneSeed((s) => {
    const row = vergeRow(s, "Floodfarm Verge");
    const mode = row.mana_modes.find((m) => m.unconditional === false);
    mode.dependency = "Requires Plains";
  });
  const row = vergeRow(seed, "Floodfarm Verge");
  assert.throws(
    () => buildConditionalColors(row),
    /missing its "Control \.\.\." dependency/
  );
});

test("Verge: reviewed filter/opponent/fetch modes still pass through", () => {
  // Mystic Gate + Sunken Ruins (filter), Exotic Orchard (opponent),
  // Flooded Strand + Polluted Delta (fetch, held rows) must not throw.
  for (const name of ["Mystic Gate", "Sunken Ruins", "Exotic Orchard",
    "Flooded Strand", "Polluted Delta"]) {
    const row = REAL_SEED.rows.find((r) => r.name === name);
    assert.doesNotThrow(() => buildConditionalColors(row), `${name} should pass`);
  }
  // And the two verges still derive their conditional colors.
  for (const name of ["Floodfarm Verge", "Gloomlake Verge"]) {
    const row = REAL_SEED.rows.find((r) => r.name === name);
    assert.equal(buildConditionalColors(row).length, 1, name);
  }
});

test("Verge: unknown conditional mode kind is rejected, not interpreted", () => {
  const row = {
    name: "Mystery Land",
    mana_modes: [{ output: ["W", "U"], unconditional: false, dependency: "Some day" }],
  };
  assert.throws(
    () => buildConditionalColors(row),
    /unknown conditional mana_mode kind/
  );
});

// --- Full refresh (mocked producer) ----------------------------------------
test("Refresh: happy path writes serving + evidence with GC provenance", async () => {
  const { fetchFn } = mockFetchFactory({
    gcPages: [gcPage(["Ancient Tomb"], { total: 1 })],
  });
  const fs = mockFs(REAL_SEED);
  const r = await runRefresh(deps(fs, fetchFn, REAL_SEED));
  assert.equal(r.lands, 43);
  assert.equal(r.gcTotal, 1);
  assert.equal(r.gcPages, 1);
  const serving = JSON.parse(fs.files.get("/fixture/serving.json"));
  assert.equal(serving.land_count, 43);
  const verge = serving.lands.find((l) => l.name === "Floodfarm Verge");
  assert.deepEqual(verge.conditionalColors, [
    { color: "U", dependency: { type: "basic_land_type", types: ["Plains", "Island"] } },
  ]);
  const evidence = JSON.parse(
    fs.files.get("/fixture/evidence/eligibility_checked_2026-11-06.json")
  );
  assert.equal(evidence.gamechanger_count, 1);
  assert.equal(evidence.gamechanger_pages, 1);
  assert.equal(evidence.gamechanger_total_cards, 1);
  assert.ok(evidence.gamechanger_retrieved_at);
  // No temp files left behind.
  assert.ok(![...fs.files.keys()].some((k) => k.includes(".tmp-")));
});

test("Refresh: empty GC response aborts with NO writes", async () => {
  const { fetchFn } = mockFetchFactory({ gcPages: [{}] });
  const fs = mockFs(REAL_SEED);
  await assert.rejects(
    () => runRefresh(deps(fs, fetchFn, REAL_SEED)),
    /unexpected response shape/
  );
  assert.equal(fs.writes.length, 0, "no file should be written");
  assert.equal(JSON.parse(fs.files.get("/fixture/serving.json")).old, true);
});

test("Refresh: missing verge dependency aborts with NO writes", async () => {
  const seed = cloneSeed((s) => {
    const row = vergeRow(s, "Floodfarm Verge");
    delete row.mana_modes.find((m) => m.unconditional === false).dependency;
  });
  const { fetchFn } = mockFetchFactory({
    gcPages: [gcPage([], { total: 0 })],
  });
  const fs = mockFs(seed);
  await assert.rejects(
    () => runRefresh(deps(fs, fetchFn, seed)),
    /missing its "Control \.\.\." dependency/
  );
  assert.equal(fs.writes.length, 0, "no file should be written");
  assert.equal(JSON.parse(fs.files.get("/fixture/serving.json")).old, true);
});

test("Refresh: banned card fails BEFORE writes — last known-good preserved", async () => {
  const { fetchFn } = mockFetchFactory({
    gcPages: [gcPage([], { total: 0 })],
    cardLegalities: { "Hallowed Fountain": "banned" },
  });
  const fs = mockFs(REAL_SEED);
  await assert.rejects(
    () => runRefresh(deps(fs, fetchFn, REAL_SEED)),
    /BANNED lands excluded, human review required: Hallowed Fountain/
  );
  // No evidence files, no serving write, no temp files: the last
  // known-good serving file is untouched.
  assert.equal(fs.writes.length, 0, "no file should be written on a banned abort");
  assert.equal(JSON.parse(fs.files.get("/fixture/serving.json")).old, true);
  assert.ok(![...fs.files.keys()].some((k) => k.includes(".tmp-")));
  assert.ok(![...fs.files.keys()].some((k) => k.includes("evidence/")));
});
