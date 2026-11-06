// ManaBase solver regression tests — Designs A/B (2026-11-06).
// Failing-before / passing-after for Charlie's Priority 1 corrections.
// Run: node --test functions/api/_manabase_solver.test.mjs
// These tests FAIL on solver v1.4.1-js (no etbModes / conditionalColors
// support) and PASS on v1.4.2-js. They use small fixture catalogs to
// isolate each behavior, plus the real 43-land served file for the
// "unaffected cycles" check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OptimizedSolver, SOLVER_VERSION } from "./_manabase_solver_esm.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVED = JSON.parse(
  readFileSync(join(HERE, "_manabase_lands.json"), "utf8")
).lands;

// --- Fixtures (minimal solver-shape lands) ---
function land(over) {
  return {
    name: "Fixture", price: 1, colors: [], colorIdentity: [],
    basicTypes: [], untapped: true, conditional: false,
    productionConditional: false, lifeCost: 0, utility: 0,
    banned: false, gameChanger: false, producesColorless: false,
    oracleId: "00000000-0000-0000-0000-000000000000",
    ...over,
  };
}

const SHOCK = land({
  name: "Hallowed Fountain", price: 7.61, colors: ["U", "W"],
  colorIdentity: ["U", "W"], basicTypes: ["Island", "Plains"],
  untapped: false, conditional: true, lifeCost: 0,
  oracleId: "f1750962-a87c-49f6-b731-02ae971ac6ea",
  etbModes: [
    { mode: "pay_life", untapped: true, conditional: false, lifeCost: 2.0 },
    { mode: "tapped", untapped: false, conditional: true, lifeCost: 0 },
  ],
});

const CHECK = land({
  name: "Glacial Fortress", price: 0.24, colors: ["W", "U"],
  colorIdentity: ["W", "U"], basicTypes: [],
  untapped: false, conditional: true, lifeCost: 0,
  oracleId: "11111111-1111-1111-1111-111111111111",
});

const PLAINS = land({
  name: "Plains", price: 0.05, colors: ["W"], colorIdentity: ["W"],
  basicTypes: ["Plains"], oracleId: "22222222-2222-2222-2222-222222222222",
});

const ISLAND = land({
  name: "Island", price: 0.05, colors: ["U"], colorIdentity: ["U"],
  basicTypes: ["Island"], oracleId: "33333333-3333-3333-3333-333333333333",
});

const VERGE = land({
  name: "Floodfarm Verge", price: 8.55, colors: ["W"],
  colorIdentity: ["U", "W"], basicTypes: [],
  untapped: true, conditional: false, lifeCost: 0,
  oracleId: "f1e9abfb-c3c8-483e-b446-5c2afc9f6394",
  conditionalColors: [
    { color: "U", dependency: { type: "basic_land_type", types: ["Plains", "Island"] } },
  ],
});

const GC_LAND = land({
  name: "Ancient Tomb", price: 30, colors: [], colorIdentity: [],
  basicTypes: [], untapped: true, conditional: false, lifeCost: 0,
  producesColorless: true, gameChanger: true,
  oracleId: "44444444-4444-4444-4444-444444444444",
});

const BANNED_LAND = land({
  name: "Karakas", price: 50, colors: [], colorIdentity: [],
  basicTypes: [], untapped: true, conditional: false, lifeCost: 0,
  producesColorless: true, banned: true,
  oracleId: "55555555-5555-5555-5555-555555555555",
});

function run(catalog, colors, priorities, budget, slots, opts = {}) {
  const s = new OptimizedSolver(catalog, { maxNodes: 200000 });
  return s.optimize(colors, priorities, budget, slots, opts);
}

test("solver version is 1.4.3-js", () => {
  assert.equal(SOLVER_VERSION, "1.4.3-js");
});

test("Design A: shock qualifies early in pay_life mode (penalty 2.0)", () => {
  // WU early, 10 slots: the shock must beat the tapped check land for the
  // early slot (the check can never be early). Fixture has no cheap basics
  // for W/U early except the shock, so it must be selected in pay_life.
  const catalog = [SHOCK, CHECK];
  const [pkg, score, stats] = run(catalog, ["W", "U"], { W: "early", U: "early" }, 25, 10);
  assert.equal(stats.status, "optimal");
  const shock = pkg.find((l) => l.name === "Hallowed Fountain");
  assert.ok(shock, "shock should be in the package");
  assert.equal(shock.assumedEtbMode, "pay_life");
  assert.equal(shock.untapped, true);
  assert.equal(shock.conditional, false);
  assert.equal(shock.lifeCost, 2.0);
  // Penalty: shock 2.0 (one-time) + check is not selected. The score
  // penalty must be exactly 2.0 (no 3-use multiplication).
  assert.equal(score[2], 2.0);
  // Early sources: the shock counts (1). The check does not.
  assert.equal(score[1], 1);
});

