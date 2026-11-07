import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildDeckText,
  buildManaPoolAddDeckUrl,
  buildBuySet,
  BUY_SET_MAX_LINES,
} from "../../src/components/searchBuySet.js";
import {
  matchesProduces,
  matchesFits,
} from "./_manabase_search_filters.js";

// Exercise the real Pages handler. esbuild bundles its JSON import, the same
// dependency set the production build uses.
const viteRequire = createRequire(realpathSync(fileURLToPath(new URL("../../node_modules/vite/package.json", import.meta.url))));
const { build } = await import(pathToFileURL(viteRequire.resolve("esbuild")));
async function bundle(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(entry)], bundle: true,
    platform: "node", format: "esm", write: false, logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}
const api = await bundle(new URL("./manabase-search.js", import.meta.url));

async function get(query) {
  const res = await api.onRequestGet({ request: new Request(`http://review/api/manabase-search?${query}`) });
  return { status: res.status, body: await res.json() };
}
async function getOk(query) {
  const { status, body } = await get(query);
  assert.equal(status, 200, `expected 200 for ?${query}, got ${status}: ${JSON.stringify(body)}`);
  return body;
}
async function allRows(query = "") {
  // Page through the whole served set (limit max 100) for invariant scans.
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const body = await getOk(`${query ? `${query}&` : ""}limit=100&offset=${offset}`);
    rows.push(...body.results);
    if (body.results.length < 100) break;
  }
  return rows;
}

