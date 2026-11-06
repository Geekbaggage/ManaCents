// ManaBase nightly data refresh — prices + eligibility checks.
//
// Re-fetches cheapest-printing prices (any finish, foils count — CEO
// pricing policy) for the 45 seed lands, re-checks the official Game
// Changer list and Commander banned status, and regenerates the serving
// data (web/functions/api/_manabase_lands.json) from the FROZEN seed
// v0.4.2 (mechanics/scoring never change here — only prices, flags and
// the snapshot date move).
//
// Fail-closed: any fetch failure, any land without a price, or any land
// with unknown legality aborts the run WITHOUT writing serving data.
// A newly banned land is excluded from serving data AND fails the run
// loudly so a human reviews the catalog change.
//
// Provenance: every price records printing (set + collector number),
// Scryfall card id + URI, finish, and source time. Evidence files are
// written under scripts/manabase-refresh/ and committed with the run.
//
// Env: none needed (public Scryfall API only).
// Run: node scripts/manabase-refresh.mjs  (nightly via manabase-refresh.yml)

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const SEED_PATH = join(REPO, "web/functions/api/_manabase_seed_v042.json");
const SERVING_PATH = join(REPO, "web/functions/api/_manabase_lands.json");
const EVIDENCE_DIR = join(__dirname, "manabase-refresh");

const DELAY_MS = 250; // polite; Scryfall asks for 50-100ms, 429s need margin
const HEADERS = {
  "User-Agent": "ManaCents/1.0 (contact: geekbaggage@gmail.com)",
  Accept: "application/json",
};

// Spec v4 locked: cycling/surveil utility +0.3 each (solver subtracts).
// Same map as the Python converter (convert_to_solver.py) — keep in sync.
const UTILITY_TAGS = {
  "Raugrin Triome": 0.3, // Cycling
  "Zagoth Triome": 0.3, // Cycling
  "Undercity Sewers": 0.3, // Surveil 1
  "Shadowy Backstreet": 0.3, // Surveil 1
};

const BASIC_LAND_TYPES = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest"]);

// Design B: parse a verge dependency ("Control Plains or Island") into
// structured {type, types}. Throws on anything unparseable.
function parseVergeDependency(dep, name) {
  if (typeof dep !== "string" || !dep.trim().startsWith("Control ")) {
    throw new Error(
      `${name}: unparseable verge dependency ${JSON.stringify(dep)} ` +
        "(expected 'Control <basic land type> or ...')"
    );
  }
  const rest = dep.trim().slice("Control ".length);
  const types = rest
    .replace(/,/g, " or ")
    .split(" or ")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!types.length) {
    throw new Error(`${name}: empty verge dependency ${JSON.stringify(dep)}`);
  }
  for (const t of types) {
    if (!BASIC_LAND_TYPES.has(t)) {
      throw new Error(
        `${name}: unknown basic land type ${JSON.stringify(t)} in dependency ` +
          JSON.stringify(dep)
      );
    }
  }
  return { type: "basic_land_type", types };
}

// Design A: shock ETB modes from the seed row's entry record.
// The payment comes from entry.predicate.payment — never hardcoded.
// Returns [pay_life, tapped] or null for non-shock rows.
function buildEtbModes(row) {
  const entry = row.entry || {};
  if (entry.condition !== "life_payment") return null;
  const payment = entry.predicate?.payment;
  if (typeof payment !== "number" || !Number.isFinite(payment) || payment <= 0) {
    throw new Error(
      `${row.name}: shock entry missing numeric payment ` +
        `(entry.predicate.payment=${JSON.stringify(payment)}) — failing closed`
    );
  }
  return [
    { mode: "pay_life", untapped: true, conditional: false, lifeCost: payment },
    { mode: "tapped", untapped: false, conditional: true, lifeCost: 0 },
  ];
}

