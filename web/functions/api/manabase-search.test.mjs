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
  assert.equal(body.meta.total, 1212);
  assert.equal(body.meta.returned, 50);
  assert.equal(body.meta.sort, "price_asc");
  assert.equal(body.meta.priceSnapshot, "2026-11-07");
  // Phase 5: Charlie's editorial sort is the ranking now (Q14); most-used
  // is still unavailable (Q3) — the note says both, plainly.
  assert.equal(body.meta.rankingSnapshot, "2026-11-07");
  assert.equal(body.meta.rankingLabel, "Best budget — researched");
  assert.match(body.meta.rankingNote, /editorial sort/i);
  assert.match(body.meta.rankingNote, /Most-used ranking is still not/);
  assert.equal(body.meta.servedCount, 1212);
  assert.equal(body.meta.heldCount, 0);
  assert.equal(body.meta.heldFaceRows, 0);
  assert.equal(body.meta.heldFetchRows, 0);
  assert.equal(body.meta.faceRows, 101);
  assert.equal(body.meta.cheapestSetTotal, 20196.94);
  assert.equal(body.meta.budgetTypes.length, 25);
  assert.equal(body.meta.preorderWatch.length, 7);
  assert.match(body.meta.coverageNote, /All 1,212 Commander-legal lands searchable/);
  assert.match(body.meta.coverageNote, /0 held/);
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
  assert.equal(body.meta.total, 308);
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
  // Fetchlands fit by whole-card CI and never produce: Flooded Strand's CI
  // is [] (colorless — CR 903.4/903.5c, corrected Nov 7; the tutored types
  // are search targets, not identity), so it fits EVERY commander — WU, U
  // alone, even colorless. It never appears in a produces search, not even
  // a colorless one (it tutors, it taps for nothing).
  assert.ok(fitsWU.some((r) => r.name === "Flooded Strand"));
  assert.ok(fits.some((r) => r.name === "Flooded Strand"));
  assert.ok(!produces.some((r) => r.name === "Flooded Strand"));
  const producesC = await allRows("colors=C");
  assert.ok(!producesC.some((r) => r.name === "Flooded Strand"));
  // Colorless identity: only empty-CI, no-basic-type rows fit — the 10
  // fetchlands are in that set now (CI []), alongside Command Tower.
  const fitsC = await allRows("colors=C&mode=fits");
  assert.ok(fitsC.every((r) => r.color_identity.length === 0 && (r.basic_types ?? []).length === 0));
  assert.ok(fitsC.some((r) => r.name === "Command Tower"));
  assert.ok(fitsC.some((r) => r.name === "Flooded Strand"));
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
  // Fetchland: produces no mana at all — never matches produces (not even
  // a colorless request); fits EVERY commander, because its CI is []
  // (colorless — CR 903.4/903.5c, corrected Nov 7; the tutored types are
  // search targets, not identity). Empty CI is a subset of any request,
  // including no colors at all.
  const fetchland = {
    name: "Test Fetchland", colors_produced: [], conditional_colors: [],
    color_identity: [], basic_types: [], cycle: "fetch",
  };
  assert.equal(matchesProduces(fetchland, ["W"], false), false);
  assert.equal(matchesProduces(fetchland, [], true), false);
  assert.equal(matchesFits(fetchland, ["W", "U"]), true);
  assert.equal(matchesFits(fetchland, ["U"]), true);
  assert.equal(matchesFits(fetchland, []), true);
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
  // Phase 5 (face rows wired in, +101 rows): W 396, U 399, B 406, R 395,
  // G 396, WU 591, WUBRG 906, C 308.
  for (const [q, expected] of [
    ["colors=W", 396], ["colors=U", 399], ["colors=B", 406],
    ["colors=R", 395], ["colors=G", 396], ["colors=WU", 591],
    ["colors=WUBRG", 906], ["colors=C", 308],
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
  // The fetchland CI correction (Nov 7, CI [] — colorless) moved fits U
  // 416 → 426: the 10 fetchlands now fit every commander.
  const fitsU = await allRows("colors=U&mode=fits");
  assert.equal(fitsU.length, 426);
  assert.ok(!fitsU.some((r) => r.name === "Nimbus Maze"), "Nimbus Maze CI is [U, W] — does not fit U");
});