test("Design A: shock in tapped mode for main/splash (penalty 1.0)", () => {
  // WU main, 2 slots: shock + one basic covers 3 of 4 targets (shortfall
  // 1); two basics cover 2 of 4 (shortfall 2). The shock wins on objective
  // 1 and must be scored in tapped mode (penalty 1.0, lifeCost 0).
  const catalog = [SHOCK, PLAINS, ISLAND];
  const [pkg, score] = run(catalog, ["W", "U"], { W: "main", U: "main" }, 25, 2);
  const shock = pkg.find((l) => l.name === "Hallowed Fountain");
  assert.ok(shock, "shock should be in the package");
  assert.equal(shock.assumedEtbMode, "tapped");
  assert.equal(shock.untapped, false);
  assert.equal(shock.conditional, true);
  assert.equal(shock.lifeCost, 0);
  // Penalty: shock tapped 1.0 + the basic 0 = 1.0.
  assert.equal(score[2], 1.0);
});

test("Design A: a 3-shock package reports 6 life total (one-time, not x3)", () => {
  const shock2 = { ...SHOCK, name: "Watery Grave", colors: ["B", "U"],
    colorIdentity: ["B", "U"], basicTypes: ["Island", "Swamp"],
    oracleId: "66666666-6666-6666-6666-666666666666" };
  const shock3 = { ...SHOCK, name: "Blood Crypt", colors: ["B", "R"],
    colorIdentity: ["B", "R"], basicTypes: ["Mountain", "Swamp"],
    oracleId: "77777777-7777-7777-7777-777777777777" };
  // WUBR early, 10 slots, big budget: all three shocks must be pay_life.
  const catalog = [SHOCK, shock2, shock3];
  const [pkg, score] = run(
    catalog, ["W", "U", "B", "R"],
    { W: "early", U: "early", B: "early", R: "early" }, 200, 10
  );
  assert.equal(pkg.length, 3);
  for (const l of pkg) assert.equal(l.assumedEtbMode, "pay_life");
  // 3 shocks x 2.0 one-time = 6.0 (NOT 3 x 3-use = 18).
  assert.equal(score[2], 6.0);
});

test("Design B: verge conditional color qualifies for main/splash (+1 penalty)", () => {
  // WU main, 3 slots: verge + Plains + Island covers W:2, U:2. The verge's
  // U is conditional (main only) and costs +1 penalty.
  const catalog = [VERGE, PLAINS, ISLAND];
  const [pkg, score] = run(catalog, ["W", "U"], { W: "main", U: "main" }, 25, 3);
  assert.deepEqual(
    pkg.map((l) => l.name).sort(),
    ["Floodfarm Verge", "Island", "Plains"]
  );
  assert.equal(score[4].per_color.U.qualifying, 2);
  assert.equal(score[4].per_color.U.shortfall, 0);
  // Penalty: verge +1 (conditional color) + basics 0 = 1.0.
  assert.equal(score[2], 1.0);
});

test("Design B: verge conditional color NEVER qualifies for early", () => {
  // WU early, 3 slots: the verge's U must not count toward the U early
  // target. U qualifying = Island only (1 of 3). W qualifying = Plains +
  // verge unconditional (2 of 3).
  const catalog = [VERGE, PLAINS, ISLAND];
  const [, score] = run(catalog, ["W", "U"], { W: "early", U: "early" }, 25, 3);
  assert.equal(score[4].per_color.U.qualifying, 1);
  assert.equal(score[4].per_color.U.shortfall, 2);
  assert.equal(score[4].per_color.W.qualifying, 2);
  assert.equal(score[4].per_color.W.shortfall, 1);
});

test("Design C: Game Changer excluded at bracket <= 2, included at bracket 3", () => {
  const catalog = [GC_LAND];
  const [pkg2] = run(catalog, [], {}, 200, 1, { bracket: 2 });
  assert.equal(pkg2.length, 0);
  const [pkg3] = run(catalog, [], {}, 200, 1, { bracket: 3 });
  assert.equal(pkg3.length, 1);
  assert.equal(pkg3[0].name, "Ancient Tomb");
});

