// GET /api/manabase-search?colors=WU&sort=best_budget&type=two_color_fixing&limit=50&offset=0
//     &include_basics=1&max_price=25&untapped_only=0&game_changer=any&cycle=shock
//
// ManaBase land SEARCH API. Serves the full-catalog search data (1,202 rows:
// 1,053 verified + 48 utility display-only + 101 double-faced/adventure face
// rows; price snapshot 2026-11-06; 10 fetchlands held).
// Preview only — no production approval.
//
// Color match semantics (decided in Phase 3; the plan left this open):
// two DISTINCT modes (Charlie's plan correction #1, Nov 6/7).
//   mode=produces (default) — "produces these colors": a land matches if it
//     produces AT LEAST ONE of the requested colors, unconditionally OR
//     conditionally (CEO decision, Nov 6). Command Tower matches every color
//     search; a WUB land matches a WU search. Lands that produce no colored
//     mana at all match ONLY on an explicit colorless request (C).
//     A conditional match is a "may produce" result, never a guaranteed
//     source — the row carries the dependency and the UI shows it.
//   mode=fits — "fits my commander" (CR 903.5c/d): the WHOLE-CARD color
//     identity must be a subset of the requested colors AND every basic land
//     type must produce a color in the requested set. A colorless request
//     (C, no colors) matches only empty-CI, no-basic-type rows.
// The plan's original `colors_produced ⊆ requested` test is NOT CR 903.5c
// and is not used anywhere here.
//
// Sorting:
//   best_budget (Q14 interim, Charlie Nov 7) — "Best budget — researched":
//     an editorial sort by land TYPE from community + official research.
//     Requires a `type` (e.g. type=two_color_fixing). Within the selected
//     type, default-ranked eligible rows come first by editorial rank; ties
//     by actual selected price, normalized name, then Oracle ID. Members of
//     the type without a default rank follow alphabetically (their rank is
//     null — unreviewed is not worst quality). Ranks are priorities INSIDE
//     one type, never global power scores — there is no cross-type order.
//     Preorder-only cards are never ranked (their released quote exceeds the
//     $5.00 gate); they appear in the alphabetical remainder with their
//     preorder flag, and in meta.preorderWatch.
//   most_used / inclusion are still rejected with a 400: most-used ranking
//     data does NOT exist yet (Q3 — EDHREC terms with Charlie; NOT cleared
//     Nov 6/7). Most-used numbers are never faked.
//   price_asc (default) · price_desc · name.
//
// Params (all validated; invalid input → 400, never silently rewritten):
//   colors: string of WUBRG chars + optional C (colorless-only); absent = all
//   mode: produces (default) · fits
//   sort: price_asc (default) · price_desc · name · best_budget
//   type: a type id from meta.budgetTypes (e.g. two_color_fixing); required
//     for sort=best_budget; without a sort it restricts to that type's members
//   include_basics: 1/0 (default 1 — Q1, Val Nov 6: basics shown by default)
//   max_price: number ≥ 0 (cheapest RELEASED price must be ≤ this)
//   untapped_only: 1/0 (default 0; conditional entry is NOT untapped; a
//     transform-back land is NOT an untapped land drop — its land face is
//     reached by transformation, so it is excluded here too)
//   game_changer: any (default) · include · exclude
//   cycle: cycle id from the data (e.g. shock, check, gainland, unclassified)
//   limit: integer 1–100 (default 50; >100 clamps to 100)
//   offset: integer ≥ 0 (default 0)
//
// Returns: { meta, results } — meta always carries the price snapshot date,
// the ranking snapshot + note, the served/held counts, the budget type list,
// and per-cycle membership counts + price ranges (cycleCounts), so the UI
// can show staleness honestly and the Browse tab can show true full counts
// without loading all 1,202 rows. Coverage is stated as actual served/held
// counts — this is NOT the full 1,212-card universe while rows are held
// (10 fetchlands).
import searchData from "./_manabase_search.json";
import {
  matchesProduces,
  matchesFits,
  compareNormalizedName,
} from "./_manabase_search_filters.js";

const ROWS = searchData.rows;
const META = searchData.meta;
const CYCLES = new Set(ROWS.map((r) => r.cycle));
const TYPES = new Map(META.budget_types.map((t) => [t.id, t]));
const COLOR_ORDER = "WUBRGC";

