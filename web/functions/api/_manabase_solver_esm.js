/**
 * Mana Base Solver — JavaScript port for Cloudflare Workers
 *
 * Faithful port of Charlie's OptimizedSolver (review-1.4.0, Python).
 *
 * Preserves:
 * - Exact decimal penalty precision (BigInt scaled integers, no float rounding)
 * - Exact monetary comparisons (integer cents)
 * - Strict 4-objective scoring order
 * - Alphabetical tie-breaking
 * - All four interruption statuses
 * - Full suffix-table bounds + weighted-gain bound
 * - Deterministic node/work budget (frozen-clock safe)
 *
 * Version: 1.4.2-js
 * Reference: solver_optimized.py (review-1.4.0)
 *
 * 1.4.2-js (2026-11-06, ManaBase Designs A/B — additive, search unchanged):
 * - Design A (shocks): a land with etbModes gets its mode resolved per
 *   request in the row builder (pre-chosen mode): pay_life when the land
 *   covers an early-priority color, else tapped. The 2-life cost is
 *   ONE-TIME (not multiplied by any use scenario). The chosen mode is
 *   recorded on the row and attached to returned lands as assumedEtbMode.
 *   Per-mode branching in the search was NOT implemented (it would require
 *   identity-aware DFS + suffix-table changes — a solver redesign); see the
 *   2026-11-06 handoff for the open question. The paid mode is an EXPLICIT
 *   scoring assumption, labeled in the API response — never a fact about
 *   what the player will do. A paid shock still enters tapped if another
 *   effect forces tapped (Lorwyn Eclipsed notes).
 * - Design B (verges): a land with conditionalColors qualifies for a
 *   conditional color at main/splash ONLY (never early), and carries a +1
 *   production-conditional penalty when selected. The dependency is
 *   unknown/conditional from deck context alone — never counted as
 *   guaranteed target completion.
 * - The four lexicographic objectives, their order, the search, the
 *   bounds, and the tie-break are unchanged.
 */

// ---------------------------------------------------------------------------
// Exact decimal handling (mirrors Python's Decimal)
// ---------------------------------------------------------------------------

/**
 * Parse a finite number to exact decimal {mantissa: BigInt, scale: number}
 * representing mantissa * 10^(-scale).
 * Throws on non-finite, NaN, or non-numeric input.
 */
