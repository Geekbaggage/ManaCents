// ManaCents weekly synergy sync (GitHub Actions, Option B).
// For each active commander: fetch EDHREC's per-commander JSON, extract
// high-inclusion cards (>= 8% noise floor), resolve names to Scryfall IDs,
// classify roles, upsert commander_synergy. Then rebuild global_rates from
// our own corpus (Step 1) and recalculate scores (Step 3).
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// Scoring constants (locked 2026-10-13): NOISE_FLOOR=0.08, SMOOTHING_K=0.03
// Active-commander cutoff: top 1,000 by deck_count (or >= 200 decks).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = "1acf65bc-ed4c-44ac-8815-6b46a9d57f67";
const D1 = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}`;

const NOISE_FLOOR = 0.08;
const TOP_N = 150; // top-N by inclusion per commander...
const ROLE_TOP_N = 40; // ...plus top-40 per role not already included (keeps fill quotas stocked)
const EDHREC_DELAY_MS = 300;
const SCRYFALL_DELAY_MS = 150;
const D1_BATCH_SIZE = 500;

// Fulfillment mode (daily cron for user-requested commanders):
// ONLY_PENDING=1 processes only `pending_sync` stubs, ordered by demand
// (vote_count DESC, created_at ASC), capped per run so a burst of requests
// can't turn the cron into an EDHREC rate-limit spike.
const ONLY_PENDING = process.env.ONLY_PENDING === "1";
const PENDING_LIMIT = parseInt(process.env.PENDING_LIMIT ?? "12", 10);
const PENDING_JITTER_MIN_MS = 2000;
const PENDING_JITTER_MAX_MS = 5000;
const jitter = () =>
  PENDING_JITTER_MIN_MS + Math.random() * (PENDING_JITTER_MAX_MS - PENDING_JITTER_MIN_MS);

if (!TOKEN || !ACCOUNT_ID) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// Scryfall's API guidelines require a descriptive User-Agent on every call;
// EDHREC sits behind Cloudflare and is friendlier with one too.
// (contact email is used because manacents.com is not registered yet.)
const API_HEADERS = {
  "User-Agent": "ManaCents/1.0 (contact: geekbaggage@gmail.com)",
  Accept: "application/json;q=0.9,*/*;q=0.8",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/'/g, "''");

async function d1Query(sql, params = []) {
  const res = await fetch(`${D1}/query`, { method: "POST", headers, body: JSON.stringify({ sql, params }) });
  const json = await res.json();
  if (!json.success) throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  return json.result[0].results ?? [];
}

async function d1Batch(statements) {
  for (let i = 0; i < statements.length; i += D1_BATCH_SIZE) {
    const chunk = statements.slice(i, i + D1_BATCH_SIZE);
    // NOTE: batching goes through /query with a {batch:[...]} body — there is
    // no separate /batch route ("Route not found", verified 2026-10-13).
    const res = await fetch(`${D1}/query`, { method: "POST", headers, body: JSON.stringify({ batch: chunk.map((sql) => ({ sql })) }) });
    const json = await res.json();
    if (!json.success) throw new Error(`D1 batch failed: ${JSON.stringify(json.errors)}`);
  }
}

// v1 role classifier on Scryfall oracle text + type line. Heuristic, tunable.
// Order matters: check ramp/removal/draw before defaulting to synergy.
function classifyRole(typeLine = "", oracle = "") {
  const t = `${typeLine}\n${oracle}`;
  // Lands that tap for mana are mana base (ramp), not generic synergy.
  // (Blazemire Verge was mislabeled Core Synergy before this rule.)
  if (/land/i.test(typeLine) && /add \{[WUBRGC]\}/i.test(oracle)) return "ramp";
  // Mana rituals: "Add {B}{B}{B}" at instant/sorcery speed (Dark Ritual).
  // The old regex required lowercase "add" AND artifact type — missing both.
  if (/^add \{[WUBRGC]\}/im.test(oracle) && /instant|sorcery/i.test(typeLine)) return "ramp";
  if (/add \{[WUBRGC]\}/i.test(oracle) && /artifact/i.test(typeLine)) return "ramp"; // mana rocks
  if (/add \{[WUBRGC]\}/i.test(oracle) && /creature/i.test(typeLine)) return "ramp"; // mana dorks
  if (/search your library/i.test(oracle) && /(land|plains|island|swamp|mountain|forest)/i.test(oracle)) return "ramp"; // land fetch
  if (/(destroy|exile) target/i.test(oracle)) return "removal";
  if (/deals \d+ damage to (any target|target)/i.test(oracle)) return "removal";
  if (/counter target spell/i.test(oracle)) return "removal";
  if (/draw( a)? cards?/i.test(oracle)) return "draw";
  return "synergy";
}

// ---- Printing normalization (see Pass 2b) ----
const SUSPECT_SET_TYPES = new Set([
  "memorabilia", "spellbook", "masterpiece", "promo", "funny", "treasure_chest",
]);
const PREMIUM_SETS = new Set([
  "msc", // Marvel Super Heroes Commander — pricey UB-style printings; extend as new ones appear
]);
const STANDARD_SET_TYPES = new Set(["core", "expansion", "commander", "masters", "starter"]);
const ODDBALL_SETS = new Set([
  "sum", // Summer Magic: rare misprint run, not a real affordable option
]);

function isSuspectPrinting(r) {
  return r.promo === true || SUSPECT_SET_TYPES.has(r.set_type) || PREMIUM_SETS.has(r.set);
}

async function cheapestStandardPrinting(name) {
  const url =
    "https://api.scryfall.com/cards/search?q=" +
    encodeURIComponent(`!"${name}" game:paper`) +
    "&unique=prints&order=usd&dir=asc";
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) {
    console.warn(`Printing search failed for ${name}: ${res.status}`);
    return null;
  }
  const json = await res.json();
  for (const c of json.data ?? []) {
    const usd = parseFloat(c.prices?.usd);
    if (!usd || usd <= 0) continue;
    if (!STANDARD_SET_TYPES.has(c.set_type) || c.promo === true) continue;
    if (ODDBALL_SETS.has(c.set)) continue;
    const face = c.card_faces?.[0] ?? c;
    return {
      id: c.id,
      type_line: face.type_line ?? c.type_line ?? "",
      oracle: face.oracle_text ?? c.oracle_text ?? "",
      color_identity: (c.color_identity ?? []).join(""),
      set: c.set ?? "",
      set_type: c.set_type ?? "",
      promo: false,
      usd: usd.toFixed(2),
    };
  }
  return null;
}

// Active commanders: prefer D1's registry (populated by prior runs); on a
// cold start, fall back to the curated seed list.
// In ONLY_PENDING mode: only user-requested stubs, most-voted first, capped.
async function getCommanders() {
  if (ONLY_PENDING) {
    // Untried requests first (fulfill_attempts ASC) so high-vote spoilers
    // with no EDHREC data yet can't starve brand-new requests behind them
    // in the LIMIT cap. Then most-voted, then oldest.
    const rows = await d1Query(
      `SELECT slug, name, color_identity, deck_count
       FROM commanders
       WHERE status = 'pending_sync'
       ORDER BY fulfill_attempts ASC, vote_count DESC, created_at ASC
       LIMIT ?`,
      [PENDING_LIMIT]
    );
    console.log(`Fulfillment mode: ${rows.length} pending stub(s) (cap ${PENDING_LIMIT})`);
    return rows;
  }
  const rows = await d1Query(
    `SELECT slug, name FROM commanders ORDER BY deck_count DESC LIMIT 1000`
  );
  if (rows.length) return rows;
  const dir = dirname(fileURLToPath(import.meta.url));
  const seed = JSON.parse(readFileSync(join(dir, "seed-commanders.json"), "utf8"));
  console.log(`Cold start: using ${seed.length} seed commanders`);
  return seed;
}

async function fetchCommanderJson(slug) {
  const res = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
    headers: API_HEADERS,
  });
  if (!res.ok) {
    console.warn(`EDHREC ${res.status} for ${slug} — skipping`);
    return null;
  }
  return res.json();
}

// Defensive parse: EDHREC nests card lists under container.json_dict.cardlists,
// each with cardviews [{name, num_decks, potential_decks, ...}].
// Inclusion rate = num_decks / potential_decks (there is no `inclusion` field).
function extractCards(edhrecJson) {
  const dict = edhrecJson?.container?.json_dict ?? {};
  const lists = dict.cardlists ?? [];
  const seen = new Map(); // name -> max inclusion
  for (const list of lists) {
    for (const cv of list.cardviews ?? []) {
      if (!cv.name || !Number.isFinite(cv.num_decks) || !Number.isFinite(cv.potential_decks) || cv.potential_decks <= 0) continue;
      const rate = cv.num_decks / cv.potential_decks;
      if (rate < NOISE_FLOOR) continue;
      if (!seen.has(cv.name) || seen.get(cv.name) < rate) seen.set(cv.name, rate);
    }
  }
  return [...seen.entries()]
    .map(([name, cmdr_rate]) => ({ name, cmdr_rate }))
    .sort((a, b) => b.cmdr_rate - a.cmdr_rate);
}

// Commander metadata lives in container.json_dict.card (name, color_identity[], num_decks).
function extractCommanderMeta(edhrecJson, fallback) {
  const card = edhrecJson?.container?.json_dict?.card ?? {};
  return {
    name: card.name ?? fallback.name ?? fallback.slug,
    color_identity: Array.isArray(card.color_identity) ? card.color_identity.join("") : (fallback.color_identity ?? ""),
    deck_count: Number.isFinite(card.num_decks) ? card.num_decks : (fallback.deck_count ?? 0),
  };
}

async function resolveScryfallIds(names) {
  // name -> {id, type_line, oracle_text, color_identity, usd, image_url, ...}
  const out = new Map();
  const unique = [...new Set(names)];
  for (let i = 0; i < unique.length; i += 75) {
    const chunk = unique.slice(i, i + 75);
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { ...API_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
    });
    if (!res.ok) throw new Error(`Scryfall ${res.status} resolving names`);
    const json = await res.json();
    for (const c of json.data ?? []) {
      // Use the canonical face for double-faced cards.
      const face = c.card_faces?.[0] ?? c;
      // Price: Scryfall usd, fallback to usd_foil, floored at $0.10.
      const rawUsd = parseFloat(c.prices?.usd) || parseFloat(c.prices?.usd_foil) || 0;
      const usd = Math.max(0.1, rawUsd || 0.1);
      out.set(c.name, {
        id: c.id,
        type_line: face.type_line ?? c.type_line ?? "",
        oracle: face.oracle_text ?? c.oracle_text ?? "",
        color_identity: (c.color_identity ?? []).join(""),
        set: c.set ?? "",
        set_type: c.set_type ?? "",
        promo: c.promo === true,
        usd: usd.toFixed(2),
        image_url: c.image_uris?.normal ?? face.image_uris?.normal ?? null,
      });
    }
    if (json.not_found?.length) {
      console.warn(`Name resolution missed ${json.not_found.length} cards`);
    }
    await sleep(SCRYFALL_DELAY_MS);
  }
  return out;
}

async function main() {
  // Fulfillment mode needs the request columns; create idempotently in case
  // the API migration hasn't run yet (cron and Pages deploy independently).
  if (ONLY_PENDING) {
    for (const sql of [
      `ALTER TABLE commanders ADD COLUMN status TEXT NOT NULL DEFAULT 'live'`,
      `ALTER TABLE commanders ADD COLUMN oracle_id TEXT`,
      `ALTER TABLE commanders ADD COLUMN vote_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE commanders ADD COLUMN image_url TEXT`,
      `ALTER TABLE commanders ADD COLUMN fulfill_attempts INTEGER NOT NULL DEFAULT 0`,
      // D1 rejects non-constant DEFAULTs on ALTER — no default here; the
      // request API sets created_at explicitly on INSERT.
      `ALTER TABLE commanders ADD COLUMN created_at TEXT`,
    ]) {
      try {
        await d1Query(sql);
      } catch {
        // Already exists.
      }
    }
  }

  const commanders = await getCommanders();
  console.log(`Syncing ${commanders.length} commanders`);

  // Pass 1: gather (commander, card, rate) tuples.
  const tuples = [];
  for (const cmd of commanders) {
    const data = await fetchCommanderJson(cmd.slug);
    // Jittered delay in fulfillment mode so a burst of new commanders
    // doesn't look like a scraper spike to EDHREC.
    await sleep(ONLY_PENDING ? jitter() : EDHREC_DELAY_MS);
    if (ONLY_PENDING) {
      // Count the attempt whether or not EDHREC has data yet — this is what
      // keeps unready spoilers from starving new requests in the LIMIT cap.
      try {
        await d1Query(`UPDATE commanders SET fulfill_attempts = fulfill_attempts + 1 WHERE slug = ?`, [cmd.slug]);
      } catch {
        // Non-fatal; ordering degrades gracefully.
      }
    }
    if (!data) {
      // No EDHREC data yet (e.g. unreleased spoiler) — stays pending_sync
      // and retries on the next run. Not a failure.
      if (ONLY_PENDING) console.log(`No EDHREC data for ${cmd.slug} yet — remains queued`);
      continue;
    }
    const meta = extractCommanderMeta(data, cmd);
    cmd.name = meta.name;
    cmd.color_identity = meta.color_identity;
    cmd.deck_count = meta.deck_count;
    const cards = extractCards(data);
    for (const c of cards) tuples.push({ slug: cmd.slug, name: c.name, cmdr_rate: c.cmdr_rate });
  }
  console.log(`Collected ${tuples.length} (commander, card) tuples`);

  // Pass 2: resolve distinct names to Scryfall IDs (+ oracle text for roles).
  const resolved = await resolveScryfallIds(tuples.map((t) => t.name));
  console.log(`Resolved ${resolved.size} distinct cards`);

  // Pass 2b: printing normalization. Scryfall's name resolution returns the
  // newest printing, which is often a pricey special set (Dark Ritual's
  // default is the Marvel Commander printing at $7.42). For suspect
  // printings, swap to the cheapest standard paper printing so the stored
  // price and art reflect an affordable version.
  // NOTE: a set_type/promo filter alone is NOT enough — MSC is set_type
  // "commander" with promo=false — hence the small premium-set denylist.
  {
    const replacements = new Map(); // oldId -> newId
    for (const [name, r] of resolved) {
      if (!isSuspectPrinting(r)) continue;
      const std = await cheapestStandardPrinting(name);
      await sleep(SCRYFALL_DELAY_MS);
      if (std && std.id !== r.id) {
        replacements.set(r.id, std.id);
        resolved.set(name, std);
        console.log(`Printing swap: ${name} [${r.set}] -> [${std.set}] @ $${std.usd}`);
      }
    }
    if (replacements.size > 0) {
      const oldIds = [...replacements.keys()].map((id) => `'${id}'`).join(",");
      await d1Query(`DELETE FROM commander_synergy WHERE scryfall_id IN (${oldIds})`);
      await d1Query(`DELETE FROM cards WHERE scryfall_id IN (${oldIds})`);
      console.log(`Cleaned ${replacements.size} superseded printing IDs`);
    }
  }

  // Pass 3: per commander, top-150 + top-40 per role.
  const stmts = [];
  const cmdrStmts = [];
  const cardStmts = []; // fulfillment mode only: immediate card price backfill
  const byCommander = new Map();
  for (const t of tuples) {
    const r = resolved.get(t.name);
    if (!r) continue; // unresolvable name — skip
    if (!byCommander.has(t.slug)) byCommander.set(t.slug, []);
    byCommander.get(t.slug).push({ ...t, ...r, role: classifyRole(r.type_line, r.oracle) });
  }
  for (const cmd of commanders) {
    const list = (byCommander.get(cmd.slug) ?? []).sort((a, b) => b.cmdr_rate - a.cmdr_rate);
    if (!list.length) continue;
    const picked = new Map();
    for (const c of list.slice(0, TOP_N)) picked.set(c.id, c);
    for (const role of ["ramp", "removal", "draw"]) {
      for (const c of list.filter((x) => x.role === role && !picked.has(x.id)).slice(0, ROLE_TOP_N)) {
        picked.set(c.id, c);
      }
    }
    const ci = (cmd.color_identity ?? "").replace(/'/g, "");
    const cname = esc(cmd.name ?? cmd.slug);
    cmdrStmts.push(`INSERT INTO commanders (slug, name, color_identity, deck_count, updated_at)
