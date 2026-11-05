// GET /api/manabase?colors=WU&priorities={"W":"early","U":"main"}&budget=50&slots=10&opponents=3&bracket=3
//
// ManaBase solver API. Runs accepted solver v1.4.1-js against catalog seed
// v0.4.2 (43 eligible lands, scoring policy v1, price snapshot 2026-11-04).
// Preview only — no production approval.
//
// Params (all validated; invalid input → 400, never silently rewritten):
//   colors: string of WUBRG chars; EMPTY string = explicit colorless query
//   priorities: JSON object like {"W":"early","U":"main"} (default: all "main")
//   budget: dollars > 0 (default 50)
//   slots: integer 1-20 (default 10)
//   opponents: 1 or 3 (default 3; bond lands resolved pre-solver per context policy)
//   bracket: 1-5 (default 3; Game Changer gate)
//   maxNodes: node budget, clamped to [1, 1500000] (default 200000, provisional)
//
// Context resolution (before the unchanged solver):
//   - Bond lands (Sea of Clouds, Morphic Pool, Luxury Suite):
//     opponents=3 → untapped=true, conditional=false (known satisfied)
//     opponents=1 → untapped=false, conditional=false (known tapped, no uncertainty penalty)
//   - Bounce lands (Azorius Chancery, Dimir Aqueduct): HELD from solver
//     recommendations (no reviewed evaluator); remain gallery entries only.
//   - Fast/slow/check lands: entry unknown, no early credit, main/splash
//     production retained (per Charlie's context review).
//
// Returns: { lands, score, perColor, inputs, context, stats, meta }
import { OptimizedSolver, SOLVER_VERSION } from "./_solver_adapter.js";
import landData from "./_manabase_lands.json";

const DEFAULT_MAX_NODES = 200000; // provisional per calibration notes
const MAX_MAX_NODES = 1500000; // provisional extended cap

const BOND_LANDS = new Set(["Sea of Clouds", "Morphic Pool", "Luxury Suite"]);
const BOUNCE_LANDS = new Set(["Azorius Chancery", "Dimir Aqueduct"]);

function jsonError(msg, status = 400) {
  return Response.json({ error: msg }, { status });
}

