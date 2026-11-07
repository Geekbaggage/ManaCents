// GET /api/manabase-search?colors=WU&sort=price_asc&limit=50&offset=0
//     &include_basics=1&max_price=25&untapped_only=0&game_changer=any&cycle=shock
//
// ManaBase land SEARCH API. Serves the full-catalog search data (1,101 rows:
// 1,053 verified + 48 utility display-only; price snapshot 2026-11-06).
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
// Sorting: most-used is the planned default, but the ranking data does NOT
// exist yet (Q3 — EDHREC terms with Charlie; NOT cleared Nov 6/7). Until Q3
// clears, the visible default is price_asc and sort=most_used / sort=inclusion
// is rejected with a 400 that says so plainly. Most-used numbers are never faked.
//
// Params (all validated; invalid input → 400, never silently rewritten):
//   colors: string of WUBRG chars + optional C (colorless-only); absent = all
//   mode: produces (default) · fits
//   sort: price_asc (default) · price_desc · name
//   include_basics: 1/0 (default 1 — Q1, Val Nov 6: basics shown by default)
//   max_price: number ≥ 0 (cheapest price must be ≤ this)
//   untapped_only: 1/0 (default 0; conditional entry is NOT untapped)
//   game_changer: any (default) · include · exclude
//   cycle: cycle id from the data (e.g. shock, check, gainland, unclassified)
//   limit: integer 1–100 (default 50; >100 clamps to 100)
//   offset: integer ≥ 0 (default 0)
//
// Returns: { meta, results } — meta always carries the price snapshot date,
// the (null) ranking snapshot + note, and the served/held counts, so the UI
// can show staleness honestly. Coverage is stated as actual served/held
// counts — this is NOT the full 1,212-card universe while rows are held.
import searchData from "./_manabase_search.json";
import { matchesProduces, matchesFits } from "./_manabase_search_filters.js";

const ROWS = searchData.rows;
const META = searchData.meta;
const CYCLES = new Set(ROWS.map((r) => r.cycle));
const COLOR_ORDER = "WUBRGC";

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

function publicRow(r) {
  return {
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
  };
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
  if (!["price_asc", "price_desc", "name"].includes(sort)) {
    return jsonError(`invalid sort: "${sort}" — use price_asc, price_desc or name`);
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
  if (!includeBasics) results = results.filter((r) => !r.is_basic);
  if (maxPrice !== null) results = results.filter((r) => r.cheapest.price <= maxPrice);
  if (untappedOnly) results = results.filter((r) => r.entry.status === "untapped");
  if (gameChanger === "include") {
    results = results.filter((r) => r.legality.game_changer);
  } else if (gameChanger === "exclude") {
    results = results.filter((r) => !r.legality.game_changer);
  }
  if (cycle !== null) results = results.filter((r) => r.cycle === cycle);

  // ---- Sort (deterministic; tie-break name asc so pages are stable) ----
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (sort === "price_asc") {
    results = [...results].sort((a, b) => a.cheapest.price - b.cheapest.price || byName(a, b));
  } else if (sort === "price_desc") {
    results = [...results].sort((a, b) => b.cheapest.price - a.cheapest.price || byName(a, b));
  } else {
    results = [...results].sort(byName);
  }

  const total = results.length;
  const page = results.slice(offset, offset + limit);

  return Response.json({
    meta: {
      total,
      returned: page.length,
      sort,
      mode,
      priceSnapshot: META.price_snapshot,
      rankingSnapshot: META.ranking,
      rankingNote: META.ranking_note,
      servedCount: META.served_rows,
      heldCount: META.held_count,
      heldFaceRows: META.held_face_rows,
      heldFetchRows: META.held_fetch_rows,
      excludedCount: META.excluded_count,
      utilityDisplayOnly: META.served_utility_display_only,
      cheapestSetTotal: META.cheapest_set_total,
      coverageNote:
        "1,101 of 1,212 Commander-legal lands searchable; 111 held " +
        "(101 double-faced/adventure + 10 fetchlands); 100 excluded " +
        "(3 banned + 97 not Commander-legal). This is not full 1,212-card coverage.",
    },
    results: page.map(publicRow),
  });
}