// Per-cycle membership counts + price ranges, for the Browse tab: one
// request gives honest collapsed-row counts without loading all 1,202 rows.
// Computed once from the serving data (not from a separate source), so the
// counts can never drift from what the API itself serves.
const CYCLE_COUNTS = (() => {
  const byId = new Map();
  for (const r of ROWS) {
    const e = byId.get(r.cycle) ?? { id: r.cycle, count: 0, minPrice: Infinity, maxPrice: -Infinity };
    e.count += 1;
    e.minPrice = Math.min(e.minPrice, r.cheapest.price);
    e.maxPrice = Math.max(e.maxPrice, r.cheapest.price);
    byId.set(r.cycle, e);
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
})();

// $5.00-inclusive gate on the RELEASED quote (Charlie's sort, Q14).
const BUDGET_GATE_CENTS = META.ranking.budget_gate_cents;

function jsonError(msg, status = 400) {
  return Response.json({ error: msg }, { status });
}

function parseBoolParam(v, name) {
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  throw new Error(`${name} must be 1 or 0`);
}

function parseIntParam(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer ${min}-${max}`);
  }
  return n;
}

// The row's ranking record inside one type (or undefined when the row is not
// a member of that type).
function rankingForType(row, typeId) {
  return (row.budget_rankings ?? []).find((r) => r.type_id === typeId);
}

// A row is a RANKED entry of the selected type when its record is a default
// recommendation, budget-eligible on the released quote at or under the
// $5.00 gate, and not preorder-only. (The generator asserts the same for
// every default record; the API re-checks so a bad serving file cannot
// silently promote a card.) Exported for the unit tests: the exact-500-cent
// boundary is validated there with synthetic records.
export function isRankedInType(row, typeId) {
  const rec = rankingForType(row, typeId);
  return Boolean(
    rec &&
      rec.default_recommendation &&
      rec.budget_eligible &&
      rec.released_quote_cents !== null &&
      rec.released_quote_cents <= BUDGET_GATE_CENTS &&
      !rec.preorder_only_under_5
  );
}

function publicRow(r, typeId = null) {
  const out = {
    oracle_id: r.oracle_id,
    name: r.name,
    is_basic: r.is_basic,
    status: r.status,
    utility_flag: r.utility_flag,
    colors_produced: r.colors_produced,
    conditional_colors: r.conditional_colors,
    produces_colorless: r.produces_colorless,
    color_identity: r.color_identity,
    entry: r.entry,
    cycle: r.cycle,
    ...(r.oracle_text ? { oracle_text: r.oracle_text } : {}),
    cheapest: r.cheapest,
    game_changer: r.legality.game_changer,
    banned: r.legality.banned,
    in_buy_set_by_default: r.in_buy_set_by_default,
    basic_types: r.basic_types,
    preorder_only_under_5: r.preorder_only_under_5,
  };
  // Face rows (Q4): land-drop availability is part of the row, never implied.
  if (r.status === "face_row") {
    out.buy_name = r.buy_name;
    out.land_face_name = r.land_face_name;
    out.face_class = r.face_class;
    out.land_drop = r.land_drop;
    out.land_faces = r.land_faces;
    out.other_faces = r.other_faces;
  }
  // Rank context for the selected type (null when the row is unranked there).
  if (typeId !== null) {
    const rec = rankingForType(r, typeId);
    out.budget_rank = rec && isRankedInType(r, typeId) ? rec.editorial_rank : null;
    out.budget_rank_default = Boolean(rec && rec.default_recommendation);
    out.budget_rank_context = rec ? rec.context ?? null : null;
    out.budget_rank_sources = rec ? rec.source_ids ?? [] : [];
    out.budget_rank_tie_group = rec ? rec.tie_group ?? null : null;
  }
  return out;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = url.searchParams;

  // ---- Strict validation (no silent rewrites; bad input → 400) ----
  const rawColors = q.get("colors") ?? "";
  if (/[^WUBRGC]/.test(rawColors)) {
    return jsonError(
      `invalid colors: "${rawColors}" — use only W, U, B, R, G and C (colorless)`
    );
  }
  const colors = [...new Set(rawColors.split(""))].sort(
    (a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b)
  );
  const wantColorless = colors.includes("C");
  const wantColors = colors.filter((c) => c !== "C");

  const sort = q.get("sort") ?? "price_asc";
  if (sort === "most_used" || sort === "inclusion") {
    return jsonError(
      `sort=${sort} is not available yet — most-used ranking data is pending ` +
      `confirmation of its source (Q3). Results sort by cheapest price until then.`
    );
  }
  if (!["price_asc", "price_desc", "name", "best_budget"].includes(sort)) {
    return jsonError(
      `invalid sort: "${sort}" — use price_asc, price_desc, name or best_budget`
    );
  }

  const type = q.get("type") ?? null;
  if (type !== null && !TYPES.has(type)) {
    return jsonError(
      `unknown type: "${type}" — use one of: ${[...TYPES.keys()].join(", ")}`
    );
  }
  if (sort === "best_budget" && type === null) {
    return jsonError(
      "sort=best_budget needs a type — add type=<id> (see meta.budgetTypes). " +
      "Ranks are priorities inside one type, not a global order, so there is " +
      "no cross-type best-budget sort. Use sort=name for the All lands view."
    );
  }

  const mode = q.get("mode") ?? "produces";
  if (!["produces", "fits"].includes(mode)) {
    return jsonError(`invalid mode: "${mode}" — use produces or fits`);
  }

  let includeBasics, untappedOnly, limit, offset;
  try {
    includeBasics = parseBoolParam(q.get("include_basics") ?? "1", "include_basics");
    untappedOnly = parseBoolParam(q.get("untapped_only") ?? "0", "untapped_only");
    const rawLimit = q.get("limit") ?? "50";
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error("limit must be an integer 1-100");
    }
    limit = Math.min(n, 100);
    offset = parseIntParam(q.get("offset") ?? "0", "offset", 0, 100000);
  } catch (e) {
    return jsonError(e.message);
  }

  let maxPrice = null;
  if (q.get("max_price") !== null) {
    const n = Number(q.get("max_price"));
    if (!Number.isFinite(n) || n < 0) {
      return jsonError(`invalid max_price: "${q.get("max_price")}" — use a number ≥ 0`);
    }
    maxPrice = n;
  }

  const gameChanger = q.get("game_changer") ?? "any";
  if (!["any", "include", "exclude"].includes(gameChanger)) {
    return jsonError(`invalid game_changer: "${gameChanger}" — use any, include or exclude`);
  }

  const cycle = q.get("cycle") ?? null;
  if (cycle !== null && !CYCLES.has(cycle)) {
    return jsonError(`unknown cycle: "${cycle}"`);
  }

  // ---- Filters ----
  let results = ROWS;
  if (colors.length > 0) {
    if (mode === "fits") {
      // Whole-card CI + basic-land-type restriction (CR 903.5c/d). In fits
      // mode the C pip means colorless identity: requested colors are the
      // WUBRG chars only, so colors=C alone requests the empty set.
      results = results.filter((r) => matchesFits(r, wantColors));
    } else {
      results = results.filter((r) => matchesProduces(r, wantColors, wantColorless));
    }
  }
  if (type !== null) {
    // Members of the selected type (ranked or not). Non-members are out.
    results = results.filter((r) => rankingForType(r, type) !== undefined);
  }
  if (!includeBasics) results = results.filter((r) => !r.is_basic);
  if (maxPrice !== null) results = results.filter((r) => r.cheapest.price <= maxPrice);
  if (untappedOnly) {
    // Conditional entry is NOT untapped; a transform-back land is not an
    // untapped land drop either (its land face is reached by transformation).
    results = results.filter(
      (r) =>
        r.entry.status === "untapped" &&
        !(r.status === "face_row" && r.land_drop.code === "requires_transformation")
    );
  }
  if (gameChanger === "include") {
    results = results.filter((r) => r.legality.game_changer);
  } else if (gameChanger === "exclude") {
    results = results.filter((r) => !r.legality.game_changer);
  }
  if (cycle !== null) results = results.filter((r) => r.cycle === cycle);

  // ---- Sort (deterministic; pages are stable) ----
  // price/name sorts keep the existing raw-name tie-break (A–Z as shown).
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  // best_budget ties use the NORMALIZED name, then Oracle ID (contract).
  const byBudgetTie = (a, b) => compareNormalizedName(a, b);
  if (sort === "price_asc") {
    results = [...results].sort((a, b) => a.cheapest.price - b.cheapest.price || byName(a, b));
  } else if (sort === "price_desc") {
    results = [...results].sort((a, b) => b.cheapest.price - a.cheapest.price || byName(a, b));
  } else if (sort === "name") {
    results = [...results].sort(byName);
  } else if (sort === "best_budget") {
    // Ranked entries first by editorial rank; ties by actual selected price,
    // normalized name, then Oracle ID. Unranked members of the type follow
    // alphabetically (null rank is unreviewed, not worst quality).
    const rankOf = (r) => {
      const rec = rankingForType(r, type);
      return isRankedInType(r, type) ? rec.editorial_rank : null;
    };
    results = [...results].sort((a, b) => {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra !== null && rb !== null) {
        return (
          ra - rb ||
          a.cheapest.price - b.cheapest.price ||
          byBudgetTie(a, b)
        );
      }
      if (ra !== null) return -1;
      if (rb !== null) return 1;
      return byBudgetTie(a, b);
    });
  }

  const total = results.length;
  const page = results.slice(offset, offset + limit);
  const rankedCount =
    type !== null ? results.filter((r) => isRankedInType(r, type)).length : null;

  return Response.json({
    meta: {
      total,
      returned: page.length,
      sort,
      mode,
      ...(type !== null
        ? { type, typeLabel: TYPES.get(type).label, rankedCount }
        : {}),
      priceSnapshot: META.price_snapshot,
      rankingSnapshot: META.ranking.snapshot,
      rankingLabel: META.ranking.label,
      rankingNote: META.ranking_note,
      budgetTypes: META.budget_types,
      // Browse tab: per-cycle membership counts + price ranges (true full
      // counts, computed from the same rows this API serves).
      cycleCounts: CYCLE_COUNTS,
      preorderWatch: META.preorder_watch,
      servedCount: META.served_rows,
      heldCount: META.held_count,
      heldFaceRows: META.held_face_rows,
      heldFetchRows: META.held_fetch_rows,
      excludedCount: META.excluded_count,
      utilityDisplayOnly: META.served_utility_display_only,
      faceRows: META.served_face_rows,
      cheapestSetTotal: META.cheapest_set_total,
      coverageNote:
        "1,202 of 1,212 Commander-legal lands searchable; 10 held " +
        "(fetchlands — fetch modeling open); 100 excluded " +
        "(3 banned + 97 not Commander-legal). This is not full 1,212-card coverage.",
    },
    results: page.map((r) => publicRow(r, type)),
  });
}
