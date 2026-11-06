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

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
// Other conditional modes (filter input, opponent-dependent, fetch
// targets) stay governed by production_conditional / held status.
function buildConditionalColors(row) {
  const out = [];
  for (const mode of row.mana_modes || []) {
    if (mode.unconditional !== false) continue;
    const dep = mode.dependency;
    if (typeof dep !== "string" || !dep.trim().startsWith("Control ")) continue;
    const output = mode.output || [];
    if (output.length !== 1 || !["W", "U", "B", "R", "G"].includes(output[0])) {
      throw new Error(
        `${row.name}: verge-style mana_mode has unexpected output ` +
          `${JSON.stringify(output)} — expected exactly one color`
      );
    }
    out.push({ color: output[0], dependency: parseVergeDependency(dep, row.name) });
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scryfall(url, attempt = 1) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 && attempt <= 5) {
    // Honor Retry-After when present, else exponential backoff.
    const retryAfter = parseFloat(res.headers.get("retry-after") || "0");
    const wait = Math.min(
      (retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1)),
      10000
    );
    console.log(`Scryfall 429, retry ${attempt}/5 after ${wait}ms`);
    await sleep(wait);
    return scryfall(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Scryfall ${res.status} for ${url}`);
  return res.json();
}

// All printings of one card by exact name (plain-name query + filter;
// the !"Name" exact operator returns HTTP 400 — known gotcha).
async function fetchPrintings(name) {
  const printings = [];
  let url =
    "https://api.scryfall.com/cards/search?q=" +
    encodeURIComponent(name) +
    "&unique=prints";
  while (url) {
    const data = await scryfall(url);
    for (const c of data.data || []) {
      if (c.name === name) printings.push(c);
    }
    url = data.has_more ? data.next_page : null;
    if (url) await sleep(DELAY_MS);
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
  const today = new Date().toISOString().slice(0, 10);
  const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  if (seed.seed_version !== "0.4.2") {
    throw new Error(`unexpected seed version ${seed.seed_version}`);
  }
  const rows = seed.rows;
  if (rows.length !== 45) throw new Error(`expected 45 rows, got ${rows.length}`);

  // Official Game Changer list (WotC, via Scryfall is:gamechanger).
  console.log("Fetching Game Changer list...");
  const gcData = await scryfall(
    "https://api.scryfall.com/cards/search?q=is%3Agamechanger"
  );
  const gcNames = new Set((gcData.data || []).map((c) => c.name));
  console.log(`Game Changers on record: ${gcNames.size}`);

  const prices = {};
  const checks = {};
  const bannedNow = [];
  const gcNow = [];
  for (const row of rows) {
    const name = row.name;
    const printings = await fetchPrintings(name);
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
    await sleep(DELAY_MS);
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

  // Evidence files (committed with the run for audit).
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(EVIDENCE_DIR, `land_prices_${today}.json`),
    JSON.stringify(
      { date: today, policy: "cheapest printing, any finish (foils count)", prices },
      null,
      2
    ) + "\n"
  );
  writeFileSync(
    join(EVIDENCE_DIR, `eligibility_checked_${today}.json`),
    JSON.stringify(
      {
        date: today,
        gamechanger_count: gcNames.size,
        gamechangers_in_seed: gcNow,
        banned_in_seed: bannedNow,
        checks,
      },
      null,
      2
    ) + "\n"
  );
  writeFileSync(SERVING_PATH, JSON.stringify(out) + "\n");
  const total = lands.reduce((s, l) => s + l.price, 0);
  console.log(`Wrote ${SERVING_PATH}: ${lands.length} lands, snapshot ${today}`);
  console.log(`Cheapest ${lands.length}-land set total: $${total.toFixed(2)}`);
  console.log(`Held excluded: ${held.join(", ") || "none"}`);
  if (gcNow.length) console.log(`Game Changers flagged in seed: ${gcNow.join(", ")}`);
  if (bannedNow.length) {
    console.error(`BANNED lands excluded, human review required: ${bannedNow.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("REFRESH FAILED — no serving data written:", e.message);
  process.exit(1);
});