test("no params: full served set, cheapest first, honest meta", async () => {
  const body = await getOk("");
  assert.equal(body.meta.total, 1101);
  assert.equal(body.meta.returned, 50);
  assert.equal(body.meta.sort, "price_asc");
  assert.equal(body.meta.priceSnapshot, "2026-11-06");
  assert.equal(body.meta.rankingSnapshot, null);
  assert.match(body.meta.rankingNote, /not available yet/i);
  assert.equal(body.meta.servedCount, 1101);
  assert.equal(body.meta.heldCount, 111);
  assert.equal(body.meta.heldFaceRows, 101);
  assert.equal(body.meta.heldFetchRows, 10);
  assert.match(body.meta.coverageNote, /1,101 of 1,212/);
  assert.match(body.meta.coverageNote, /not full 1,212-card coverage/);
  // Cheapest first: non-decreasing prices across the page.
  const prices = body.results.map((r) => r.cheapest.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.equal(body.results[0].cheapest.price, 0.06);
});

test("colors=WU: every result produces W or U (unconditionally or conditionally); Tower in, Blood Crypt out", async () => {
  const rows = await allRows("colors=WU");
  const names = new Set(rows.map((r) => r.name));
  assert.ok(names.has("Command Tower"), "Command Tower produces any color");
  assert.ok(names.has("Hallowed Fountain"), "WU land matches a WU search");
  assert.ok(!names.has("Blood Crypt"), "BR-only land must not match WU");
  assert.ok(!names.has("Ancient Tomb"), "colorless-only land must not match a color search");
  // CEO decision (Nov 6): conditional production counts — Nimbus Maze
  // produces W/U only conditionally and now matches a WU search, with its
  // dependency carried on the row (a "may produce" match, never guaranteed).
  assert.ok(names.has("Nimbus Maze"), "conditional W/U land matches a WU search");
  const maze = rows.find((r) => r.name === "Nimbus Maze");
  assert.deepEqual(maze.conditional_colors.map((cc) => cc.color).sort(), ["U", "W"]);
  assert.ok(maze.conditional_colors.some((cc) => cc.dependency === "Island"));
  for (const r of rows) {
    const produced = [...r.colors_produced, ...r.conditional_colors.map((cc) => cc.color)];
    assert.ok(
      produced.some((c) => ["W", "U"].includes(c)),
      `${r.name} produces ${r.colors_produced} (conditional ${JSON.stringify(r.conditional_colors)}) but matched WU`
    );
  }
});

test("colors=C returns only colorless-only lands", async () => {
  const body = await getOk("colors=C&limit=100");
  assert.equal(body.meta.total, 299);
  for (const r of body.results) {
    assert.deepEqual(r.colors_produced, [], `${r.name} produces colors but matched C`);
  }
});

test("mode=fits: whole-card CI + basic land types (CR 903.5c/d)", async () => {
  // Sunken Hollow produces U and B but its whole-card CI is [U, B] — it
  // produces for a U search but does NOT fit a U-only commander.
  const produces = await allRows("colors=U");
  assert.ok(produces.some((r) => r.name === "Sunken Hollow"));
  const fits = await allRows("colors=U&mode=fits");
  assert.ok(!fits.some((r) => r.name === "Sunken Hollow"));
  // Hallowed Fountain CI is [W, U]: fits WU, not U alone.
  assert.ok(!fits.some((r) => r.name === "Hallowed Fountain"));
  const fitsWU = await allRows("colors=WU&mode=fits");
  assert.ok(fitsWU.some((r) => r.name === "Hallowed Fountain"));
  // Plains CI is [W]: fits W, not U.
  assert.ok(!fits.some((r) => r.name === "Plains"));
  for (const r of fits) {
    assert.ok(
      r.color_identity.every((c) => ["U"].includes(c)),
      `${r.name} CI ${r.color_identity} does not fit U`
    );
    const basicColors = (r.basic_types ?? []).map(
      (t) => ({ Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" })[t]
    );
    assert.ok(
      basicColors.every((c) => ["U"].includes(c)),
      `${r.name} basic types ${r.basic_types} do not fit U`
    );
  }
  // Fits is NOT a subset of produces: a U-identity land that produces no
  // colored mana (e.g. Academy Ruins) fits a U commander but does not produce U.
  assert.ok(fits.some((r) => r.name === "Academy Ruins"));
  assert.ok(!produces.some((r) => r.name === "Academy Ruins"));
  // Colorless identity: only empty-CI, no-basic-type rows fit.
  const fitsC = await getOk("colors=C&mode=fits&limit=100");
  assert.ok(fitsC.results.every((r) => r.color_identity.length === 0 && (r.basic_types ?? []).length === 0));
  assert.ok(fitsC.results.some((r) => r.name === "Command Tower"));
  const { status } = await get("mode=bogus");
  assert.equal(status, 400);
});

test("filter semantics on synthetic rows: off-identity, modal, transform, colorless", () => {
  // Off-identity utility land: produces W, but whole-card CI includes B.
  const offIdentity = {
    name: "Test Utility Land", colors_produced: ["W"], color_identity: ["W", "B"], basic_types: [],
  };
  assert.equal(matchesProduces(offIdentity, ["W"], false), true);
  assert.equal(matchesFits(offIdentity, ["W"]), false);
  assert.equal(matchesFits(offIdentity, ["W", "B"]), true);
  // Modal DFC: land face produces U, whole-card CI is [U, B].
  const modal = {
    name: "Test Modal // Land Face", colors_produced: ["U"], color_identity: ["U", "B"], basic_types: [],
  };
  assert.equal(matchesProduces(modal, ["U"], false), true);
  assert.equal(matchesFits(modal, ["U"]), false);
  assert.equal(matchesFits(modal, ["U", "B"]), true);
  // Transforming card, land only on the back: front is a creature, whole-card
  // CI is [B], land face produces B. Fits a B commander, not a W one.
  const transformBack = {
    name: "Test Transform (back: Land)", colors_produced: ["B"], color_identity: ["B"], basic_types: [],
  };
  assert.equal(matchesProduces(transformBack, ["B"], false), true);
  assert.equal(matchesFits(transformBack, ["B"]), true);
  assert.equal(matchesFits(transformBack, ["W"]), false);
  assert.equal(matchesProduces(transformBack, ["W"], false), false);
  // Basic land type without the color in CI: the basic-type check must catch
  // what CI alone misses (a Dryad-Arbor-like row).
  const basicTyped = {
    name: "Test Forest Land", colors_produced: ["G"], color_identity: [], basic_types: ["Forest"],
  };
  assert.equal(matchesFits(basicTyped, ["G"]), true);
  assert.equal(matchesFits(basicTyped, ["W"]), false);
  // Colorless query: produces-C matches only rows with no colored production
  // (unconditional or conditional); fits-C matches only empty-CI,
  // no-basic-type rows.
  const colorlessOnly = {
    name: "Test Wastes", colors_produced: [], color_identity: [], basic_types: [],
  };
  const conditionalOnly = {
    name: "Test Tainted", colors_produced: [], conditional_colors: [{ color: "B", dependency: "Swamp" }],
    color_identity: ["B", "W"], basic_types: [],
  };
  assert.equal(matchesProduces(colorlessOnly, [], true), true);
  assert.equal(matchesProduces(conditionalOnly, [], true), true); // no unconditional production
  // CEO decision (Nov 6): conditional production counts toward a produces
  // match — a "may produce" match, with the dependency carried on the row.
  assert.equal(matchesProduces(conditionalOnly, ["B"], false), true);
  assert.equal(matchesProduces(conditionalOnly, ["R"], false), false); // cannot produce R even conditionally
  assert.equal(matchesFits(colorlessOnly, []), true);
  assert.equal(matchesFits(conditionalOnly, []), false);
});

test("conditional production matches color searches (CEO decision, Nov 6)", async () => {
  // Before/after totals (live preview, before this change): W 361 → 369,
  // U 364 → 372, B 368 → 378, R 361 → 368, G 361 → 368, WU 534 → 545,
  // WUBRG 802 → 814; C unchanged at 299. The 12 conditional-only rows and
  // the 10 one-color verges gain matches only via their conditional color.
  for (const [q, expected] of [
    ["colors=W", 369], ["colors=U", 372], ["colors=B", 378],
    ["colors=R", 368], ["colors=G", 368], ["colors=WU", 545],
    ["colors=WUBRG", 814], ["colors=C", 299],
  ]) {
    const body = await getOk(`${q}&limit=1`);
    assert.equal(body.meta.total, expected, `${q}: expected ${expected}, got ${body.meta.total}`);
  }
  // Nimbus Maze (conditional U/W) matches W and U, not B; Tainted Field
  // (conditional B/W) matches B; both still match C (no unconditional production).
  const wRows = await allRows("colors=W");
  assert.ok(wRows.some((r) => r.name === "Nimbus Maze"));
  const uRows = await allRows("colors=U");
  assert.ok(uRows.some((r) => r.name === "Nimbus Maze"));
  const bRows = await allRows("colors=B");
  assert.ok(!bRows.some((r) => r.name === "Nimbus Maze"), "Nimbus Maze cannot produce B");
  assert.ok(bRows.some((r) => r.name === "Tainted Field"));
  const cRows = await allRows("colors=C");
  assert.ok(cRows.some((r) => r.name === "Nimbus Maze"), "conditional-only rows still match C");
  // The dependency is carried on the returned row (UI shows it as the
  // "conditional" badge — a may-produce match, never a guaranteed source).
  const maze = wRows.find((r) => r.name === "Nimbus Maze");
  assert.deepEqual(maze.conditional_colors, [
    { color: "U", dependency: "Plains" },
    { color: "W", dependency: "Island" },
  ]);
  // A verge's conditional color also counts: Floodfarm Verge (W + conditional
  // U) now matches a U search.
  assert.ok(uRows.some((r) => r.name === "Floodfarm Verge"));
  // mode=fits is unchanged by this decision (whole-card CI, CR 903.5c/d).
  const fitsU = await allRows("colors=U&mode=fits");
  assert.equal(fitsU.length, 396);
  assert.ok(!fitsU.some((r) => r.name === "Nimbus Maze"), "Nimbus Maze CI is [U, W] — does not fit U");
});

test("include_basics=0 hides the 12 basics", async () => {
  const body = await getOk("include_basics=0&limit=100");
  assert.equal(body.meta.total, 1089);
  assert.ok(!body.results.some((r) => r.is_basic));
  assert.ok(!body.results.some((r) => r.name === "Plains"));
});

test("max_price, untapped_only, game_changer and cycle filters", async () => {
  const cheap = await getOk("max_price=0.25&limit=100");
  assert.ok(cheap.results.every((r) => r.cheapest.price <= 0.25));
  const untapped = await getOk("untapped_only=1&limit=100");
  assert.ok(untapped.results.every((r) => r.entry.status === "untapped"));
  const gcOnly = await getOk("game_changer=include&limit=100");
  assert.equal(gcOnly.meta.total, 7);
  assert.ok(gcOnly.results.every((r) => r.game_changer));
  const noGc = await getOk("game_changer=exclude&limit=100");
  assert.ok(noGc.results.every((r) => !r.game_changer));
  assert.equal(noGc.meta.total, 1094);
  const shock = await getOk("cycle=shock&limit=100");
  assert.equal(shock.meta.total, 11);
  assert.ok(shock.results.every((r) => r.cycle === "shock"));
  assert.ok(shock.results.some((r) => r.name === "Hallowed Fountain"));
});

test("sorts: price_desc, name; most_used and inclusion are rejected honestly", async () => {
  const desc = await getOk("sort=price_desc&limit=5");
  assert.equal(desc.results[0].name, "Mishra's Workshop");
  assert.equal(desc.results[0].cheapest.price, 3925);
  const byName = await getOk("sort=name&limit=5");
  assert.equal(byName.results[0].name, "A.I.M. Labs");
  const names = byName.results.map((r) => r.name);
  assert.deepEqual(names, [...names].sort());
  for (const bad of ["most_used", "inclusion"]) {
    const { status, body } = await get(`sort=${bad}`);
    assert.equal(status, 400);
    assert.match(body.error, /not available yet/i);
  }
});

test("pagination is deterministic and non-overlapping", async () => {
  const p1 = await getOk("colors=WU&limit=10&offset=0");
  const p2 = await getOk("colors=WU&limit=10&offset=10");
  const p1b = await getOk("colors=WU&limit=10&offset=0");
  assert.deepEqual(p1.results.map((r) => r.name), p1b.results.map((r) => r.name));
  const overlap = p1.results.filter((r) => p2.results.some((x) => x.name === r.name));
  assert.equal(overlap.length, 0);
  assert.equal(p1.meta.total, p2.meta.total);
});

test("invalid inputs are 400, never silently rewritten", async () => {
  for (const q of [
    "colors=X", "colors=W1", "limit=0", "limit=abc", "limit=1.5",
    "offset=-1", "max_price=-1", "max_price=abc",
    "game_changer=bogus", "include_basics=2", "untapped_only=maybe",
    "cycle=bogus", "sort=bogus",
  ]) {
    const { status, body } = await get(q);
    assert.equal(status, 400, `expected 400 for ?${q}, got ${status}`);
    assert.equal(typeof body.error, "string");
  }
  // limit above the max clamps to 100 (same clamping pattern as the optimizer).
  const clamped = await getOk("limit=500");
  assert.equal(clamped.meta.returned, 100);
});

test("no banned, face or fetch rows anywhere in the served set", async () => {
  const rows = await allRows();
  assert.equal(rows.length, 1101);
  assert.ok(rows.every((r) => !r.banned), "a banned row leaked");
  for (const banned of ["Karakas", "Library of Alexandria", "Tolarian Academy"]) {
    assert.ok(!rows.some((r) => r.name === banned));
  }
  for (const held of ["Bala Ged Recovery", "Jwari Disruption", "Hagra Mauling",
    "Flooded Strand", "Polluted Delta", "Scalding Tarn"]) {
    assert.ok(!rows.some((r) => r.name === held), `${held} leaked into search`);
  }
  // Buy-set default is exactly the non-basics (Q1).
  assert.ok(rows.every((r) => r.in_buy_set_by_default === !r.is_basic));
  assert.equal(rows.filter((r) => r.is_basic).length, 12);
  // Utility rows carry their Oracle text and flag; verified rows do not.
  const utility = rows.filter((r) => r.status === "utility_display_only");
  assert.equal(utility.length, 48);
  assert.ok(utility.every((r) => r.oracle_text && r.utility_flag));
  assert.ok(rows.filter((r) => r.status === "verified").every((r) => !r.oracle_text));
});

// ---- Buy-set helpers (pure module, no bundling needed) ----

test("buildDeckText + Mana Pool add-deck URL: ref appended (Q2 verified), round-trips", () => {
  const names = ["Hallowed Fountain", "Watery Grave"];
  assert.equal(buildDeckText(names), "1 Hallowed Fountain\n1 Watery Grave");
  const url = buildManaPoolAddDeckUrl(names);
  assert.ok(url.startsWith("https://manapool.com/add-deck?deck="));
  // Q2 (Charlie, Nov 6/7): ref placement on the add-deck link is verified by
  // Mana Pool's own affiliate docs + a real browser check — ref IS appended.
  // Account-side commission attribution is still unverified, so nothing in
  // the UI may promise it.
  assert.ok(url.includes("ref=manacents"), "ref=manacents must be appended (Q2 verified)");
  const encoded = url.split("deck=")[1].split("&")[0];
  const decoded = Buffer.from(
    encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64"
  ).toString("utf8");
  assert.equal(decoded, buildDeckText(names));
  assert.equal(buildManaPoolAddDeckUrl([]), "https://manapool.com/?ref=manacents");
});

test("buildBuySet excludes basics, dedupes, caps at 100", () => {
  const rows = [
    { name: "Plains", is_basic: true, in_buy_set_by_default: false, cheapest: { price: 0.08 } },
    { name: "Hallowed Fountain", is_basic: false, in_buy_set_by_default: true, cheapest: { price: 4.18 } },
    { name: "Watery Grave", is_basic: false, in_buy_set_by_default: true, cheapest: { price: 4.47 } },
  ];
  const set = buildBuySet(rows, ["Plains", "Hallowed Fountain", "Hallowed Fountain", "Watery Grave", "No Such Land"]);
  assert.deepEqual(set.names, ["Hallowed Fountain", "Watery Grave"]);
  assert.deepEqual(set.excludedBasics, ["Plains"]);
  assert.equal(set.total, 8.65);
  assert.equal(set.capped, false);
  const many = Array.from({ length: 150 }, (_, i) => ({
    name: `Land ${i}`, is_basic: false, in_buy_set_by_default: true, cheapest: { price: 0.1 },
  }));
  const big = buildBuySet(many, many.map((r) => r.name));
  assert.equal(big.names.length, BUY_SET_MAX_LINES);
  assert.equal(big.capped, true);
  assert.equal(big.overCap, 50);
});

// ---- UI smoke: the Search lands tab renders in the ManaBase tool ----

test("ManaBase renders a Search lands tab next to the optimizer", async () => {
  // The bundle must live on disk (not a data: URL) so the bundled React
  // resolves to the same node_modules instance as this test's React —
  // otherwise renderToStaticMarkup throws "Invalid hook call" (two copies
  // of React). The temp file is removed in the finally block.
  const tmpPath = fileURLToPath(new URL("../../.test-bundle-manabase-search-ui.tmp.mjs", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("../../src/components/ManaBase.jsx", import.meta.url))],
    bundle: true, platform: "node", format: "esm", outfile: tmpPath, logLevel: "silent",
    // React must stay external so the bundle shares this test's React
    // instance — inlining it creates a second copy and render throws
    // "Invalid hook call".
    external: ["react", "react-dom"],
  });
  try {
    const ui = await import(pathToFileURL(tmpPath));
    const html = renderToStaticMarkup(React.createElement(ui.ManaBase));
    assert.match(html, /Search lands/);
    assert.match(html, /Find my lands/);
    assert.match(html, /Browse lands/);
  } finally {
    const { unlink } = await import("node:fs/promises");
    await unlink(tmpPath).catch(() => {});
  }
});
