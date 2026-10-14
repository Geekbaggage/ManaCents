// ManaCents commander auto-intake (GitHub Actions).
// Promotes popular missed searches into the commander registry:
//   1. Groups missed_searches (last 30 days) by normalized query, 3+ hits.
//   2. Resolves each via Scryfall fuzzy search; must be commander-legal
//      (legendary + creature or planeswalker).
//   3. Verifies the EDHREC commander page exists for the slugified name.
//   4. Inserts into `commanders`; the synergy-sync (which runs right after
//      this step in the same workflow) then builds its synergy data.
// Permanent rejections (not a real card / not commander-legal) are logged
// to intake_log so we don't retry them weekly; transient errors simply
// retry on the next run.
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = "1acf65bc-ed4c-44ac-8815-6b46a9d57f67";
const D1 = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}`;

const MIN_HITS = 3; // a query needs this many misses in 30 days to qualify
const EDHREC_DELAY_MS = 300;
const SCRYFALL_DELAY_MS = 150;

if (!TOKEN || !ACCOUNT_ID) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
// Scryfall's API guidelines require a descriptive User-Agent on every call;
// EDHREC sits behind Cloudflare and is friendlier with one too.
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

// EDHREC slugs are the lowercased card name with runs of non-alphanumerics
// collapsed to hyphens, e.g. "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice".
const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function isCommanderLegal(card) {
  const lines = [card.type_line, ...(card.card_faces ?? []).map((f) => f.type_line)].filter(Boolean);
  return lines.some((t) => t.includes("Legendary") && (t.includes("Creature") || t.includes("Planeswalker")));
}

async function main() {
  await d1Query(`CREATE TABLE IF NOT EXISTS intake_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT,
    resolved_name TEXT,
    slug TEXT,
    status TEXT,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  let candidates;
  try {
    candidates = await d1Query(
      `SELECT lower(trim(query)) AS norm, trim(query) AS query, COUNT(*) AS hits
       FROM missed_searches
       WHERE created_at >= datetime('now', '-30 days')
       GROUP BY norm
       HAVING hits >= ?
       ORDER BY hits DESC`,
      [MIN_HITS]
    );
  } catch (e) {
    // missed_searches doesn't exist yet (no searches logged) — nothing to do.
    console.log("missed_searches table not present yet; skipping intake.");
    return;
  }
  if (!candidates.length) {
    console.log("No missed-search candidates hit the threshold.");
    return;
  }

  const seen = await d1Query(`SELECT lower(trim(query)) AS norm FROM intake_log`);
  const seenSet = new Set(seen.map((r) => r.norm));
  const existing = await d1Query(`SELECT slug, lower(name) AS lname FROM commanders`);
  const existingSlugs = new Set(existing.map((r) => r.slug));
  const existingNames = new Set(existing.map((r) => r.lname));

  let added = 0;
  for (const c of candidates) {
    if (seenSet.has(c.norm)) continue;
    const log = (status, resolved_name = null, slug = null, detail = null) =>
      d1Query(
        `INSERT INTO intake_log (query, resolved_name, slug, status, detail) VALUES (?, ?, ?, ?, ?)`,
        [c.query, resolved_name, slug, status, detail]
      );

    // 1. Resolve via Scryfall fuzzy search (handles typos: "Kellan fae blooded").
    await sleep(SCRYFALL_DELAY_MS);
    let card;
    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(c.query)}`,
        { headers: API_HEADERS }
      );
      if (res.status === 404) {
        await log("rejected", null, null, "Scryfall: no such card");
        console.log(`Reject "${c.query}": no such card on Scryfall`);
        continue;
      }
      if (!res.ok) throw new Error(`Scryfall ${res.status}`);
      card = await res.json();
    } catch (e) {
      console.log(`Transient error resolving "${c.query}": ${e.message} (will retry next run)`);
      continue;
    }

    // 2. Must be commander-legal.
    if (!isCommanderLegal(card)) {
      await log("rejected", card.name, null, `not commander-legal (${card.type_line})`);
      console.log(`Reject "${c.query}": resolved to "${card.name}", not commander-legal`);
      continue;
    }

    // 3. Skip if we already carry it (fuzzy may resolve to an existing commander).
    // Strip the " // Adventure" suffix: EDHREC slugs use the creature face only.
    const faceName = card.name.split(" // ")[0];
    const slug = slugify(faceName);
    if (existingSlugs.has(slug) || existingNames.has(faceName.toLowerCase())) {
      await log("duplicate", faceName, slug, "already in registry");
      console.log(`Skip "${c.query}": "${faceName}" already in registry`);
      continue;
    }

    // 4. Verify the EDHREC commander page exists for this slug
    // (200 = real page, 403 = no such commander — verified 2026-10-13).
    await sleep(EDHREC_DELAY_MS);
    try {
      const res = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
        headers: API_HEADERS,
      });
      if (!res.ok) {
        // Don't permanently reject: slug edge-cases retry harmlessly weekly.
        console.log(`EDHREC page missing for "${faceName}" (slug ${slug}); will retry next run`);
        continue;
      }
    } catch (e) {
      console.log(`Transient EDHREC error for "${faceName}"; will retry next run`);
      continue;
    }

    // 5. Insert. deck_count backfills on the synergy-sync right after this step.
    const ci = (card.color_identity ?? []).join("");
    await d1Query(
      `INSERT INTO commanders (slug, name, color_identity, deck_count, updated_at)
       VALUES ('${esc(slug)}', '${esc(faceName)}', '${ci}', 0, datetime('now'))
       ON CONFLICT(slug) DO NOTHING`
    );
    await log("added", faceName, slug, `${c.hits} missed searches in 30d`);
    existingSlugs.add(slug);
    added++;
    console.log(`Added "${faceName}" (${slug}) from ${c.hits} missed searches`);
  }

  console.log(`Intake complete: ${added} commander(s) added.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