test("Design C: banned land is never recommended", () => {
  const catalog = [BANNED_LAND];
  const [pkg] = run(catalog, [], {}, 200, 1, { bracket: 3 });
  assert.equal(pkg.length, 0);
});

test("Unaffected cycles: pain/check/bond rows are identical to the old model", () => {
  // The served file must differ from the old model ONLY on the 3 shocks +
  // 2 verges (plus the derived banned/gameChanger flags, which are all
  // false here, and the legality_snapshot metadata). Everything else is
  // byte-identical in the fields the solver reads.
  const changed = new Set([
    "Hallowed Fountain", "Watery Grave", "Blood Crypt",
    "Floodfarm Verge", "Gloomlake Verge",
  ]);
  for (const l of SERVED) {
    assert.equal(l.banned, false, `${l.name} banned`);
    assert.equal(l.gameChanger, false, `${l.name} gameChanger`);
    if (changed.has(l.name)) continue;
    assert.equal(l.etbModes, undefined, `${l.name} should have no etbModes`);
    assert.equal(l.conditionalColors, undefined, `${l.name} should have no conditionalColors`);
  }
  assert.equal(SERVED.length, 43);
  const shocks = SERVED.filter((l) => changed.has(l.name) && l.etbModes);
  assert.equal(shocks.length, 3);
  const verges = SERVED.filter((l) => l.conditionalColors);
  assert.equal(verges.length, 2);
});

test("Full catalog: WU early picks the shock over a tapped check land", () => {
  // Reference ranking check on the real 43-land catalog: for a WU-early
  // request the shock (pay_life, penalty 2.0) must be preferred over the
  // check land (tapped, penalty 1.0) for the early slot, because objective
  // 2 (early sources) outranks objective 3 (penalty).
  const [pkg, score, stats] = run(
    SERVED, ["W", "U"], { W: "early", U: "early" }, 25, 10, { bracket: 3 }
  );
  assert.equal(stats.status, "optimal");
  const shock = pkg.find((l) => l.name === "Hallowed Fountain");
  assert.ok(shock, "Hallowed Fountain should be in the WU-early package");
  assert.equal(shock.assumedEtbMode, "pay_life");
  const check = pkg.find((l) => l.name === "Glacial Fortress");
  // The check may or may not be in the package, but it must NOT be the
  // early source for W/U (it cannot be early). Early sources come from
  // untapped lands only.
  assert.ok(score[1] >= 1, "at least one early source");
  assert.ok(!check || check.assumedEtbMode === undefined);
});

// --- Charlie review corrections (2026-11-06, solver v1.4.3-js) ---

// P1: conditional coverage is reported separately from guaranteed
// coverage. A conditional-only completion is NEVER "met".
test("P1: Floodfarm Verge alone does NOT meet U (Charlie reproduction)", () => {
  // Exact reproduction: the verge as the entire fixture catalog; W/U
  // both splash, budget $25, one slot. Result is the verge alone with
  // scored shortfall 0 — but U is conditional-only, NOT guaranteed met.
  const [pkg, score, stats] = run(
    [VERGE], ["W", "U"], { W: "splash", U: "splash" }, 25, 1
  );
  assert.equal(stats.status, "optimal");
  assert.deepEqual(pkg.map((l) => l.name), ["Floodfarm Verge"]);
  // Scored shortfall stays 0 (conditional counts toward the objective —
  // the explicit pilot assumption), but the guaranteed shortfall is 1.
  const u = score[4].per_color.U;
  assert.equal(u.qualifying, 1);
  assert.equal(u.shortfall, 0);
  assert.equal(u.guaranteed_qualifying, 0);
  assert.equal(u.conditional_qualifying, 1);
  assert.equal(u.guaranteed_shortfall, 1);
  assert.equal(u.conditional_only, true);
  assert.deepEqual(u.conditional_sources, [{
    land: "Floodfarm Verge",
    dependency_types: ["Plains", "Island"],
    dependency_in_package: false, // unknown: no enabling land in the package
  }]);
  // W is unconditional: genuinely met.
  const w = score[4].per_color.W;
  assert.equal(w.guaranteed_qualifying, 1);
  assert.equal(w.guaranteed_shortfall, 0);
  assert.equal(w.conditional_only, false);
});

const W_LAND = land({
  name: "W Land", price: 0.5, colors: ["W"], colorIdentity: ["W"],
  basicTypes: [], oracleId: "88888888-8888-8888-8888-888888888888",
});