// Design B: conditional colors from mana_modes (verge-style only).
// Each conditional mode is classified explicitly; unknown, missing or
// malformed data FAILS the build — it is never silently interpreted as
// an unrelated mode (a missing verge dependency must not silently drop
// the correction).
//   - filter-style (input_cost present): governed by
//     production_conditional / held status; skipped here. The output must
//     be a non-empty list of valid colors.
//   - fetch-style (no color output): dependency must be exactly
//     "Target availability" (the held fetchlands).
//   - opponent-style (output is the string "opponent-dependent"):
//     dependency must be a non-empty string.
//   - verge-style (exactly one color output, no input_cost): requires a
//     "Control <basic land type> ..." dependency — missing or malformed
//     dependency throws (never a silent drop).
//   - anything else conditional: unknown mode kind — throw.
function buildConditionalColors(row) {
  const out = [];
  for (const mode of row.mana_modes || []) {
    if (mode.unconditional !== false) continue;
    // Filter-style: requires input mana. Validate the shape, then skip.
    if (mode.input_cost) {
      const output = mode.output || [];
      if (!Array.isArray(output) || !output.length ||
          !output.every((c) => ["W", "U", "B", "R", "G"].includes(c))) {
        throw new Error(
          `${row.name}: filter-style mana_mode has malformed output ` +
          `${JSON.stringify(output)} — failing closed`
        );
      }
      continue;
    }
    const dep = mode.dependency;
    // Fetch-style: no color output, target-availability dependency.
    if (Array.isArray(mode.output) && mode.output.length === 0) {
      if (dep !== "Target availability") {
        throw new Error(
          `${row.name}: fetch-style mana_mode has unexpected dependency ` +
          `${JSON.stringify(dep)} — expected "Target availability"`
        );
      }
      continue;
    }
    // Opponent-style: output is the string "opponent-dependent".
    if (typeof mode.output === "string") {
      if (mode.output === "opponent-dependent" &&
          typeof dep === "string" && dep.trim()) {
        continue;
      }
      throw new Error(
        `${row.name}: opponent-style mana_mode has unexpected output/dependency ` +
        `${JSON.stringify(mode)} — failing closed`
      );
    }
    // Verge-style: exactly one color output — the dependency is REQUIRED.
    if (Array.isArray(mode.output) && mode.output.length === 1 &&
        ["W", "U", "B", "R", "G"].includes(mode.output[0])) {
      if (typeof dep !== "string" || !dep.trim().startsWith("Control ")) {
        throw new Error(
          `${row.name}: verge-style mana_mode for ${mode.output[0]} is missing ` +
          `its "Control ..." dependency ${JSON.stringify(dep)} — failing closed ` +
          `(a missing dependency must not silently drop the conditional color)`
        );
      }
      out.push({ color: mode.output[0], dependency: parseVergeDependency(dep, row.name) });
      continue;
    }
    // Unknown conditional mode kind — reject, never interpret.
    throw new Error(
      `${row.name}: unknown conditional mana_mode kind ${JSON.stringify(mode)} ` +
      `— failing closed`
    );
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetchFn is injectable (default: global fetch) so the nightly producer
// can be regression-tested offline with mocked network responses.
async function scryfall(url, attempt = 1, fetchFn = fetch) {
  const res = await fetchFn(url, { headers: HEADERS });
  if (res.status === 429 && attempt <= 5) {
    // Honor Retry-After when present, else exponential backoff.
    const retryAfter = parseFloat(res.headers.get("retry-after") || "0");
    const wait = Math.min(
      (retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1)),
      10000
    );
    console.log(`Scryfall 429, retry ${attempt}/5 after ${wait}ms`);
    await sleep(wait);
    return scryfall(url, attempt + 1, fetchFn);
  }
  if (!res.ok) throw new Error(`Scryfall ${res.status} for ${url}`);
  return res.json();
}

// Official Game Changer list (WotC, via Scryfall is:gamechanger).
// FAILS CLOSED: the response shape and every card record are validated,
// pagination is followed fully, and the collected count must match
// total_cards. A successful HTTP response containing {} is NOT an empty
// GC list — it is malformed data and aborts the run before any flag is
// derived. Returns { names, pages, total, retrievedAt } for provenance.
async function fetchGameChangers(fetchFn = fetch, sleepFn = sleep) {
  const names = new Set();
  let url = "https://api.scryfall.com/cards/search?q=is%3Agamechanger";
  let pages = 0;
  let collected = 0;
  let expectedTotal = null;
  while (url) {
    const data = await scryfall(url, 1, fetchFn);
    if (!data || typeof data !== "object" || data.object !== "list" ||
        !Array.isArray(data.data)) {
      throw new Error(
        `Game Changer list: unexpected response shape ` +
        `(object=${JSON.stringify(data?.object)}) — aborting, no data written`
      );
    }
    if (expectedTotal === null) {
      if (typeof data.total_cards !== "number" || data.total_cards < 0) {
        throw new Error(
          "Game Changer list: missing total_cards — aborting, no data written"
        );
      }
      expectedTotal = data.total_cards;
    }
    for (const c of data.data) {
      if (!c || c.object !== "card" || typeof c.name !== "string" || !c.name ||
          typeof c.id !== "string" || !c.id) {
        throw new Error(
          `Game Changer list: malformed card record ${JSON.stringify(c)} ` +
          `— aborting, no data written`
        );
      }
      names.add(c.name);
      collected++;
    }
    pages++;
    if (data.has_more) {
      if (typeof data.next_page !== "string" || !data.next_page) {
        throw new Error(
          "Game Changer list: has_more=true but no next_page — aborting " +
          "(incomplete list), no data written"
        );
      }
      url = data.next_page;
    } else {
      url = null;
    }
    if (url) await sleepFn(DELAY_MS);
  }
  if (collected !== expectedTotal) {
    throw new Error(
      `Game Changer list incomplete: collected ${collected} records, ` +
      `expected ${expectedTotal} — aborting, no data written`
    );
  }
  if (names.size !== collected) {
    throw new Error(
      `Game Changer list inconsistent: ${collected} records but only ` +
      `${names.size} unique names — aborting, no data written`
    );
  }
  return {
    names,
    pages,
    total: expectedTotal,
    retrievedAt: new Date().toISOString(),
  };
}

// All printings of one card by exact name (plain-name query + filter;
// the !"Name" exact operator returns HTTP 400 — known gotcha).
async function fetchPrintings(name, fetchFn = fetch, sleepFn = sleep) {
  const printings = [];
  let url =
    "https://api.scryfall.com/cards/search?q=" +
    encodeURIComponent(name) +
    "&unique=prints";
  while (url) {
    const data = await scryfall(url, 1, fetchFn);
    for (const c of data.data || []) {
      if (c.name === name) printings.push(c);
    }
    url = data.has_more ? data.next_page : null;
    if (url) await sleepFn(DELAY_MS);
  }
  return printings;
}

function cheapest(printings) {
  let best = null;
  for (const c of printings) {
    const prices = c.prices || {};
    for (const [field, finish] of [
      ["usd", "nonfoil"],
      ["usd_foil", "foil"],
      ["usd_etched", "etched"],
    ]) {
      const v = prices[field];
      if (v == null) continue;
      const n = parseFloat(v);
      if (!Number.isFinite(n)) continue;
      if (!best || n < best.price) {
        best = {
          price: n,
          printing: `${c.set.toUpperCase()} #${c.collector_number} (${field})`,
          scryfallId: c.id,
          scryfallUri: c.scryfall_uri,
          finish,
          sourceTime: new Date().toISOString(),
        };
      }
    }
  }
  return best;
}

async function main() {
  const r = await runRefresh();
  console.log(
    `Wrote ${SERVING_PATH}: ${r.lands} lands, snapshot ${r.today}`
  );
  console.log(`Cheapest ${r.lands}-land set total: $${r.total.toFixed(2)}`);
  console.log(`Held excluded: ${r.held.join(", ") || "none"}`);
  if (r.gcNow.length) {
    console.log(`Game Changers flagged in seed: ${r.gcNow.join(", ")}`);
  }
}

// runRefresh: the full nightly producer, with injectable dependencies so
// it is regression-tested offline (mocked network/filesystem, writes
// intercepted). Throws on any fatal condition BEFORE writing anything —
// a failed refresh preserves the last known-good serving file.
// Returns { lands, total, held, gcNow, bannedNow, today, gcPages, gcTotal }.
async function runRefresh(deps = {}) {
  const {
    fetchFn = fetch,
    readFile = readFileSync,
    writeFile = writeFileSync,
    mkdir = mkdirSync,
    rename = renameSync,
    sleepFn = sleep,
    today = new Date().toISOString().slice(0, 10),
    seedPath = SEED_PATH,
    servingPath = SERVING_PATH,
    evidenceDir = EVIDENCE_DIR,
  } = deps;

  const seed = JSON.parse(readFile(seedPath, "utf8"));
  if (seed.seed_version !== "0.4.2") {
    throw new Error(`unexpected seed version ${seed.seed_version}`);
  }
  const rows = seed.rows;
  if (rows.length !== 45) throw new Error(`expected 45 rows, got ${rows.length}`);

  // Official Game Changer list — validated, paginated, complete. Any
  // malformed/incomplete response aborts BEFORE any flag is derived.
  console.log("Fetching Game Changer list...");
  const gc = await fetchGameChangers(fetchFn, sleepFn);
  const gcNames = gc.names;
  console.log(`Game Changers on record: ${gcNames.size} (${gc.pages} pages)`);

  const prices = {};
  const checks = {};
  const bannedNow = [];
  const gcNow = [];
  for (const row of rows) {
    const name = row.name;
    const printings = await fetchPrintings(name, fetchFn, sleepFn);
    if (printings.length === 0) {
      throw new Error(`no printings found for ${name} — aborting, no data written`);
    }
    const best = cheapest(printings);
    if (!best) {
      throw new Error(`no usable price for ${name} — aborting, no data written`);
    }
    prices[name] = best;
    // Legality is per-oracle; take it from the first exact-name printing.
    const legality = printings[0].legalities?.commander ?? "unknown";
    if (legality !== "legal" && legality !== "banned") {
      throw new Error(`${name}: unknown Commander legality (${legality}) — aborting`);
    }
    const isGC = gcNames.has(name);
    const isBanned = legality === "banned";
    checks[name] = {
      game_changer: isGC,
      banned: isBanned,
      commander_legality: legality,
      source: "api.scryfall.com (is:gamechanger + card legalities)",
      checked_date: today,
    };
    if (isBanned) bannedNow.push(name);
    if (isGC) gcNow.push(name);
    await sleepFn(DELAY_MS);
  }

  // Build serving data in the exact shape of convert_to_solver.py.
  // Banned lands are excluded (fail-closed); GC lands are flagged.
  const lands = [];
  const held = [];
  for (const row of rows) {
    const check = checks[row.name];
    if (!row.eligibility.eligible) {
      held.push(row.name);
      continue;
    }
    if (check.banned) {
      held.push(row.name + " (banned " + today + ")");
      continue;
    }
    const p = row.solver_projection;
    const land = {
      name: row.name,
      price: prices[row.name].price,
      pricePrinting: prices[row.name].printing,
      priceDate: today,
      colors: p.colors,
      colorIdentity: row.color_identity,
      basicTypes: p.basic_types,
      untapped: p.untapped,
      conditional: p.conditional,
      productionConditional: p.production_conditional,
      lifeCost: p.life_cost,
      utility: UTILITY_TAGS[row.name] ?? 0,
      // Design C: derived from the live check (banned rows are excluded
      // above, so served banned is always false — but it is derived, not
      // hardcoded). gameChanger comes from the live GC list.
      banned: check.banned,
      gameChanger: check.game_changer,
      producesColorless: p.producesColorless,
      oracleId: row.oracle_id,
      scoringStatus: p.scoring_status,
    };
    // Design A: both ETB modes (payment from the seed row, never hardcoded).
    const etbModes = buildEtbModes(row);
    if (etbModes) land.etbModes = etbModes;
    // Design B: conditional colors (verge-style only).
    const condColors = buildConditionalColors(row);
    if (condColors.length) land.conditionalColors = condColors;
    lands.push(land);
  }

  const out = {
    generated_from: "_manabase_seed_v042.json (frozen) + nightly refresh " + today,
    seed_version: seed.seed_version,
    scoring_policy: seed.scoring_policy,
    price_snapshot: today,
    land_count: lands.length,
    held_excluded: held,
    lands,
  };

  // Evidence payloads (built in memory; written only after all fatal
  // checks pass). The GC retrieval provenance is preserved here: dated
  // authority, page count and total.
  const pricesEvidence = {
    date: today,
    policy: "cheapest printing, any finish (foils count)",
    prices,
  };
  const eligibilityEvidence = {
    date: today,
    gamechanger_count: gcNames.size,
    gamechanger_pages: gc.pages,
    gamechanger_total_cards: gc.total,
    gamechanger_retrieved_at: gc.retrievedAt,
    gamechangers_in_seed: gcNow,
    banned_in_seed: bannedNow,
    checks,
  };

  // ALL fatal conditions are checked BEFORE any write. A banned land
  // aborts the run with no files written — the last known-good serving
  // file stays in place and the workflow failure blocks its commit step.
  if (bannedNow.length) {
    throw new Error(
      `BANNED lands excluded, human review required: ${bannedNow.join(", ")} ` +
      `— aborting, no files written`
    );
  }

  // Stage and safely replace a coherent output set: write temp files in
  // the target directories, then rename into place (rename is atomic on
  // the same filesystem). If a write fails, the previous files remain.
  mkdir(evidenceDir, { recursive: true });
  const staged = [];
  const stage = (path, content) => {
    const tmp = `${path}.tmp-${process.pid}`;
    writeFile(tmp, content);
    staged.push([tmp, path]);
  };
  stage(
    join(evidenceDir, `land_prices_${today}.json`),
    JSON.stringify(pricesEvidence, null, 2) + "\n"
  );
  stage(
    join(evidenceDir, `eligibility_checked_${today}.json`),
    JSON.stringify(eligibilityEvidence, null, 2) + "\n"
  );
  stage(servingPath, JSON.stringify(out) + "\n");
  for (const [tmp, path] of staged) rename(tmp, path);

  const total = lands.reduce((s, l) => s + l.price, 0);
  return {
    lands: lands.length, total, held, gcNow, bannedNow,
    today, gcPages: gc.pages, gcTotal: gc.total,
  };
}

// Only run when executed directly (not when imported by the regression
// tests). The tests import runRefresh and the builders with mocked deps.
export { runRefresh, fetchGameChangers, fetchPrintings, buildEtbModes,
  buildConditionalColors, parseVergeDependency, cheapest };

if (process.argv[1] &&
    fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error("REFRESH FAILED — no serving data written:", e.message);
    process.exit(1);
  });
}