function parseIntParam(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer ${min}-${max}`);
  }
  return n;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = url.searchParams;

  // ?list=all → full land catalog with prices (for the browse gallery).
  if (q.get("list") === "all") {
    return Response.json({
      lands: landData.lands.map((l) => ({
        name: l.name, price: l.price, pricePrinting: l.pricePrinting,
        colors: l.colors, untapped: l.untapped, conditional: l.conditional,
        lifeCost: l.lifeCost, producesColorless: l.producesColorless,
      })),
      meta: {
        seed: landData.seed_version,
        priceSnapshot: landData.price_snapshot,
        landCount: landData.land_count,
      },
    });
  }

  // ---- Explicit validation (no silent rewrites) ----
  const rawColors = q.get("colors") ?? "";
  if (/[^WUBRG]/.test(rawColors)) {
    return jsonError(
      `invalid colors: "${rawColors}" — use only W, U, B, R, G (empty = colorless)`
    );
  }
  // Deduplicate, preserve WUBRG order
  const colors = [...new Set(rawColors.split(""))].sort(
    (a, b) => "WUBRG".indexOf(a) - "WUBRG".indexOf(b)
  ).join("");

  let priorities = {};
  try {
    priorities = q.get("priorities") ? JSON.parse(q.get("priorities")) : {};
  } catch {
    return jsonError("priorities must be valid JSON, e.g. {\"W\":\"early\"}");
  }
  if (typeof priorities !== "object" || priorities === null || Array.isArray(priorities)) {
    return jsonError("priorities must be a JSON object");
  }
  for (const [c, p] of Object.entries(priorities)) {
    if (!"WUBRG".includes(c) || !["early", "main", "splash"].includes(p)) {
      return jsonError(`invalid priority: ${c}=${p} (color must be WUBRG, priority early/main/splash)`);
    }
    if (!colors.includes(c)) {
      return jsonError(`priority for ${c} but ${c} not in colors`);
    }
  }

  let budget, slots, opponents, bracket, maxNodes;
  try {
    budget = parseFloat(q.get("budget") ?? "50");
    if (!(budget > 0) || !Number.isFinite(budget)) throw new Error("budget must be a positive number");
    slots = parseIntParam(q.get("slots") ?? "10", "slots", 1, 20);
    opponents = parseIntParam(q.get("opponents") ?? "3", "opponents", 1, 3);
    if (![1, 3].includes(opponents)) throw new Error("opponents must be 1 or 3");
    bracket = parseIntParam(q.get("bracket") ?? "3", "bracket", 1, 5);
    maxNodes = Math.min(
      parseIntParam(q.get("maxNodes") ?? String(DEFAULT_MAX_NODES), "maxNodes", 1, MAX_MAX_NODES),
      MAX_MAX_NODES
    );
  } catch (e) {
    return jsonError(e.message);
  }

  // ---- Resolve opponent context BEFORE the unchanged solver ----
  // Bond lands: known entry state from the supplied opponent count.
  // Bounce lands: held from recommendations (no reviewed evaluator).
  const contextApplied = { opponents, bondResolved: [], bounceHeld: [] };
  const lands = [];
  for (const l of landData.lands) {
    if (BOUNCE_LANDS.has(l.name)) {
      contextApplied.bounceHeld.push(l.name);
      continue;
    }
    const land = {
      name: l.name, price: l.price, colors: l.colors,
      colorIdentity: l.colorIdentity, basicTypes: l.basicTypes,
      untapped: l.untapped, conditional: l.conditional,
      productionConditional: l.productionConditional,
      lifeCost: l.lifeCost, utility: l.utility,
      banned: l.banned, gameChanger: l.gameChanger,
      producesColorless: l.producesColorless, oracleId: l.oracleId,
    };
    if (BOND_LANDS.has(l.name)) {
      if (opponents === 3) {
        land.untapped = true;
        land.conditional = false; // known satisfied, no uncertainty penalty
      } else {
        land.untapped = false;
        land.conditional = false; // known tapped, not unknown context
      }
      contextApplied.bondResolved.push(
        `${l.name}: ${opponents === 3 ? "untapped (3 opponents)" : "tapped (1 opponent)"}`
      );
    }
    lands.push(land);
  }

  let result;
  try {
    // Effective node budget goes in the CONSTRUCTOR (not optimize options).
    const solver = new OptimizedSolver(lands, { maxNodes });
    const [pkg, score, stats] = solver.optimize(
      colors, priorities, budget, slots, { bracket }
    );
    result = { pkg, score, stats };
  } catch (e) {
    return jsonError(`solver error: ${e.message}`, 500);
  }

  const [pkg, score, stats] = [result.pkg, result.score, result.stats];
  const perColor = score[4]?.per_color ?? {};
  return Response.json({
    lands: pkg.map((l) => {
      const full = landData.lands.find((x) => x.oracleId === l.oracleId);
      return {
        name: l.name,
        price: full?.price ?? null,
        pricePrinting: full?.pricePrinting ?? null,
        lifeCost: l.lifeCost,
        colors: l.colors,
        untapped: l.untapped,
        conditional: l.conditional,
      };
    }),
    score: {
      weightedShortfall: score[0],
      earlySources: score[1], // solver already returns a positive count
      penalty: score[2],
      priceDollars: score[3], // solver already returns dollars
    },
    perColor,
    inputs: {
      colors: colors || "(colorless)",
      priorities,
      budget,
      slots,
      opponents,
      bracket,
      maxNodes,
    },
    context: contextApplied,
    stats: {
      status: stats.status,
      interruptReason: stats.interruptReason ?? null,
      nodesVisited: stats.nodesVisited,
    },
    meta: {
      solver: SOLVER_VERSION,
      seed: landData.seed_version,
      scoringPolicy: landData.scoring_policy,
      priceSnapshot: landData.price_snapshot,
      landCount: landData.land_count,
      servedLandCount: lands.length,
      provisionalNote: "Node budgets provisional pending production calibration.",
    },
  });
}
