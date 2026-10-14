// One-time backfill: populate commanders.image_url for rows that predate the column.
// Run: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/backfill-commander-images.mjs
// Safe to re-run; only touches rows with NULL image_url. Uses Scryfall's
// collection endpoint (75 names per call) and the `small` image variant,
// which is plenty for the 38px suggestion thumbnails.

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = "1acf65bc-ed4c-44ac-8815-6b46a9d57f67";
const D1 = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}`;
const API_HEADERS = {
  "User-Agent": "ManaCents/1.0 (contact: geekbaggage@gmail.com)",
  Accept: "application/json;q=0.9,*/*;q=0.8",
};
if (!TOKEN || !ACCOUNT_ID) { console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function d1(sql, params = []) {
  const res = await fetch(`${D1}/query`, {
    method: "POST", headers, body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`D1 failed: ${JSON.stringify(json.errors)}`);
  return json.result[0].results ?? [];
}

const rows = await d1(`SELECT slug, name FROM commanders WHERE image_url IS NULL`);
console.log(`Backfilling ${rows.length} commanders`);
const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r.slug]));
let done = 0;
const missed = [];
for (let i = 0; i < rows.length; i += 75) {
  const chunk = rows.slice(i, i + 75);
  const res = await fetch("https://api.scryfall.com/cards/collection", {
    method: "POST",
    headers: { ...API_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers: chunk.map((r) => ({ name: r.name })) }),
  });
  if (!res.ok) throw new Error(`Scryfall ${res.status}`);
  const json = await res.json();
  const found = new Set();
  const stmts = [];
  for (const c of json.data ?? []) {
    const slug = byName.get((c.name ?? "").toLowerCase());
    if (!slug) continue;
    found.add(slug);
    const face = c.card_faces?.[0] ?? c;
    const url = face.image_uris?.small ?? c.image_uris?.small ?? "";
    if (url) stmts.push({ sql: `UPDATE commanders SET image_url = ? WHERE slug = ?`, params: [url, slug] });
  }
  for (const r of chunk) if (!found.has(r.slug)) missed.push(r.name);
  if (stmts.length) {
    const bres = await fetch(`${D1}/query`, {
      method: "POST", headers, body: JSON.stringify({ batch: stmts }),
    });
    const bjson = await bres.json();
    if (!bjson.success) throw new Error(`D1 batch failed: ${JSON.stringify(bjson.errors)}`);
    done += stmts.length;
  }
  await sleep(150);
}
console.log(`Done: ${done} image URLs backfilled`);
if (missed.length) console.log(`No Scryfall match for ${missed.length}:`, missed.slice(0, 10).join(" | "));