test("include_basics=0 hides the 12 basics", async () => {
  const body = await getOk("include_basics=0&limit=100");
  assert.equal(body.meta.total, 1200);
  assert.ok(!body.results.some((r) => r.is_basic));
  assert.ok(!body.results.some((r) => r.name === "Plains"));
});

test("max_price, untapped_only, game_changer and cycle filters", async () => {
  const cheap = await getOk("max_price=0.25&limit=100");
  assert.ok(cheap.results.every((r) => r.cheapest.price <= 0.25));
  const untapped = await getOk("untapped_only=1&limit=100");
  assert.ok(untapped.results.every((r) => r.entry.status === "untapped"));
  // Phase 5: 525 untapped land drops. The 32 transform-back rows whose land
  // face enters untapped are NOT untapped land drops (transformation only),
  // so they are excluded here even though their entry status is untapped.
  assert.equal(untapped.meta.total, 525);
  assert.ok(!untapped.results.some(
    (r) => r.status === "face_row" && r.land_drop.code === "requires_transformation"
  ));
  const gcOnly = await getOk("game_changer=include&limit=100");
  assert.equal(gcOnly.meta.total, 7);
  assert.ok(gcOnly.results.every((r) => r.game_changer));
  const noGc = await getOk("game_changer=exclude&limit=100");
  assert.ok(noGc.results.every((r) => !r.game_changer));
  assert.equal(noGc.meta.total, 1205);
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
    "cycle=bogus", "sort=bogus", "type=bogus",
    "sort=best_budget",
  ]) {
    const { status, body } = await get(q);
    assert.equal(status, 400, `expected 400 for ?${q}, got ${status}`);
    assert.equal(typeof body.error, "string");
  }
  // limit above the max clamps to 100 (same clamping pattern as the optimizer).
  const clamped = await getOk("limit=500");
  assert.equal(clamped.meta.returned, 100);
});

test("fetchlands served with the fetch model; no banned rows; face rows served (Nov 7)", async () => {
  const rows = await allRows();
  assert.equal(rows.length, 1212);
  assert.ok(rows.every((r) => !r.banned), "a banned row leaked");
  for (const banned of ["Karakas", "Library of Alexandria", "Tolarian Academy"]) {
    assert.ok(!rows.some((r) => r.name === banned));
  }
  // The 10 fetchlands are SERVED now (fetch modeling done Nov 7): colorless
  // CI [] (CR 903.4/903.5c — corrected Nov 7, Charlie + live Scryfall; the
  // tutored types are search targets, not identity), no production,
  // conditional tutor entry, cycle fetch, in the buy set by default like
  // any other non-basic.
  // Display consequence (CEO, Nov 7): colors_produced [] + conditional_colors
  // [] is exactly what makes a Search card render the colorless pip — the
  // card's pip branch takes its colorless fallback when nothing is produced.
  // The colorless CI is also what makes a fetchland fit EVERY commander in
  // fits mode — see the legality test below.
  const expectedCI = {
    "Arid Mesa": [], "Bloodstained Mire": [], "Flooded Strand": [],
    "Marsh Flats": [], "Misty Rainforest": [], "Polluted Delta": [],
    "Scalding Tarn": [], "Verdant Catacombs": [], "Windswept Heath": [],
    "Wooded Foothills": [],
  };
  for (const [name, ci] of Object.entries(expectedCI)) {
    const row = rows.find((r) => r.name === name);
    assert.ok(row, `${name} is served`);
    assert.equal(row.cycle, "fetch");
    assert.deepEqual(row.colors_produced, [], `${name} must produce nothing`);
    assert.deepEqual(row.conditional_colors, [], `${name} must produce nothing conditionally`);
    assert.equal(row.produces_colorless, false);
    assert.deepEqual(row.color_identity, ci);
    assert.equal(row.entry.status, "conditional");
    assert.match(row.entry.condition, /tutor an? .* — produces no mana itself/);
    assert.ok(row.cheapest.price > 0 && Number.isFinite(row.cheapest.price));
    assert.equal(row.in_buy_set_by_default, true);
  }
  // Phase 5: the 101 face rows ARE served now (Q4), with land-drop labels.
  const faceRows = rows.filter((r) => r.status === "face_row");
  assert.equal(faceRows.length, 101);
  assert.ok(faceRows.every((r) => r.face_class && r.land_drop && r.land_drop.code));
  assert.equal(faceRows.filter((r) => r.face_class === "modal").length, 60);
  assert.equal(faceRows.filter((r) => r.face_class === "transform_front").length, 4);
  assert.equal(faceRows.filter((r) => r.face_class === "transform_back").length, 32);
  assert.equal(faceRows.filter((r) => r.face_class === "adventure").length, 5);
  // All 32 transform-back rewards are labeled as requiring transformation.
  const needsTransform = faceRows.filter((r) => r.land_drop.code === "requires_transformation");
  assert.equal(needsTransform.length, 32);
  assert.ok(needsTransform.every((r) => r.face_class === "transform_back"));
  // One canonical identity per row: no duplicate oracle_ids, and a face
  // row's buy name is the full canonical card name (one purchase).
  assert.equal(new Set(rows.map((r) => r.oracle_id)).size, 1212);
  assert.ok(faceRows.every((r) => r.buy_name === r.name));
  // Buy-set default is exactly the non-basics (Q1) — face rows included.
  assert.ok(rows.every((r) => r.in_buy_set_by_default === !r.is_basic));
  assert.equal(rows.filter((r) => r.is_basic).length, 12);
  // Oracle text ships on every non-basic row (CEO, Nov 7 — the Search card
  // shows the land text under it); basics carry none. Utility rows carry
  // their text and flag; face rows carry their land face's text.
  const utility = rows.filter((r) => r.status === "utility_display_only");
  assert.equal(utility.length, 48);
  assert.ok(utility.every((r) => r.oracle_text && r.utility_flag));
  assert.ok(rows.filter((r) => r.status === "verified" && !r.is_basic)
    .every((r) => r.oracle_text));
  assert.ok(rows.filter((r) => r.status === "face_row").every((r) => r.oracle_text));
  assert.ok(rows.filter((r) => r.is_basic).every((r) => !r.oracle_text));
  // No EDHREC-derived metric anywhere in the served data (Q3): no most-used
  // numbers, no edhrec keys on any row or in meta.
  const dump = JSON.stringify({ rows, meta: (await getOk("limit=1")).meta });
  assert.ok(!/edhrec/i.test(dump), "an edhrec-derived field leaked into serving data");
  assert.ok(!/most_used|num_decks|potential_decks/.test(dump));
});