VALUES ('${esc(cmd.slug)}', '${cname}', '${ci}', ${cmd.deck_count ?? 0}, datetime('now'))
ON CONFLICT(slug) DO UPDATE SET name=excluded.name, color_identity=excluded.color_identity,
  deck_count=excluded.deck_count, updated_at=excluded.updated_at;`);
    for (const c of picked.values()) {
      stmts.push(`INSERT INTO commander_synergy (commander_slug, scryfall_id, cmdr_rate, role, updated_at)
VALUES ('${esc(cmd.slug)}', '${c.id}', ${c.cmdr_rate}, '${c.role}', datetime('now'))
ON CONFLICT(commander_slug, scryfall_id) DO UPDATE SET cmdr_rate=excluded.cmdr_rate,
  role=excluded.role, updated_at=excluded.updated_at;`);
      // Fulfillment mode: backfill the cards table immediately so the new
      // commander is fully functional (priced) without waiting for the
      // nightly price-sync. Weekly mode leaves this to price-sync.
      if (ONLY_PENDING) {
        const usd = parseFloat(c.usd) || 0.1;
        const priceLog = Math.log(usd + 1.5).toFixed(6);
        cardStmts.push(`INSERT INTO cards (scryfall_id, name, usd, price_log, type_line, image_url, updated_at)
