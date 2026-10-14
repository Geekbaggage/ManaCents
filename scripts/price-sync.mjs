// ManaCents nightly price sync (GitHub Actions, Option B).
// Reads the card pool from D1, refreshes non-foil USD via Scryfall's
// POST /cards/collection (75 cards/request, polite 150ms delay), upserts
// into cards, then runs the score recalculation.
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// Scoring constants (locked 2026-10-13): PRICE_FLOOR=0.10, PRICE_OFFSET=1.50

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = "1acf65bc-ed4c-44ac-8815-6b46a9d57f67";
const D1 = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}`;

const PRICE_FLOOR = 0.10;
const PRICE_OFFSET = 1.5;
const BATCH = 75; // Scryfall collection max
const DELAY_MS = 150; // polite; Scryfall asks for 50-100ms between requests
const D1_BATCH_SIZE = 500; // statements per D1 /batch call

if (!TOKEN || !ACCOUNT_ID) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

// Scryfall's API guidelines require a descriptive User-Agent on every call.
// (contact email is used because manacents.com is not registered yet.)
const API_HEADERS = {
  "User-Agent": "ManaCents/1.0 (contact: geekbaggage@gmail.com)",
  Accept: "application/json;q=0.9,*/*;q=0.8",
};

async function d1Query(sql, params = []) {
  const res = await fetch(`${D1}/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  return json.result[0].results ?? [];
}

async function d1Batch(statements) {
  for (let i = 0; i < statements.length; i += D1_BATCH_SIZE) {
    const chunk = statements.slice(i, i + D1_BATCH_SIZE);
    // NOTE: batching goes through /query with a {batch:[...]} body — there is
    // no separate /batch route ("Route not found", verified 2026-10-13).
    const res = await fetch(`${D1}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ batch: chunk.map((sql) => ({ sql })) }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(`D1 batch failed: ${JSON.stringify(json.errors)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The price pool: every card we recommend for any commander, plus anything
// already in cards (keeps the pool warm across synergy rebuilds).
async function getPool() {
  const rows = await d1Query(
    `SELECT DISTINCT scryfall_id AS id FROM commander_synergy
     UNION
     SELECT scryfall_id AS id FROM cards`
  );
  return rows.map((r) => r.id).filter(Boolean);
}

async function fetchPrices(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { ...API_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: chunk.map((id) => ({ id })) }),
    });
    if (!res.ok) throw new Error(`Scryfall ${res.status} on chunk ${i / BATCH}`);
    const json = await res.json();
    out.push(...(json.data ?? []));
    if (json.not_found?.length) {
      console.warn(`Scryfall not_found (${json.not_found.length}):`, JSON.stringify(json.not_found).slice(0, 200));
    }
    await sleep(DELAY_MS);
  }
  return out;
}

function toUpsert(card) {
  // Pricing rule (changed 2026-10-13 per Valerie, overriding the old "never foil" rule):
  // non-foil USD first, foil USD fallback (many precon/promo printings are foil-only),
  // then the $0.10 floor. Never NaN, never null.
  const rawPrice = card.prices?.usd ?? card.prices?.usd_foil ?? "0.10";
  let usd = Math.max(parseFloat(rawPrice) || PRICE_FLOOR, PRICE_FLOOR);
  const price_log = Math.log(usd + PRICE_OFFSET);
  const tcgId = Number.isFinite(parseInt(card.tcgplayer_id, 10)) ? parseInt(card.tcgplayer_id, 10) : null;
  const name = card.name.replace(/'/g, "''");
  return `INSERT INTO cards (scryfall_id, name, usd, price_log, tcgplayer_id, updated_at)
VALUES ('${card.id}', '${name}', ${usd}, ${price_log}, ${tcgId ?? "NULL"}, datetime('now'))
ON CONFLICT(scryfall_id) DO UPDATE SET
  usd = excluded.usd,
  price_log = excluded.price_log,
  tcgplayer_id = excluded.tcgplayer_id,
  updated_at = excluded.updated_at;`;
}

async function main() {
  const pool = await getPool();
  console.log(`Price pool: ${pool.length} cards`);
  if (!pool.length) {
    console.log("Pool is empty — run synergy-sync first. Nothing to do.");
    return;
  }
  const cards = await fetchPrices(pool);
  console.log(`Fetched ${cards.length} cards from Scryfall`);
  await d1Batch(cards.map(toUpsert));
  console.log(`Upserted ${cards.length} price rows`);

  // Step 3: recalculate scores (correlated subquery form — see recalc_scores.sql)
  const dir = dirname(fileURLToPath(import.meta.url));
  const recalc = readFileSync(join(dir, "..", "recalc_scores.sql"), "utf8");
  await d1Query(recalc);
  console.log("Scores recalculated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