// ---- Phase 5: best-budget sort (Q14, Charlie Nov 7) ----

test("best_budget: two_color_fixing ranked view — rank order, ties, unranked tail", async () => {
  const body = await getOk("type=two_color_fixing&sort=best_budget&limit=100");
  assert.equal(body.meta.total, 208);
  assert.equal(body.meta.rankedCount, 161);
  assert.equal(body.meta.type, "two_color_fixing");
  assert.equal(body.meta.typeLabel, "Two Color Fixing");
  assert.equal(body.meta.sort, "best_budget");
  // Page 1 (limit 100) is all ranked; fetch the rest for the full invariant.
  const rows = await allRows("type=two_color_fixing&sort=best_budget");
  assert.equal(rows.length, 208);
  const ranked = rows.filter((r) => r.budget_rank !== null);
  const unranked = rows.filter((r) => r.budget_rank === null);
  assert.equal(ranked.length, 161);
  assert.equal(unranked.length, 47);
  // Ranked rows come first, ranks non-decreasing.
  assert.deepEqual(
    rows.map((r) => r.budget_rank !== null),
    [...Array(161).fill(true), ...Array(47).fill(false)]
  );
  const ranks = ranked.map((r) => r.budget_rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  // Rank 1 = the pain cycle (10 members, symmetric tie): all rank 1, ordered
  // by actual selected price, then normalized name.
  const rank1 = ranked.filter((r) => r.budget_rank === 1);
  assert.equal(rank1.length, 10);
  assert.equal(rank1[0].name, "Battlefield Forge");
  assert.equal(rank1[0].cheapest.price, 0.23);
  const norm = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (let i = 1; i < rank1.length; i++) {
    const a = rank1[i - 1], b = rank1[i];
    assert.ok(
      a.cheapest.price < b.cheapest.price ||
        (a.cheapest.price === b.cheapest.price && norm(a.name) <= norm(b.name)),
      `rank-1 tie order broken: ${a.name} $${a.cheapest.price} before ${b.name} $${b.cheapest.price}`
    );
  }
  // Rank 4 = the check cycle (10 members, symmetric tie).
  const rank4 = ranked.filter((r) => r.budget_rank === 4);
  assert.equal(rank4.length, 10);
  assert.equal(rank4[0].name, "Isolated Chapel");
  // Unranked tail is alphabetical by normalized name (null rank is
  // unreviewed, not worst quality) and carries its context/sources as null.
  const unrankedNorm = unranked.map((r) => norm(r.name));
  assert.deepEqual(unrankedNorm, [...unrankedNorm].sort());
  // Ranked rows carry their rank context + sources for the UI.
  assert.ok(ranked.every((r) => typeof r.budget_rank_context === "string" && r.budget_rank_context.length > 0));
  assert.ok(ranked.every((r) => Array.isArray(r.budget_rank_sources) && r.budget_rank_sources.length > 0));
  // Deterministic pagination: repeat page identical, pages do not overlap.
  const p1 = await getOk("type=two_color_fixing&sort=best_budget&limit=10&offset=0");
  const p1b = await getOk("type=two_color_fixing&sort=best_budget&limit=10&offset=0");
  assert.deepEqual(p1.results.map((r) => r.oracle_id), p1b.results.map((r) => r.oracle_id));
  const p2 = await getOk("type=two_color_fixing&sort=best_budget&limit=10&offset=10");
  assert.equal(p1.results.filter((r) => p2.results.some((x) => x.oracle_id === r.oracle_id)).length, 0);
});

test("best_budget: rainbow view is 5 ranked rows, Command Tower first", async () => {
  const body = await getOk("type=rainbow_commander_fixing&sort=best_budget&limit=100");
  assert.equal(body.meta.total, 5);
  assert.equal(body.meta.rankedCount, 5);
  assert.deepEqual(body.results.map((r) => r.name), [
    "Command Tower", "Exotic Orchard", "Path of Ancestry", "Gemstone Mine", "Grand Coliseum",
  ]);
  assert.deepEqual(body.results.map((r) => r.budget_rank), [1, 2, 3, 4, 5]);
});

test("best_budget: $5.00-inclusive gate, $5.01 exclusion, null quotes (unit)", async () => {
  const { isRankedInType } = api;
  const base = (over) => ({
    budget_rankings: [{
      type_id: "two_color_fixing", editorial_rank: 1,
      default_recommendation: true, budget_eligible: true,
      preorder_only_under_5: false, released_quote_cents: 500, ...over,
    }],
  });
  assert.equal(isRankedInType(base({}), "two_color_fixing"), true, "exactly $5.00 passes");
  assert.equal(isRankedInType(base({ released_quote_cents: 501 }), "two_color_fixing"), false, "$5.01 fails");
  assert.equal(isRankedInType(base({ released_quote_cents: null }), "two_color_fixing"), false, "null quote fails");
  assert.equal(isRankedInType(base({ preorder_only_under_5: true }), "two_color_fixing"), false, "preorder-only fails");
  assert.equal(isRankedInType(base({ default_recommendation: false }), "two_color_fixing"), false, "non-default fails");
  assert.equal(isRankedInType(base({ budget_eligible: false }), "two_color_fixing"), false, "ineligible fails");
  assert.equal(isRankedInType(base({}), "rainbow_commander_fixing"), false, "wrong type fails");
  assert.equal(isRankedInType({ budget_rankings: [] }, "two_color_fixing"), false, "unranked fails");
});

test("best_budget: preorder separation — the 7 preorder-only cards", async () => {
  const body = await getOk("type=two_color_fixing&sort=best_budget&limit=100");
  // Meta watch list: 7 cards, all with a released quote above $5 and a
  // Nov 13 earliest release (Star Trek set).
  assert.equal(body.meta.preorderWatch.length, 7);
  assert.deepEqual(
    body.meta.preorderWatch.map((w) => w.name).sort(),
    ["Godless Shrine", "Hallowed Fountain", "Sacred Foundry", "Stomping Ground",
     "Temple Garden", "Training Center", "Watery Grave"]
  );
  assert.ok(body.meta.preorderWatch.every((w) => Number(w.released_usd) > 5));
  assert.ok(body.meta.preorderWatch.every((w) => w.earliest_release === "2026-11-13"));
  // In the ranked view they are unranked (budget_rank null) but flagged, so
  // the UI can show them separately as a preorder watch list, never as
  // buy-now budget picks.
  const rows = await allRows("type=two_color_fixing&sort=best_budget");
  for (const name of body.meta.preorderWatch.map((w) => w.name)) {
    const row = rows.find((r) => r.name === name);
    assert.ok(row, `${name} is a member of the type view`);
    assert.equal(row.budget_rank, null, `${name} must not be ranked`);
    assert.equal(row.preorder_only_under_5, true, `${name} must carry the preorder flag`);
    assert.ok(row.cheapest.price > 5, `${name} served price must be the released price, got $${row.cheapest.price}`);
  }
  // The served prices are the corrected RELEASED prices (Phase 5 preorder
  // fix), not the Nov 13 preorder prices the old data showed.
  const fountain = rows.find((r) => r.name === "Hallowed Fountain");
  assert.equal(fountain.cheapest.price, 7.55);
  assert.equal(fountain.cheapest.printing, "ECL #265");
});

test("max_price boundary: inclusive at the cheapest row, 1004 rows at $5", async () => {
  const at6 = await getOk("max_price=0.06&limit=100");
  assert.equal(at6.meta.total, 4);
  const at5c = await getOk("max_price=0.05&limit=100");
  assert.equal(at5c.meta.total, 0);
  const at5 = await getOk("max_price=5&limit=1");
  assert.equal(at5.meta.total, 1004);
  assert.ok(at5.results.every((r) => r.cheapest.price <= 5));
});

test("face rows via API: modal Pathway + Adventure render with face data", async () => {
  // Ishgard produces W; the Pathway faces produce G/U — query WUG for both.
  const all = await allRows("colors=WUG");
  const pathway = all.find((r) => r.name === "Barkchannel Pathway // Tidechannel Pathway");
  assert.ok(pathway, "Pathway modal row is served");
  assert.equal(pathway.status, "face_row");
  assert.equal(pathway.face_class, "modal");
  assert.equal(pathway.land_drop.code, "playable_choice");
  assert.equal(pathway.land_faces.length, 2);
  assert.deepEqual(pathway.land_faces.map((f) => f.name), ["Barkchannel Pathway", "Tidechannel Pathway"]);
  assert.deepEqual(pathway.other_faces, []);
  assert.equal(pathway.buy_name, pathway.name);
  // No type selected, so no rank context is attached to the row.
  assert.equal(pathway.budget_rank, undefined);
  const ishgard = all.find((r) => r.name === "Ishgard, the Holy See // Faith & Grief");
  assert.ok(ishgard, "Adventure row is served");
  assert.equal(ishgard.face_class, "adventure");
  assert.equal(ishgard.land_drop.code, "single_card");
  assert.equal(ishgard.land_faces.length, 1);
  assert.equal(ishgard.land_faces[0].name, "Ishgard, the Holy See");
  assert.deepEqual(ishgard.other_faces.map((f) => f.name), ["Faith & Grief"]);
  // A transform-back reward is labeled as requiring transformation.
  const aclazotz = (await allRows("colors=B")).find(
    (r) => r.name === "Aclazotz, Deepest Betrayal // Temple of the Dead"
  );
  assert.ok(aclazotz, "transform-back row is served");
  assert.equal(aclazotz.face_class, "transform_back");
  assert.equal(aclazotz.land_drop.code, "requires_transformation");
});

test("coverage arithmetic: 1,212 served + 0 held = 1,212 legal; + 100 excluded = 1,312 roster", async () => {
  const body = await getOk("limit=1");
  assert.equal(body.meta.servedCount + body.meta.heldCount, 1212);
  assert.equal(body.meta.servedCount + body.meta.heldCount + body.meta.excludedCount, 1312);
  assert.equal(body.meta.servedCount, 1212);
  assert.equal(body.meta.heldCount, 0);
  assert.equal(body.meta.excludedCount, 100);
});

// ---- Search-fix + Browse-full-catalog (Nov 7): cycleCounts + paging ----

test("meta.cycleCounts: true full counts + price ranges per cycle (Browse tab)", async () => {
  const body = await getOk("limit=1");
  const counts = body.meta.cycleCounts;
  assert.ok(Array.isArray(counts), "cycleCounts must be an array");
  assert.equal(counts.length, 29, "one entry per cycle in the serving data");
  // Counts sum to the full served set, and every row's cycle is listed.
  assert.equal(counts.reduce((n, c) => n + c.count, 0), 1212);
  // The fetch cycle is served now (10 rows).
  const fetch = counts.find((c) => c.id === "fetch");
  assert.ok(fetch, "fetch cycle present in cycleCounts");
  assert.equal(fetch.count, 10);
  const rows = await allRows();
  const byCycle = {};
  for (const r of rows) byCycle[r.cycle] = (byCycle[r.cycle] ?? 0) + 1;
  assert.deepEqual(
    Object.fromEntries(counts.map((c) => [c.id, c.count])),
    byCycle
  );
  // Min/max prices match an independent scan of the same rows.
  for (const c of counts) {
    const prices = rows.filter((r) => r.cycle === c.id).map((r) => r.cheapest.price);
    assert.equal(c.minPrice, Math.min(...prices), `${c.id} min price`);
    assert.equal(c.maxPrice, Math.max(...prices), `${c.id} max price`);
  }
  // Largest group is unclassified (861) — it gets its own Browse group at
  // the end, not dropped. Sorted count-desc, then id (deterministic).
  assert.equal(counts[0].id, "unclassified");
  assert.equal(counts[0].count, 861);
  const sorted = [...counts].sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
  assert.deepEqual(counts.map((c) => c.id), sorted.map((c) => c.id));
});

test("cycle paging: full membership, no truncation, no duplicates (Browse tab)", async () => {
  // Unclassified is the biggest cycle (861 rows = 9 pages at limit 100).
  const rows = await allRows("cycle=unclassified&sort=name");
  assert.equal(rows.length, 861);
  assert.equal(new Set(rows.map((r) => r.oracle_id)).size, 861);
  assert.ok(rows.every((r) => r.cycle === "unclassified"));
  const names = rows.map((r) => r.name);
  assert.deepEqual(names, [...names].sort());
  // A small cycle pages cleanly too (shock, 11 rows, one page).
  const shock = await allRows("cycle=shock&sort=name");
  assert.equal(shock.length, 11);
  assert.ok(shock.every((r) => r.cycle === "shock"));
  // Fetch cycle pages cleanly too (10 rows, one page).
  const fetch = await allRows("cycle=fetch&sort=name");
  assert.equal(fetch.length, 10);
  assert.ok(fetch.every((r) => r.cycle === "fetch"));
  assert.ok(fetch.some((r) => r.name === "Flooded Strand"));
  // cycle + type combine: 10 of the 11 shock-cycle rows are members of
  // two_color_fixing; the 11th (Multiversal Passage, a utility land) has no
  // type record and is correctly excluded from the type view.
  const shockInType = await getOk("cycle=shock&type=two_color_fixing&limit=100");
  assert.equal(shockInType.meta.total, 10);
  assert.ok(!shockInType.results.some((r) => r.name === "Multiversal Passage"));
});

test("Fetch lands button filter: the exact request it issues shows all 10 (CEO, Nov 7)", async () => {
  // applyFetchFilter (ManaBase.jsx) issues mode=produces + cycle=fetch with
  // no colors, no type, no max price — the combination that cannot hide a
  // fetchland. Assert it returns exactly the 10, cheapest first.
  const body = await getOk("mode=produces&cycle=fetch&limit=100");
  assert.equal(body.meta.total, 10);
  assert.equal(body.results.length, 10);
  assert.ok(body.results.every((r) => r.cycle === "fetch"));
  assert.deepEqual(
    body.results.map((r) => r.name).sort(),
    ["Arid Mesa", "Bloodstained Mire", "Flooded Strand", "Marsh Flats",
      "Misty Rainforest", "Polluted Delta", "Scalding Tarn",
      "Verdant Catacombs", "Windswept Heath", "Wooded Foothills"].sort()
  );
  assert.equal(body.results[0].name, "Windswept Heath");
  assert.equal(body.results[0].cheapest.price, 11.75);
});

test("fetchlands fits legality at the API (corrected Nov 7): colorless CI fits every commander", async () => {
  // Fetchlands are colorless (CI [] — CR 903.4/903.5c, corrected Nov 7 after
  // Charlie + live Scryfall; the first version wrongly assigned CI from the
  // tutored types). Empty CI is a subset of any commander identity, so all
  // 10 fit mono-red, mono-blue, colorless, and five-color alike.
  const red = await allRows("mode=fits&colors=R");
  assert.equal(red.filter((r) => r.cycle === "fetch").length, 10, "all 10 fetchlands fit mono-red");
  assert.ok(red.some((r) => r.name === "Flooded Strand"), "Flooded Strand fits mono-red");
  const colorless = await allRows("mode=fits&colors=C");
  assert.equal(colorless.filter((r) => r.cycle === "fetch").length, 10, "all 10 fetchlands fit colorless");
  const wu = await allRows("mode=fits&colors=WU");
  assert.equal(wu.filter((r) => r.cycle === "fetch").length, 10, "all 10 fetchlands fit WU");
  assert.ok(wu.some((r) => r.name === "Flooded Strand"), "Flooded Strand fits WU");
  const wubrg = await allRows("mode=fits&colors=WUBRG");
  assert.equal(wubrg.filter((r) => r.cycle === "fetch").length, 10);
  // Produces never matches a fetchland, not even colorless (see the
  // classifier test) — confirmed here at the API level too.
  const prodW = await allRows("mode=produces&colors=W");
  assert.ok(!prodW.some((r) => r.cycle === "fetch"));
  const prodC = await allRows("mode=produces&colors=C");
  assert.ok(!prodC.some((r) => r.cycle === "fetch"));
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

test("ManaBase renders Search as the landing tab with Browse second (optimizer removed Nov 7)", async () => {
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
    assert.match(html, /Browse lands/);
    assert.doesNotMatch(html, /Find my lands/);
    // Search is the landing tab: it carries aria-selected="true".
    assert.match(html, /aria-selected="true"[^>]*>\s*Search lands/s);
    // Render the tabs themselves: LandSearch / LandGallery only mount when
    // their tab is active, so rendering ManaBase alone never executes them.
    // e676b3e shipped a Search-tab crash (useCallback used but never
    // imported) precisely because nothing rendered LandSearch — the render
    // below executes every hook call in both tabs and would throw the same
    // ReferenceError. Effects do not run in static markup; the crash was at
    // render time, so this catches it.
    const searchHtml = renderToStaticMarkup(React.createElement(ui.LandSearch));
    assert.match(searchHtml, /Best budget — researched/);
    assert.match(searchHtml, /Type \/ role/);
    assert.match(searchHtml, /Search lands/);
    // "Fetch lands" quick-filter button (CEO, Nov 7): present in the
    // filters, inactive on first render (cycle is empty, so aria-pressed
    // is false). Its click behavior is covered at the API level by the
    // button-filter test above (the exact request it issues).
    assert.match(searchHtml, /Fetch lands/);
    assert.match(searchHtml, /aria-pressed="false"[^>]*>Fetch lands/);
    const galleryHtml = renderToStaticMarkup(React.createElement(ui.LandGallery));
    assert.match(galleryHtml, /Loading lands/);
    // Note: the Search tab renders only when active, so the Best budget
    // sort option is verified in the built bundle + live preview, not here.
    // The Search-fix + Browse-full-catalog controls must be in the bundle:
    // "Show all" (type sets), the auto-search "Updating…" indicator, and
    // the Browse tab's full-catalog copy.
    const { readFile } = await import("node:fs/promises");
    const bundleText = await readFile(tmpPath, "utf8");
    assert.match(bundleText, /Show all \(/);
    assert.match(bundleText, /Loading all/);
    // esbuild escapes non-ASCII in the bundle, so the ellipsis in
    // "Updating…" is emitted as \u2026 — match the ASCII prefix.
    assert.match(bundleText, /Updating/);
    assert.match(bundleText, /cycleCounts/);
    assert.match(bundleText, /Every land by cycle/);
    // CEO, Nov 7: the Search card shows the land's oracle text, not the
    // budget-rank research note — the rank-note div must be gone from the
    // bundle, and the oracle-text render must be present.
    assert.doesNotMatch(bundleText, /mb-land-rank-note/);
    assert.match(bundleText, /mb-land-oracle/);
    // Browse order (CEO, Nov 7): the 8 featured cycles first, then the rest
    // alphabetically, Unclassified last.
    const ordered = ui.orderBrowseCycles([
      { id: "unclassified", count: 861 }, { id: "shock", count: 11 },
      { id: "basic", count: 12 }, { id: "fetch", count: 10 },
      { id: "triome", count: 10 }, { id: "vivid", count: 5 },
      { id: "pain", count: 16 }, { id: "check", count: 25 },
      { id: "bond", count: 10 }, { id: "surveil", count: 14 },
      { id: "fast", count: 11 },
    ]);
    assert.deepEqual(ordered, [
      "fetch", "shock", "triome", "pain", "check", "bond", "surveil", "fast",
      "basic", "vivid", "unclassified",
    ]);
  } finally {
    const { unlink } = await import("node:fs/promises");
    await unlink(tmpPath).catch(() => {});
  }
});
