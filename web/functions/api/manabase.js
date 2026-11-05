// GET /api/manabase?colors=WU&priorities={"W":"early","U":"main"}&budget=50&slots=10&opponents=3&bracket=3
//
// Phase 1 (preview): ManaBase solver API. Runs accepted solver v1.4.1-js
// against catalog seed v0.4.2 (43 eligible lands, scoring policy v1,
// price snapshot 2026-11-04). No UI yet — hardcoded test queries only.
//
// Params:
//   colors: string like "WU" (empty = colorless query)
//   priorities: JSON object like {"W":"early","U":"main"} (default: all "main")
//   budget: dollars (default 50)
//   slots: max lands (default 10)
//   opponents: 1 or 3 (default 3; drives bond-land evaluation per spec v4)
//   bracket: 1-5 (default 3; Game Changer gate)
//   maxNodes: override node budget (default 200000, provisional)
//
// Returns: { lands: [...], score, stats, meta }
import { OptimizedSolver, SOLVER_VERSION } from "./_solver_adapter.js";
import landData from "./_manabase_lands.json";

const DEFAULT_MAX_NODES = 200000; // provisional per calibration notes
const MAX_MAX_NODES = 1500000; // provisional extended cap

function jsonError(msg, status = 400) {
  return Response.json({ error: msg }, { status });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = url.searchParams;

  const colors = (q.get("colors") || "").toUpperCase().replace(/[^WUBRG]/g, "");
  let priorities = {};
  try {
    priorities = q.get("priorities") ? JSON.parse(q.get("priorities")) : {};
  } catch {
    return jsonError("priorities must be valid JSON");
  }
  const budget = parseFloat(q.get("budget") || "50");
  const slots = parseInt(q.get("slots") || "10", 10);
  const opponents = parseInt(q.get("opponents") || "3", 10);
  const bracket = parseInt(q.get("bracket") || "3", 10);
  const maxNodes = Math.min(
    parseInt(q.get("maxNodes") || String(DEFAULT_MAX_NODES), 10),
    MAX_MAX_NODES
  );

  if (!(budget > 0) || !(slots > 0) || ![1, 3].includes(opponents) ||
      !(bracket >= 1 && bracket <= 5)) {
    return jsonError("invalid params: budget>0, slots>0, opponents in {1,3}, bracket 1-5");
  }
  for (const [c, p] of Object.entries(priorities)) {
    if (!"WUBRG".includes(c) || !["early", "main", "splash"].includes(p)) {
      return jsonError(`invalid priority: ${c}=${p}`);
    }
  }

  // Strip price metadata the solver doesn't need (keep response lean).
  const lands = landData.lands.map((l) => ({
    name: l.name, price: l.price, colors: l.colors,
    colorIdentity: l.colorIdentity, basicTypes: l.basicTypes,
    untapped: l.untapped, conditional: l.conditional,
    productionConditional: l.productionConditional,
    lifeCost: l.lifeCost, utility: l.utility,
    banned: l.banned, gameChanger: l.gameChanger,
    producesColorless: l.producesColorless, oracleId: l.oracleId,
  }));

  let result;
  try {
    const solver = new OptimizedSolver(lands);
    const [pkg, score, stats] = solver.optimize(
      colors, priorities, budget, slots,
      { bracket, maxNodes, opponents }
    );
    result = { pkg, score, stats };
  } catch (e) {
    return jsonError(`solver error: ${e.message}`, 500);
  }

  const [pkg, score, stats] = [result.pkg, result.score, result.stats];
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
      earlySources: -score[1],
      penalty: score[2],
      priceDollars: score[3], // solver already returns dollars
    },
    stats: {
      status: stats.status,
      nodesVisited: stats.nodesVisited,
    },
    meta: {
      solver: SOLVER_VERSION,
      seed: landData.seed_version,
      scoringPolicy: landData.scoring_policy,
      priceSnapshot: landData.price_snapshot,
      landCount: landData.land_count,
      maxNodes,
      provisionalNote: "Node budgets provisional pending production calibration.",
    },
  });
}