VALUES ('${c.id}', '${esc(c.name)}', ${usd.toFixed(2)}, ${priceLog}, '${esc(c.type_line ?? "")}', ${c.image_url ? `'${c.image_url}'` : "NULL"}, datetime('now'))
ON CONFLICT(scryfall_id) DO NOTHING;`);
      }
    }
  }
  await d1Batch(cmdrStmts);
  await d1Batch(stmts);
  console.log(`Upserted ${cmdrStmts.length} commanders, ${stmts.length} synergy rows`);
  if (ONLY_PENDING && cardStmts.length) {
    await d1Batch(cardStmts);
    console.log(`Backfilled ${cardStmts.length} card prices`);
  }

  // Fulfillment mode: flip successfully synced stubs to live. Commanders
  // with no EDHREC data yet (spoilers) stay pending_sync for the next run.
  if (ONLY_PENDING) {
    const fulfilled = [...byCommander.keys()].filter((slug) => (byCommander.get(slug) ?? []).length > 0);
    for (const slug of fulfilled) {
      await d1Query(`UPDATE commanders SET status = 'live', updated_at = datetime('now') WHERE slug = ?`, [slug]);
    }
    console.log(`Marked ${fulfilled.length} commander(s) live`);
  }

  // Precon membership preservation (companion to upgrades.js v3, Charlie
  // second review): printing normalization above DELETEs old synergy
  // rows and INSERTs replacement rows WITHOUT in_base_precon, so a
  // replacement printing would lose its flag. precon_membership is NEVER
  // deleted by this script — it is the durable source — so reapply flags
  // from it by card name after every sync. The engine's membership
  // NOT EXISTS anti-join protects recommendations even if this reapply
  // ever fails, but this step keeps the flag layer truthful too.
  // Note: this UPDATE is best-effort for DBs without the table/column
  // (older local fixtures); production D1 has both after the v3 migration.
  try {
    await d1Query(`UPDATE commander_synergy SET in_base_precon = 1