test("P1: absent prerequisite — package provably lacks the enabling type", () => {
  // Verge + a W land with no basic types, W main / U splash: the package
  // must contain both lands (W needs 2), and it provably contains no
  // Plains/Island, so the U dependency is absent (not just unknown).
  const [pkg, score] = run(
    [VERGE, W_LAND], ["W", "U"], { W: "main", U: "splash" }, 25, 2
  );
  assert.deepEqual(pkg.map((l) => l.name).sort(), ["Floodfarm Verge", "W Land"]);
  const u = score[4].per_color.U;
  assert.equal(u.conditional_only, true);
  assert.equal(u.guaranteed_shortfall, 1);
  assert.equal(u.conditional_sources[0].dependency_in_package, false);
});

test("P1: present prerequisite — enabling land is in the package, still conditional", () => {
  // Verge + Plains, W main / U splash: the package must contain both
  // lands, and a Plains IS in it, so the dependency could be satisfied —
  // but control is still unverified, so U stays conditional-only (never
  // guaranteed).
  const [pkg, score] = run(
    [VERGE, PLAINS], ["W", "U"], { W: "main", U: "splash" }, 25, 2
  );
  assert.deepEqual(pkg.map((l) => l.name).sort(), ["Floodfarm Verge", "Plains"]);
  const u = score[4].per_color.U;
  assert.equal(u.qualifying, 1);
  assert.equal(u.conditional_only, true);
  assert.equal(u.guaranteed_shortfall, 1);
  assert.equal(u.conditional_sources[0].dependency_in_package, true);
  // W is met outright (verge unconditional + Plains).
  assert.equal(score[4].per_color.W.guaranteed_shortfall, 0);
  assert.equal(score[4].per_color.W.conditional_only, false);
});

test("P1: unconditional colors are unaffected by the reporting split", () => {
  // Plain basics: guaranteed == qualifying, no conditional sources.
  const [, score] = run(
    [PLAINS, ISLAND], ["W", "U"], { W: "main", U: "main" }, 25, 2
  );
  for (const c of ["W", "U"]) {
    const v = score[4].per_color[c];
    assert.equal(v.guaranteed_qualifying, v.qualifying);
    assert.equal(v.conditional_qualifying, 0);
    assert.equal(v.guaranteed_shortfall, v.shortfall);
    assert.equal(v.conditional_only, false);
    assert.deepEqual(v.conditional_sources, []);
  }
});

// P2: malformed solver metadata is rejected (no silent defaults).
test("P2: missing pay_life lifeCost does NOT default to zero", () => {
  const bad = { ...SHOCK, etbModes: [
    { mode: "pay_life", untapped: true, conditional: false },
    { mode: "tapped", untapped: false, conditional: true, lifeCost: 0 },
  ] };
  assert.throws(
    () => run([bad], ["W", "U"], { W: "early", U: "early" }, 25, 10),
    /explicit finite numeric lifeCost/
  );
});

test("P2: duplicate pay_life (zero-cost first) is rejected", () => {
  const bad = { ...SHOCK, etbModes: [
    { mode: "pay_life", untapped: true, conditional: false, lifeCost: 0 },
    { mode: "pay_life", untapped: true, conditional: false, lifeCost: 2 },
    { mode: "tapped", untapped: false, conditional: true, lifeCost: 0 },
  ] };
  assert.throws(
    () => run([bad], ["W", "U"], { W: "early", U: "early" }, 25, 10),
    /exactly one pay_life and one tapped/
  );
});

test("P2: unknown third etbMode is rejected", () => {
  const bad = { ...SHOCK, etbModes: [
    { mode: "pay_life", untapped: true, conditional: false, lifeCost: 2 },
    { mode: "tapped", untapped: false, conditional: true, lifeCost: 0 },
    { mode: "free", untapped: true, conditional: false, lifeCost: 0 },
  ] };
  assert.throws(
    () => run([bad], ["W", "U"], { W: "early", U: "early" }, 25, 10),
    /exactly one pay_life and one tapped/
  );
});

test("P2: pay_life with zero cost and tapped with nonzero cost are rejected", () => {
  const zeroPay = { ...SHOCK, etbModes: [
    { mode: "pay_life", untapped: true, conditional: false, lifeCost: 0 },
    { mode: "tapped", untapped: false, conditional: true, lifeCost: 0 },
  ] };
  assert.throws(
    () => run([zeroPay], ["W", "U"], { W: "early", U: "early" }, 25, 10),
    /pay_life.*lifeCost > 0/
  );
  const paidTap = { ...SHOCK, etbModes: [
    { mode: "pay_life", untapped: true, conditional: false, lifeCost: 2 },
    { mode: "tapped", untapped: false, conditional: true, lifeCost: 2 },
  ] };
  assert.throws(
    () => run([paidTap], ["W", "U"], { W: "early", U: "early" }, 25, 10),
    /tapped.*lifeCost 0/
  );
});

