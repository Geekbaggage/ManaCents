#!/usr/bin/env node
/** ManaBase Search — hosted API matrix.
 *
 * Re-runs the Phase 5 matrix (27 checks) against a live preview deployment.
 * Usage: node search_matrix.mjs [base-url]   (default: search-phase5 preview)
 * Exit 0 = all pass. Prints PASS/FAIL per check + a summary.
 *
 * Checks are counts / structure / error codes / flags — the stable parts.
 * Prices are recorded, not pinned (they move with each refresh snapshot),
 * except where a check is about a price rule (e.g. $5 gate, preorder flag).
 */
const BASE = process.argv[2] ?? "https://search-phase5.manacents.pages.dev";
const UA = { "User-Agent": "ManaCents-matrix/1.0 (contact: geekbaggage@gmail.com)" };

let pass = 0;
let fail = 0;
const failures = [];

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: UA });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, data, text };
}

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  // 1. Home
  let r = await get("/?manabase");
  check("home 200", r.status === 200, `status=${r.status}`);

  // 2-8. No-params defaults (7 sub-checks)
  r = await get("/api/manabase-search");
  const m = r.data?.meta;
  check("no-params total 1202", m?.total === 1202, `total=${m?.total}`);
  check("no-params returned 50", r.data?.results?.length === 50, `returned=${r.data?.results?.length}`);
  check("no-params snapshots present", Boolean(m?.priceSnapshot) && Boolean(m?.rankingSnapshot), `price=${m?.priceSnapshot} ranking=${m?.rankingSnapshot}`);
  check("no-params ranking label", m?.rankingLabel === "Best budget — researched", `label=${m?.rankingLabel}`);
  check("no-params cheapest > 0", (r.data?.results?.[0]?.cheapest?.price ?? 0) > 0, `cheapest=$${r.data?.results?.[0]?.cheapest?.price}`);
  check("no-params preorderWatch 7", Array.isArray(m?.preorderWatch) && m.preorderWatch.length === 7, `watch=${m?.preorderWatch?.length}`);
  check("no-params budgetTypes 25", Array.isArray(m?.budgetTypes) && m.budgetTypes.length === 25, `types=${m?.budgetTypes?.length}`);

  // 9-10. Color filters
  r = await get("/api/manabase-search?colors=WU&limit=1");
  check("colors WU 591", r.data?.meta?.total === 591, `total=${r.data?.meta?.total}`);
  r = await get("/api/manabase-search?colors=C&limit=1");
  check("colors C 308", r.data?.meta?.total === 308, `total=${r.data?.meta?.total}`);

  // 11. Cycle filter
  r = await get("/api/manabase-search?cycle=shock&limit=1");
  check("cycle shock 11", r.data?.meta?.total === 11, `total=${r.data?.meta?.total}`);

  // 12. Game Changer include
  r = await get("/api/manabase-search?game_changer=include&limit=1");
  check("GC include 7", r.data?.meta?.total === 7, `total=${r.data?.meta?.total}`);

  // 13. Hide basics
  r = await get("/api/manabase-search?include_basics=0&limit=1");
  check("include_basics=0 -> 1190", r.data?.meta?.total === 1190, `total=${r.data?.meta?.total}`);

  // 14-15. Fits mode
  r = await get("/api/manabase-search?mode=fits&colors=U&limit=1");
  check("fits U 416", r.data?.meta?.total === 416, `total=${r.data?.meta?.total}`);
  r = await get("/api/manabase-search?mode=fits&colors=C&limit=1");
  check("fits C 354", r.data?.meta?.total === 354, `total=${r.data?.meta?.total}`);

  // 16-19. Honest 400s
  for (const [name, path] of [
    ["sort=most_used 400", "/api/manabase-search?sort=most_used&limit=1"],
    ["colors=X 400", "/api/manabase-search?colors=X&limit=1"],
    ["mode=bogus 400", "/api/manabase-search?mode=bogus&limit=1"],
    ["best_budget w/o type 400", "/api/manabase-search?sort=best_budget&limit=1"],
  ]) {
    r = await get(path);
    check(name, r.status === 400, `status=${r.status}`);
  }
  r = await get("/api/manabase-search?type=bogus&limit=1");
  check("type=bogus 400", r.status === 400, `status=${r.status}`);

  // 20. Best-budget type view
  r = await get("/api/manabase-search?sort=best_budget&type=two_color_fixing&limit=1");
  check("two_color_fixing 208/161", r.data?.meta?.total === 208 && r.data?.meta?.rankedCount === 161,
    `total=${r.data?.meta?.total} ranked=${r.data?.meta?.rankedCount}`);
  r = await get("/api/manabase-search?sort=best_budget&type=two_color_fixing&limit=5");
  check("two_color_fixing rank-1 first is Battlefield Forge",
    r.data?.results?.[0]?.name === "Battlefield Forge" && r.data?.results?.[0]?.budget_rank === 1,
    `first=${r.data?.results?.[0]?.name} rank=${r.data?.results?.[0]?.budget_rank}`);

  // 21. Rainbow view
  r = await get("/api/manabase-search?sort=best_budget&type=rainbow_commander_fixing&limit=5");
  check("rainbow 5, Command Tower first",
    r.data?.meta?.total === 5 && r.data?.results?.[0]?.name === "Command Tower",
    `total=${r.data?.meta?.total} first=${r.data?.results?.[0]?.name}`);

  // 22. Combined filter: WU + untapped + max $1
  r = await get("/api/manabase-search?colors=WU&untapped_only=1&max_price=1&limit=100");
  const bad = (r.data?.results ?? []).filter((x) => x.entry?.status !== "untapped" || x.cheapest.price > 1);
  check("WU untapped max$1 all untapped ≤$1", r.status === 200 && bad.length === 0,
    `returned=${r.data?.results?.length} violations=${bad.length}`);

  // 23. untapped_only excludes transform-back rows
  r = await get("/api/manabase-search?untapped_only=1&limit=100");
  const tb = (r.data?.results ?? []).filter((x) => x.land_drop?.code === "requires_transformation");
  const m2 = r.data?.meta;
  check("untapped_only excludes transform-back", tb.length === 0 && m2?.total === 525,
    `total=${m2?.total} transform-back in page=${tb.length}`);

  // 24. Optimizer untouched
  r = await get("/api/manabase?list=all");
  check("optimizer still 43 lands", Array.isArray(r.data?.lands) && r.data.lands.length === 43,
    `lands=${r.data?.lands?.length}`);

  // 25-27. Paginated lookups (rows past the first 100 cheapest)
  async function findByName(name) {
    for (let offset = 0; offset < 1202; offset += 100) {
      const page = await get(`/api/manabase-search?sort=name&limit=100&offset=${offset}`);
      const row = page.data?.results?.find((x) => x.name === name);
      if (row) return row;
    }
    return null;
  }
  const hf = await findByName("Hallowed Fountain");
  check("Hallowed Fountain found, preorder-flagged",
    !!hf && hf.preorder_only_under_5 === true,
    hf ? `$${hf.cheapest.price} ${hf.cheapest.printing}` : "not found");
  const ish = await findByName("Ishgard, the Holy See // Faith & Grief");
  check("Ishgard adventure single_card",
    !!ish && ish.land_drop?.code === "single_card",
    ish ? `drop=${ish.land_drop?.code}` : "not found");
  const acl = await findByName("Aclazotz, Deepest Betrayal // Temple of the Dead");
  check("Aclazotz requires_transformation",
    !!acl && acl.land_drop?.code === "requires_transformation",
    acl ? `drop=${acl.land_drop?.code}` : "not found");

  console.log(`\n${pass} pass, ${fail} fail`);
  if (failures.length) console.log("Failures:", failures.join("; "));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("MATRIX ERROR", e); process.exit(2); });