WHERE EXISTS (
  SELECT 1 FROM cards c
  JOIN precon_membership pm ON pm.card_name = c.name
    AND pm.commander_slug = commander_synergy.commander_slug
  WHERE c.scryfall_id = commander_synergy.scryfall_id
);`);
    console.log("Precon flags reapplied from precon_membership");
  } catch (e) {
    console.log("Precon flag reapply skipped (no precon_membership table?):", String(e.message || e).slice(0, 200));
  }

  // Step 1: rebuild global_rates FROM OUR OWN CORPUS (review fix 2026-10-13):
  // per card per full color identity = AVG inclusion across commanders of that identity.
  await d1Query(`DELETE FROM global_rates;`);
  await d1Query(`INSERT INTO global_rates (scryfall_id, color_identity, inclusion_rate)
SELECT s.scryfall_id, d.color_identity, AVG(s.cmdr_rate)
FROM commander_synergy s JOIN commanders d ON d.slug = s.commander_slug
GROUP BY s.scryfall_id, d.color_identity;`);
  console.log("global_rates rebuilt from corpus");

  // Step 3: recalculate scores.
  const dir = dirname(fileURLToPath(import.meta.url));
  const recalc = readFileSync(join(dir, "..", "recalc_scores.sql"), "utf8");
  await d1Query(recalc);
  console.log("Scores recalculated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