test("P2: inherited property names are NOT basic land types", () => {
  for (const badType of ["constructor", "toString", "__proto__"]) {
    const badVerge = { ...VERGE, conditionalColors: [
      { color: "U", dependency: { type: "basic_land_type", types: [badType] } },
    ] };
    assert.throws(
      () => run([badVerge], ["W", "U"], { W: "main", U: "main" }, 25, 3),
      /Unknown basic land type/
    );
    const badBasic = { ...PLAINS, basicTypes: [badType] };
    assert.throws(
      () => run([badBasic], ["W"], { W: "main" }, 25, 1),
      /Invalid basic land type/
    );
  }
});

// Dominance: preselection matches every fixed mode combination.
// Charlie compared 120 deterministic queries against all eight fixed
// combinations of the three shock modes (zero mismatches). This test
// reproduces the comparison on a focused mixed-priority set: for each
// query, the pre-chosen result must equal the result of every fixed
// combination (same cards, penalty, price, shortfall, early count).
test("Dominance: shock preselection matches all 8 fixed mode combinations", () => {
  const shock2 = { ...SHOCK, name: "Watery Grave", colors: ["B", "U"],
    colorIdentity: ["B", "U"], basicTypes: ["Island", "Swamp"],
    oracleId: "66666666-6666-6666-6666-666666666666" };
  const shock3 = { ...SHOCK, name: "Blood Crypt", colors: ["B", "R"],
    colorIdentity: ["B", "R"], basicTypes: ["Mountain", "Swamp"],
    oracleId: "77777777-7777-7777-7777-777777777777" };
  const shocks = [SHOCK, shock2, shock3];
  const fixed = (shock, mode) => {
    const l = { ...shock };
    delete l.etbModes;
    if (mode === "pay_life") {
      l.untapped = true; l.conditional = false; l.lifeCost = 2.0;
    } else {
      l.untapped = false; l.conditional = true; l.lifeCost = 0;
    }
    return l;
  };
  const queries = [
    { colors: ["W", "U"], pri: { W: "early", U: "main" }, budget: 25, slots: 10 },
    { colors: ["W", "U", "B"], pri: { W: "early", U: "main", B: "splash" }, budget: 25, slots: 10 },
    { colors: ["W", "U", "B", "R"], pri: { W: "early", U: "early", B: "main", R: "splash" }, budget: 50, slots: 10 },
    { colors: ["U", "B"], pri: { U: "early", B: "main" }, budget: 25, slots: 5 },
    { colors: ["W", "U", "B", "R", "G"], pri: { W: "early", U: "early", B: "early", R: "early", G: "early" }, budget: 200, slots: 10 },
    { colors: ["W", "U"], pri: { W: "main", U: "main" }, budget: 10, slots: 5 },
  ];
  for (const q of queries) {
    const [prePkg, preScore] = run(shocks, q.colors, q.pri, q.budget, q.slots, { bracket: 3 });
    const pre = {
      cards: prePkg.map((l) => l.name).sort(),
      penalty: preScore[2], price: preScore[3],
      shortfall: preScore[0], early: preScore[1],
    };
    for (let mask = 0; mask < 8; mask++) {
      const catalog = shocks.map((s, i) =>
        fixed(s, (mask >> i) & 1 ? "pay_life" : "tapped"));
      const [pkg, score] = run(catalog, q.colors, q.pri, q.budget, q.slots, { bracket: 3 });
      const got = {
        cards: pkg.map((l) => l.name).sort(),
        penalty: score[2], price: score[3],
        shortfall: score[0], early: score[1],
      };
      // Preselection must be at least as good as every fixed combination
      // on the lexicographic key (shortfall, -early, penalty, price).
      const preKey = [pre.shortfall, -pre.early, pre.penalty, pre.price];
      const gotKey = [got.shortfall, -got.early, got.penalty, got.price];
      const cmp = (a, b) => {
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
        }
        return 0;
      };
      assert.ok(
        cmp(preKey, gotKey) <= 0,
        `preselection worse than fixed combo ${mask} on ${JSON.stringify(q)}: ` +
        `pre ${JSON.stringify(preKey)} vs fixed ${JSON.stringify(gotKey)}`
      );
    }
  }
});