function parseDecimal(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number, got ${value}`);
  }
  // Use string representation for exact decimal parsing
  const s = value.toString();
  // Handle exponential notation by expanding
  let str = s;
  if (/[eE]/.test(s)) {
    // Expand exponential to plain decimal via fixed notation
    // Use enough digits to be exact for reasonable inputs
    const [mant, exp] = s.split(/[eE]/);
    const expN = parseInt(exp, 10);
    const mantParts = mant.split('.');
    const digits = (mantParts[0] + (mantParts[1] || '')).replace('-', '');
    const isNeg = mant.startsWith('-');
    const dotPos = mantParts[0].replace('-', '').length + expN;
    let result;
    if (dotPos <= 0) {
      result = '0.' + '0'.repeat(-dotPos) + digits;
    } else if (dotPos >= digits.length) {
      result = digits + '0'.repeat(dotPos - digits.length);
    } else {
      result = digits.slice(0, dotPos) + '.' + digits.slice(dotPos);
    }
    str = (isNeg ? '-' : '') + result;
  }
  const neg = str.startsWith('-');
  const clean = neg ? str.slice(1) : str;
  const parts = clean.split('.');
  const intPart = parts[0] || '0';
  const fracPart = parts[1] || '';
  const mantissa = BigInt(intPart + fracPart || '0');
  return { mantissa: neg ? -mantissa : mantissa, scale: fracPart.length };
}

/** Scale a parsed decimal to a target scale, returning BigInt. */
function scaleTo(parsed, targetScale) {
  if (targetScale < parsed.scale) {
    throw new Error('Target scale smaller than parsed scale — precision loss');
  }
  return parsed.mantissa * (10n ** BigInt(targetScale - parsed.scale));
}

// ---------------------------------------------------------------------------
// Money: integer cents
// ---------------------------------------------------------------------------

function toCents(value) {
  const p = parseDecimal(value, 'price/budget');
  let cents;
  if (p.scale <= 2) {
    cents = scaleTo(p, 2);
  } else {
    // Check that digits beyond 2 decimal places are all zero
    const extra = p.mantissa % (10n ** BigInt(p.scale - 2));
    if (extra !== 0n) {
      throw new Error(
        `Prices and budget must be finite, nonnegative whole cents (got ${value})`
      );
    }
    cents = p.mantissa / (10n ** BigInt(p.scale - 2));
  }
  if (cents < 0n) {
    throw new Error(`Prices and budget must be nonnegative (got ${value})`);
  }
  return Number(cents);
}

// ---------------------------------------------------------------------------
// Input validation (mirrors Python)
// ---------------------------------------------------------------------------

const WEIGHTS = { early: 3, main: 2, splash: 1 };
const BRACKET3_GC_MAX = 3;
const VALID_COLORS = new Set(['W', 'U', 'B', 'R', 'G']);

function targetFor(priority, slots) {
  if (priority === 'early') return Math.min(slots, 3);
  if (priority === 'main') return Math.min(slots, 2);
  if (priority === 'splash') return 1;
  throw new Error(`Unknown priority: ${priority}`);
}

function validateLand(land) {
  if (typeof land.name !== 'string' || !land.name) {
    throw new Error('Land must have a non-empty string name');
  }
  if (typeof land.conditional !== 'boolean') {
    throw new Error(
      `conditional must be bool, got ${typeof land.conditional} for land '${land.name}'`
    );
  }
  if (typeof land.productionConditional !== 'boolean') {
    throw new Error(
      `productionConditional must be bool, got ${typeof land.productionConditional} ` +
      `for land '${land.name}'. Use explicit boolean values.`
    );
  }
  if (typeof land.untapped !== 'boolean') {
    throw new Error(`untapped must be bool for land '${land.name}'`);
  }
  if (typeof land.banned !== 'boolean') {
    throw new Error(`banned must be bool for land '${land.name}'`);
  }
  if (typeof land.gameChanger !== 'boolean') {
    throw new Error(`gameChanger must be bool for land '${land.name}'`);
  }
  if (typeof land.producesColorless !== 'boolean') {
    throw new Error(`producesColorless must be bool for land '${land.name}'`);
  }
  // Numeric fields must be finite
  parseDecimal(land.price, `price for '${land.name}'`);
  parseDecimal(land.lifeCost ?? 0, `lifeCost for '${land.name}'`);
  parseDecimal(land.utility ?? 0, `utility for '${land.name}'`);
  // colors must be array of valid color letters
  for (const c of land.colors || []) {
    if (!VALID_COLORS.has(c)) {
      throw new Error(`Invalid color '${c}' in colors for land '${land.name}'`);
    }
  }
  // Design A: etbModes (shocks) — both modes, payment already resolved by
  // the converter; the solver only reads them. Must carry exactly the
  // pay_life and tapped modes with boolean untapped/conditional and a
  // finite non-negative lifeCost.
  if (land.etbModes !== undefined && land.etbModes !== null) {
    if (!Array.isArray(land.etbModes)) {
      throw new Error(`etbModes must be an array for land '${land.name}'`);
    }
    const modes = land.etbModes.map((m) => m && m.mode);
    if (!modes.includes("pay_life") || !modes.includes("tapped")) {
      throw new Error(
        `etbModes for land '${land.name}' must include pay_life and tapped modes`
      );
    }
    for (const m of land.etbModes) {
      if (typeof m.untapped !== "boolean" || typeof m.conditional !== "boolean") {
        throw new Error(
          `etbModes mode '${m.mode}' for land '${land.name}' needs boolean untapped/conditional`
        );
      }
      parseDecimal(m.lifeCost ?? 0, `etbModes lifeCost for '${land.name}'`);
      if ((m.lifeCost ?? 0) < 0) {
        throw new Error(`etbModes lifeCost must be nonnegative for land '${land.name}'`);
      }
    }
  }
  // Design B: conditionalColors (verges) — each entry is one color plus a
  // basic_land_type dependency with known types.
  if (land.conditionalColors !== undefined && land.conditionalColors !== null) {
    if (!Array.isArray(land.conditionalColors)) {
      throw new Error(`conditionalColors must be an array for land '${land.name}'`);
    }
    const typeMap = { Plains: 1, Island: 1, Swamp: 1, Mountain: 1, Forest: 1 };
    for (const cc of land.conditionalColors) {
      if (!VALID_COLORS.has(cc.color)) {
        throw new Error(
          `Invalid conditional color '${cc.color}' for land '${land.name}'`
        );
      }
      if (!cc.dependency || cc.dependency.type !== "basic_land_type" ||
          !Array.isArray(cc.dependency.types) || !cc.dependency.types.length) {
        throw new Error(
          `conditionalColors for land '${land.name}' needs a basic_land_type dependency`
        );
      }
      for (const t of cc.dependency.types) {
        if (!typeMap[t]) {
          throw new Error(
            `Unknown basic land type '${t}' in conditionalColors for land '${land.name}'`
          );
        }
      }
    }
  }
}

function validateInputs(colors, priorities, slots) {
  if (!Number.isInteger(slots) || slots < 1 || slots > 10) {
    throw new Error('slots must be an integer from 1 through 10');
  }
  const colorArr = colors ? [...colors] : [];
  if (new Set(colorArr).size !== colorArr.length) {
    throw new Error('colors must contain distinct letters');
  }
  for (const c of colorArr) {
    if (!VALID_COLORS.has(c)) {
      throw new Error(`Invalid color '${c}'. Must be one of W, U, B, R, G.`);
    }
  }
  for (const [c, p] of Object.entries(priorities || {})) {
    if (!colorArr.includes(c)) {
      throw new Error(`Priority given for unselected color '${c}'`);
    }
    if (!(p in WEIGHTS)) {
      throw new Error(`Invalid priority '${p}' for color '${c}'. Must be early, main, or splash.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

class OptimizedSolver {
  constructor(catalog, options = {}) {
    this.catalog = catalog;
    this.rulesVersion = options.rulesVersion || '4.0';
    this.timeLimit = options.timeLimit ?? null; // seconds, null = no limit
    this.maxNodes = options.maxNodes ?? null;   // deterministic work budget
    this.memoLimit = options.memoLimit || 50000;
    // Clock injection for testing (frozen clock support)
    this._now = options.clock || (() => Date.now());
  }

  checkEligibility(land, colors, bracket) {
    const colorsSet = new Set(colors);
    for (const c of land.colorIdentity || []) {
      if (!colorsSet.has(c)) return [false, 'color_identity'];
    }
    const typeMap = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
    for (const t of land.basicTypes || []) {
      const c = typeMap[t];
      if (c && !colorsSet.has(c)) return [false, 'basic_land_type'];
    }
    if (land.banned) return [false, 'banned'];
    if (land.gameChanger && bracket <= 2) return [false, 'game_changer'];
    return [true, 'ok'];
  }

  // Design A: resolve a shock's ETB mode for this request (pre-chosen
  // mode, per land, before the search). pay_life when the land covers any
  // axis whose priority is early; otherwise tapped. The paid mode is an
  // explicit scoring assumption (see the header note) — the actual entry
  // choice is the player's, and a paid shock still enters tapped if
  // another effect forces tapped. Returns {mode, untapped, conditional,
  // lifeCost} or null for lands without etbModes.
  resolveEtbMode(land, priorities, axes) {
    const modes = land.etbModes;
    if (!modes || !modes.length) return null;
    const pay = modes.find((m) => m.mode === "pay_life");
    const tap = modes.find((m) => m.mode === "tapped");
    if (!pay || !tap) return null;
    const coversEarly = (land.colors || []).some((c) =>
      axes.includes(c) && (priorities[c] || "main") === "early"
    );
    const chosen = coversEarly ? pay : tap;
    return {
      mode: chosen.mode,
      untapped: chosen.untapped,
      conditional: chosen.conditional,
      lifeCost: chosen.lifeCost ?? 0,
    };
  }

  qualifiesFor(land, color, priority) {
    if (land.productionConditional) return false;
    if ((land.colors || []).includes(color)) {
      if (priority === "early") {
        return land.untapped && !land.conditional;
      }
      return true;
    }
    // Design B: a conditional color qualifies for main/splash ONLY — never
    // early. The dependency is unknown/conditional from deck context alone;
    // it is never counted as guaranteed target completion for early.
    if (priority !== "early") {
      for (const cc of land.conditionalColors || []) {
        if (cc.color === color) return true;
      }
    }
    return false;
  }

  qualifiesColorless(land) {
    if (land.productionConditional) return false;
    return !!land.producesColorless;
  }

  optimize(colors, priorities, budget, slots, options = {}) {
    validateInputs(colors, priorities, slots);
    const start = this._now();
    const deadline = this.timeLimit == null ? Infinity : start + this.timeLimit * 1000;
    const bracket = options.bracket ?? 2;
    const owned = new Set(options.owned || []);

    const budgetCents = toCents(budget);
    const colorArr = colors ? [...colors] : [];
    const axes = colorArr.length ? colorArr : ['C'];
    const targets = axes.map(c =>
      colorArr.length ? targetFor(priorities[c] || 'main', slots) : Math.min(slots, 2)
    );
    const weights = axes.map(c =>
      colorArr.length ? WEIGHTS[priorities[c] || 'main'] : 2
    );

    // Validate and build candidate rows
    const rows = [];
    // Collect penalty scales for exact BigInt conversion
    const penaltyParsed = [];
    for (const land of this.catalog) {
      validateLand(land);
      if (owned.has(land.oracleId) || owned.has(land.name)) continue;
      if (!this.checkEligibility(land, colorArr, bracket)[0]) continue;
      const price = toCents(land.price);
      if (price > budgetCents) continue;

      // Design A: resolve a shock's ETB mode for this request (pre-chosen
      // mode). The effective land view carries the mode's untapped /
      // conditional / lifeCost for qualification, early credit and penalty.
      // The original land object is kept for the returned package; the
      // assumed mode is recorded on the row and surfaced by finish().
      const etb = this.resolveEtbMode(land, priorities, axes);
      const eff = etb
        ? { ...land, untapped: etb.untapped, conditional: etb.conditional,
            lifeCost: etb.lifeCost }
        : land;

      const qualifies = axes.map(c =>
        colorArr.length
          ? (this.qualifiesFor(eff, c, priorities[c] || 'main') ? 1 : 0)
          : (this.qualifiesColorless(eff) ? 1 : 0)
      );
      const early = (eff.untapped && !eff.conditional && !eff.productionConditional &&
        (colorArr.length
          ? axes.some((c, i) => (priorities[c] || 'main') === 'early' && qualifies[i])
          : this.qualifiesColorless(eff))) ? 1 : 0;

      // Exact penalty: life_cost + conditional + prod_cond
      //   + conditional_color (Design B: +1 when the land carries a
      //     conditional color) - utility.
      // The +1 is charged whenever a verge is selected (a conservative
      // simplification: the solver's penalty is per-land, not per-color).
      const lc = parseDecimal(eff.lifeCost ?? 0, 'lifeCost');
      const ut = parseDecimal(eff.utility ?? 0, 'utility');
      const condInt = eff.conditional ? 1 : 0;
      const prodInt = eff.productionConditional ? 1 : 0;
      const condColorInt = (land.conditionalColors && land.conditionalColors.length) ? 1 : 0;
      penaltyParsed.push({ land, price, qualifies, early, lc, ut, condInt, prodInt,
        condColorInt, gameChanger: land.gameChanger ? 1 : 0,
        assumedMode: etb ? etb.mode : null,
        effUntapped: eff.untapped, effConditional: eff.conditional,
        effLifeCost: eff.lifeCost ?? 0 });
    }

    // Find max scale across all penalty components for exact BigInt math
    let maxScale = 0;
    for (const p of penaltyParsed) {
      maxScale = Math.max(maxScale, p.lc.scale, p.ut.scale);
    }
    for (const p of penaltyParsed) {
      const penaltyBig =
        scaleTo(p.lc, maxScale) + BigInt(p.condInt + p.prodInt + p.condColorInt) * (10n ** BigInt(maxScale))
        - scaleTo(p.ut, maxScale);
      rows.push({
        land: p.land, price: p.price, qualifies: p.qualifies, early: p.early,
        penalty: penaltyBig, gameChanger: p.gameChanger,
        assumedMode: p.assumedMode,
        effUntapped: p.effUntapped, effConditional: p.effConditional,
        effLifeCost: p.effLifeCost,
      });
    }
    this._penaltyScale = maxScale;

    // Sort heuristic (does not affect correctness)
    rows.sort((a, b) => {
      if (a.early !== b.early) return b.early - a.early;
      if (a.penalty !== b.penalty) return a.penalty < b.penalty ? -1 : 1;
      if (a.price !== b.price) return a.price - b.price;
      return a.land.name < b.land.name ? -1 : (a.land.name > b.land.name ? 1 : 0);
    });

    const n = rows.length;
    const k = Math.min(slots, n);

    const stats = {
      engineVersion: '1.4.2-js',
      rulesVersion: this.rulesVersion,
      candidates: n,
      nodesVisited: 0,
      prunedBound: 0,
      prunedMemo: 0,
      prunedBudget: 0,
      prunedGc: 0,
      memoStates: 0,
      scoringModel: 'static_per_land',
      money: 'integer_cents',
      penalty: 'exact_decimal',
    };

    let bestKey = null; // [ws, -ue, penaltyBig, priceCents, namesStr]
    let bestIndices = null;
    let interrupted = false;
    let interruptReason = null;
    const memo = new Map();

    const ws = (coverage) =>
      weights.reduce((sum, w, i) => sum + w * (targets[i] - coverage[i]), 0);

    const compareKeys = (a, b) => {
      if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
      if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
      if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
      if (a[3] !== b[3]) return a[3] < b[3] ? -1 : 1;
      return a[4] < b[4] ? -1 : (a[4] > b[4] ? 1 : 0);
    };

    const consider = (indices, coverage, ue, penalty, price) => {
      if (!indices.length) return;
      const names = indices.map(i => rows[i].land.name).sort().join('\0');
      const key = [ws(coverage), -ue, penalty, price, names];
      if (!bestKey || compareKeys(key, bestKey) < 0) {
        bestKey = key;
        bestIndices = [...indices];
      }
    };

    // Interruption check: wall-clock OR deterministic node budget
    const isExpired = () => {
      if (interrupted) return true;
      if (this.maxNodes != null && stats.nodesVisited >= this.maxNodes) {
        interrupted = true;
        interruptReason = 'node_budget';
        return true;
      }
      if (this._now() >= deadline) {
        interrupted = true;
        interruptReason = 'time_limit';
        return true;
      }
      return false;
    };

    const penaltyToNumber = (big) => Number(big) / (10 ** maxScale);

    const finish = () => {
      // Returned lands are COPIES with the assumed ETB mode applied, so the
      // API response is truthful about what was scored: a pay_life shock
      // reports untapped + lifeCost 2.0 and assumedEtbMode "pay_life"; a
      // tapped shock reports conditional + lifeCost 0 and "tapped". The
      // input catalog objects are never mutated.
      const pkg = bestIndices ? bestIndices.map(i => {
        const r = rows[i];
        if (!r.assumedMode) return r.land;
        return { ...r.land, untapped: r.effUntapped, conditional: r.effConditional,
          lifeCost: r.effLifeCost, assumedEtbMode: r.assumedMode };
      }) : [];
      const status = interrupted
        ? (bestIndices ? 'best_found' : 'interrupted_without_result')
        : (bestIndices ? 'optimal' : 'empty_proven');
      stats.status = status;
      stats.interrupted = interrupted;
      stats.interruptReason = interruptReason;
      stats.optimal = !interrupted;
      stats.emptyResult = pkg.length === 0;
      stats.elapsed = (this._now() - start) / 1000;
      stats.memoStates = memo.size;

      let score;
      if (bestKey) {
        const perColor = {};
        axes.forEach((c, i) => {
          const q = bestIndices.reduce((s, idx) => s + rows[idx].qualifies[i], 0);
          perColor[c] = { target: targets[i], qualifying: q, shortfall: Math.max(0, targets[i] - q) };
        });
        score = [bestKey[0], -bestKey[1], penaltyToNumber(bestKey[2]), bestKey[3] / 100,
          { cards: bestKey[4].split('\0'), total_price: bestKey[3] / 100, per_color: perColor }];
      } else {
        const perColor = {};
        axes.forEach((c, i) => {
          perColor[c] = { target: targets[i], qualifying: 0, shortfall: targets[i] };
        });
        const totalWs = weights.reduce((s, w, i) => s + w * targets[i], 0);
        score = [totalWs, 0, 0, 0, { cards: [], total_price: 0, per_color: perColor }];
      }
      return [pkg.sort((a, b) => a.name < b.name ? -1 : 1), score, stats];
    };

    if (isExpired()) return finish();
    if (!n) return finish();

    // ---- Greedy seed ----
    {
      const selected = [];
      let coverage = new Array(axes.length).fill(0);
      let ue = 0, penalty = 0n, price = 0, gc = 0;
      for (let s = 0; s < k; s++) {
        if (isExpired()) return finish();
        let bestOpt = null;
        for (let i = 0; i < n; i++) {
          if (selected.includes(i)) continue;
          const r = rows[i];
          if (price + r.price > budgetCents) continue;
          if (bracket === 3 && gc + r.gameChanger > BRACKET3_GC_MAX) continue;
          const nc = coverage.map((c, j) => Math.min(targets[j], c + r.qualifies[j]));
          const names = [...selected.map(j => rows[j].land.name), r.land.name].sort().join('\0');
          const key = [ws(nc), -(ue + r.early), penalty + r.penalty, price + r.price, names];
          if (!bestOpt || compareKeys(key, bestOpt[0]) < 0) bestOpt = [key, i, nc];
        }
        if (!bestOpt) break;
        const [, i, nc] = bestOpt;
        const r = rows[i];
        selected.push(i);
        coverage = nc;
        ue += r.early; penalty += r.penalty; price += r.price; gc += r.gameChanger;
        consider(selected, coverage, ue, penalty, price);
      }
    }

    // ---- Suffix tables (ported from Python) ----
    // costs[i][r][e], pens[i][r][e], penCosts[i][r][e]: optimistic bounds
    const INF = Infinity;
    const costs = new Array(n + 1);
    const pens = new Array(n + 1);
    const penCosts = new Array(n + 1);
    const mkTable = () => Array.from({ length: k + 1 }, () => new Array(k + 1).fill(INF));
    const mkPenTable = () => Array.from({ length: k + 1 }, () => new Array(k + 1).fill(null)); // BigInt or null
    costs[n] = mkTable(); pens[n] = mkPenTable(); penCosts[n] = mkTable();
    costs[n][0][0] = 0; pens[n][0][0] = 0n; penCosts[n][0][0] = 0;

    const counts = new Array(n + 1);
    counts[n] = new Array(axes.length).fill(0);
    const earlyCounts = new Array(n + 1).fill(0);
    const suffixNames = new Array(n + 1);
    suffixNames[n] = [];

    for (let i = n - 1; i >= 0; i--) {
      if (isExpired()) return finish();
      const r = rows[i];
      costs[i] = costs[i + 1].map(row => [...row]);
      pens[i] = pens[i + 1].map(row => [...row]);
      penCosts[i] = penCosts[i + 1].map(row => [...row]);
      const maxR = Math.min(k, n - i);
      for (let rr = 1; rr <= maxR; rr++) {
        for (let e = 0; e <= rr; e++) {
          const priorE = e - r.early;
          if (priorE < 0 || priorE > rr - 1) continue;
          const cPrev = costs[i + 1][rr - 1][priorE];
          if (cPrev !== INF) {
            costs[i][rr][e] = Math.min(costs[i][rr][e], r.price + cPrev);
          }
          const pPrev = pens[i + 1][rr - 1][priorE];
          if (pPrev !== null) {
            const addedPen = r.penalty + pPrev;
            const addedCost = r.price + penCosts[i + 1][rr - 1][priorE];
            if (pens[i][rr][e] === null || addedPen < pens[i][rr][e]) {
              pens[i][rr][e] = addedPen;
              penCosts[i][rr][e] = addedCost;
            } else if (addedPen === pens[i][rr][e]) {
              penCosts[i][rr][e] = Math.min(penCosts[i][rr][e], addedCost);
            }
          }
        }
      }
      counts[i] = counts[i + 1].map((c, j) => c + r.qualifies[j]);
      earlyCounts[i] = earlyCounts[i + 1] + r.early;
      suffixNames[i] = [...suffixNames[i + 1], r.land.name].sort().slice(0, k);
    }

    // ---- Weighted-gain suffix tables (slot competition bound) ----
    const gainSums = new Map();
    const numMasks = 1 << axes.length;
    for (let mask = 1; mask < numMasks; mask++) {
      if (isExpired()) return finish();
      const suffix = new Array(n + 1);
      suffix[n] = [0];
      let top = [];
      for (let i = n - 1; i >= 0; i--) {
        let gain = 0;
        for (let j = 0; j < axes.length; j++) {
          if (mask & (1 << j)) gain += weights[j] * rows[i].qualifies[j];
        }
        top = [...top, gain].sort((a, b) => b - a).slice(0, k);
        const prefix = [0];
        for (const v of top) prefix.push(prefix[prefix.length - 1] + v);
        suffix[i] = prefix;
      }
      gainSums.set(mask, suffix);
    }

    // ---- DFS with full bounds ----
    const partial = [];

    const dfs = (index, coverage, ue, penalty, price, gc) => {
      if (isExpired()) return true;
      stats.nodesVisited++;
      // Re-check node budget after increment (deterministic interruption)
      if (this.maxNodes != null && stats.nodesVisited >= this.maxNodes) {
        interrupted = true;
        interruptReason = 'node_budget';
        return true;
      }
      consider(partial, coverage, ue, penalty, price);

      let remaining = Math.min(k - partial.length, n - index);
      if (!remaining) return false;

      const available = budgetCents - price;
      // Budget bound: max picks affordable
      let maxAffordable = 0;
      for (let r = remaining; r >= 0; r--) {
        let minCost = INF;
        for (let e = 0; e <= r; e++) {
          if (costs[index][r][e] < minCost) minCost = costs[index][r][e];
        }
        if (minCost <= available) { maxAffordable = r; break; }
      }
      remaining = maxAffordable;
      if (remaining === 0) { stats.prunedBudget++; return false; }

      const shortfalls = targets.map((t, j) => t - coverage[j]);
      const currentWs = ws(coverage);

      // Bound 1: per-color availability
      let lowerWs = 0;
      for (let j = 0; j < axes.length; j++) {
        const s = shortfalls[j];
        if (s <= 0) continue;
        const p = counts[index][j];
        lowerWs += weights[j] * Math.max(0, s - Math.min(remaining, p));
      }
      // Bound 2: weighted gain (slot competition)
      let mask = 0;
      for (let j = 0; j < axes.length; j++) {
        if (shortfalls[j] > 0) mask |= (1 << j);
      }
      const gains = mask ? gainSums.get(mask)[index] : new Array(remaining + 1).fill(0);
      lowerWs = Math.max(lowerWs, currentWs - (gains[remaining] || 0));

      const upperUe = ue + Math.min(remaining, earlyCounts[index]);

      if (bestKey) {
        if (lowerWs > bestKey[0] ||
            (lowerWs === bestKey[0] && upperUe < -bestKey[1])) {
          stats.prunedBound++;
          return false;
        }
        if (lowerWs === bestKey[0] && upperUe === -bestKey[1]) {
          const needEarly = Math.max(0, -bestKey[1] - ue);
          const reduction = Math.max(0, currentWs - bestKey[0]);
          const maxGain = mask ? (gains[1] || 0) : 0;
          let minPicks = needEarly;
          if (maxGain > 0) {
            minPicks = Math.max(minPicks, Math.ceil(reduction / maxGain));
          } else if (reduction > 0) {
            // Cannot reduce shortfall; bound already handled
          }
          if (bestKey[0] === 0) {
            minPicks = Math.max(minPicks, ...shortfalls.map(s => Math.max(0, s)));
          }
          // Find feasible (r, e) completions
          let lowerPen = null;
          let lowerCostForPen = INF;
          for (let r = minPicks; r <= remaining; r++) {
            for (let e = needEarly; e <= r; e++) {
              if (costs[index][r][e] > available) continue;
              const p = pens[index][r][e];
              if (p === null) continue;
              const totalPen = penalty + p;
              if (lowerPen === null || totalPen < lowerPen) {
                lowerPen = totalPen;
                lowerCostForPen = price + penCosts[index][r][e];
              } else if (totalPen === lowerPen) {
                lowerCostForPen = Math.min(lowerCostForPen, price + penCosts[index][r][e]);
              }
            }
          }
          if (lowerPen === null) { stats.prunedBound++; return false; }
          if (lowerPen > bestKey[2]) { stats.prunedBound++; return false; }
          if (lowerPen === bestKey[2]) {
            if (lowerCostForPen > bestKey[3]) { stats.prunedBound++; return false; }
            if (lowerCostForPen === bestKey[3]) {
              const names = partial.map(idx => rows[idx].land.name);
              // Optimistic alphabetical bound
              let lowerNames = null;
              for (let r = minPicks; r <= remaining; r++) {
                for (let e = needEarly; e <= r; e++) {
                  if (costs[index][r][e] > available) continue;
                  const p = pens[index][r][e];
                  if (p === null || penalty + p > bestKey[2]) continue;
                  if (price + penCosts[index][r][e] > bestKey[3]) continue;
                  const cand = [...names, ...suffixNames[index].slice(0, r)].sort().join('\0');
                  if (lowerNames === null || cand < lowerNames) lowerNames = cand;
                }
              }
              if (lowerNames !== null && lowerNames >= bestKey[4]) {
                stats.prunedBound++;
                return false;
              }
            }
          }
        }
      }

      // Memoization
      const stateKey = `${index}|${partial.length}|${coverage.join(',')}|${ue}|${gc}`;
      const names = partial.map(idx => rows[idx].land.name).sort().join('\0');
      const frontier = memo.get(stateKey) || [];
      for (const [oc, op, on] of frontier) {
        if (oc <= price && op <= penalty &&
            (oc < price || op < penalty || on <= names)) {
          stats.prunedMemo++;
          return false;
        }
      }
      if (memo.size < this.memoLimit) {
        const filtered = frontier.filter(([c, p, nm]) =>
          !(price <= c && penalty <= p && (price < c || penalty < p || names <= nm)));
        filtered.push([price, penalty, names]);
        memo.set(stateKey, filtered);
      }

      for (let i = index; i < n; i++) {
        const r = rows[i];
        if (price + r.price > budgetCents) { stats.prunedBudget++; continue; }
        if (bracket === 3 && gc + r.gameChanger > BRACKET3_GC_MAX) {
          stats.prunedGc++; continue;
        }
        const nc = coverage.map((c, j) => Math.min(targets[j], c + r.qualifies[j]));
        partial.push(i);
        if (dfs(i + 1, nc, ue + r.early, penalty + r.penalty,
                price + r.price, gc + r.gameChanger)) return true;
        partial.pop();
        if (interrupted) return true;
      }
      return false;
    };

    dfs(0, new Array(axes.length).fill(0), 0, 0n, 0, 0);
    return finish();
  }
}

export { OptimizedSolver, toCents, parseDecimal };
export const SOLVER_VERSION = '1.4.2-js';
