// POST /api/request-commander — user-requested commander intake (Stage 1).
// GET  /api/request-commander?oracle_id= — watchlist status check.
//
// Stage 1 (instant): validate the query against Scryfall, then insert a
// `pending_sync` stub into `commanders` so it appears in autocomplete
// immediately. The daily fulfillment cron (Stage 2) builds synergy data.
//
// Deduplication is by Scryfall oracle_id: Godzilla/Universes-Beyond reskins,
// typos resolving to the same card, and DFC back-face queries all merge
// into one row and one vote count.

const API_HEADERS = {
  "User-Agent": "ManaCents/1.0 (contact: geekbaggage@gmail.com)",
  Accept: "application/json;q=0.9,*/*;q=0.8",
};

// EDHREC slugs: lowercased name, apostrophes stripped, runs of
// non-alphanumerics collapsed to hyphens.
const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Idempotent schema migration for the request feature. Runs on every
// request; ALTERs are no-ops once applied.
async function ensureSchema(db) {
  for (const sql of [
    `ALTER TABLE commanders ADD COLUMN status TEXT NOT NULL DEFAULT 'live'`,
    `ALTER TABLE commanders ADD COLUMN oracle_id TEXT`,
    `ALTER TABLE commanders ADD COLUMN vote_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE commanders ADD COLUMN image_url TEXT`,
    `ALTER TABLE commanders ADD COLUMN created_at TEXT DEFAULT (datetime('now'))`,
    `CREATE INDEX IF NOT EXISTS idx_commanders_oracle ON commanders(oracle_id)`,
    `CREATE INDEX IF NOT EXISTS idx_commanders_status ON commanders(status)`,
  ]) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Column/index already exists — expected after the first run.
    }
  }
}

// Commander legality per the spec:
// - Legendary Creature or Legendary Planeswalker (any face), OR
// - "can be your commander" in oracle text (Shorikai, etc.), OR
// - Background enchantments (allowed per spec; EDHREC may 404 → stays queued), OR
// - Unreleased spoilers (legalities.commander === 'not_legal' but
//   released_at is in the future) — queued for retry, not rejected.
function validateCommander(card) {
  const faces = card.card_faces ?? [card];
  const typeLines = faces.map((f) => f.type_line ?? "").join("\n");
  const oracles = faces.map((f) => f.oracle_text ?? "").join("\n");

  const isLegendary = /legendary/i.test(typeLines);
  const isCreature = /\bcreature\b/i.test(typeLines);
  const isPlaneswalker = /planeswalker/i.test(typeLines);
  const canBeCommander = /can be your commander/i.test(oracles);
  const isBackground = /\bbackground\b/i.test(typeLines);

  if (!((isLegendary && (isCreature || isPlaneswalker)) || canBeCommander || isBackground)) {
    return { ok: false, reason: `not commander-legal (${card.type_line ?? "unknown type"})` };
  }

  const today = new Date().toISOString().slice(0, 10);
  const releasedAt = card.released_at ?? "0000-00-00";
  const legality = card.legalities?.commander;
  if (legality === "banned") {
    return { ok: false, reason: "banned in Commander" };
  }
  if (legality === "not_legal" && releasedAt <= today && !canBeCommander) {
    return { ok: false, reason: "not legal in Commander" };
  }

  return { ok: true, unreleased: releasedAt > today };
}

// Simple per-IP rate limit: 10 requests / 24h. IPs are SHA-256 hashed;
// the raw address is never stored.
async function checkRateLimit(db, request) {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const ipHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS request_limits (
         ip_hash TEXT PRIMARY KEY,
         count INTEGER NOT NULL DEFAULT 0,
         window_start TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    ).run();
    const row = await db
      .prepare(`SELECT count, window_start FROM request_limits WHERE ip_hash = ?`)
      .bind(ipHash)
      .first();
    const now = Date.now();
    if (!row || now - new Date(row.window_start + "Z").getTime() > 24 * 3600 * 1000) {
      await db
        .prepare(
          `INSERT INTO request_limits (ip_hash, count, window_start)
           VALUES (?, 1, datetime('now'))
           ON CONFLICT(ip_hash) DO UPDATE SET count = 1, window_start = datetime('now')`
        )
        .bind(ipHash)
        .run();
      return true;
    }
    if (row.count >= 10) return false;
    await db
      .prepare(`UPDATE request_limits SET count = count + 1 WHERE ip_hash = ?`)
      .bind(ipHash)
      .run();
    return true;
  } catch {
    // Rate-limit table failures fail open — the request itself matters more.
    return true;
  }
}

async function resolveCard(query) {
  const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(query)}`, {
    headers: API_HEADERS,
  });
  if (res.status === 404) return { error: "We couldn't find that card on Scryfall — check the spelling and try again." };
  if (!res.ok) throw new Error(`Scryfall ${res.status}`);
  return { card: await res.json() };
}

function cardPreview(card) {
  // DFC-safe image: top-level image_uris, else front-face image_uris.
  const image_url = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;
  const frontName = card.card_faces?.[0]?.name ?? card.name;
  return {
    oracle_id: card.oracle_id,
    name: card.name,
    front_name: frontName,
    slug: slugify(frontName),
    type_line: card.card_faces?.[0]?.type_line ?? card.type_line ?? "",
    color_identity: (card.color_identity ?? []).join(""),
    image_url,
  };
}

async function pingDiscord(env, preview, voteCount, isNew) {
  const hook = env.DISCORD_FEEDBACK_WEBHOOK_URL;
  if (!hook) return;
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "ManaCents Requests",
        embeds: [
          {
            title: `🃏 Commander Requested — ${preview.name}`,
            color: 0x10b981,
            fields: [
              { name: "Type", value: preview.type_line || "—", inline: true },
              { name: "Colors", value: preview.color_identity || "C", inline: true },
              { name: "Votes", value: String(voteCount), inline: true },
              {
                name: "Status",
                value: isNew
                  ? "New stub created — will sync within 48h"
                  : "Already requested — vote counted",
              },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch {
    // Silent — the D1 row is the source of truth.
  }
}

export async function onRequestGet({ request, env }) {
  // Watchlist status check: ?oracle_id=
  const url = new URL(request.url);
  const oracleId = (url.searchParams.get("oracle_id") || "").trim();
  if (!oracleId) return Response.json({ error: "oracle_id required." }, { status: 400 });
  try {
    await ensureSchema(env.MANACENTS_DB);
    const row = await env.MANACENTS_DB.prepare(
      `SELECT slug, name, status FROM commanders WHERE oracle_id = ?`
    )
      .bind(oracleId)
      .first();
    if (!row) return Response.json({ status: "unknown" });
    return Response.json({ status: row.status, slug: row.slug, name: row.name });
  } catch {
    return Response.json({ error: "Status check failed." }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const query = (body.query || "").trim().slice(0, 80);
  if (query.length < 2) {
    return Response.json({ error: "Type at least 2 characters." }, { status: 400 });
  }
  const previewOnly = body.preview === true;

  try {
    await ensureSchema(env.MANACENTS_DB);
    const db = env.MANACENTS_DB;

    // Resolve via Scryfall fuzzy (handles typos: "Kellan fae blooded").
    const { card, error } = await resolveCard(query);
    if (error) return Response.json({ ok: false, error });
    const preview = cardPreview(card);

    // Validate commander legality (traps: DFCs, vehicles, spoilers, Backgrounds).
    const validation = validateCommander(card);
    if (!validation.ok) {
      return Response.json({ ok: false, error: `"${card.name}" ${validation.reason}.` });
    }

    // Preview mode: return the card for the one-tap confirm UI. No DB writes.
    if (previewOnly) {
      const existing = await db
        .prepare(`SELECT slug, name, status, vote_count FROM commanders WHERE oracle_id = ?`)
        .bind(preview.oracle_id)
        .first();
      return Response.json({
        ok: true,
        preview: true,
        card: preview,
        unreleased: validation.unreleased,
        existing: existing
          ? { slug: existing.slug, name: existing.name, status: existing.status, vote_count: existing.vote_count }
          : null,
      });
    }

    if (!(await checkRateLimit(db, request))) {
      return Response.json({ ok: false, error: "Whoa, slow down — you've hit the request limit for today." }, { status: 429 });
    }

    // Deduplicate by oracle_id: reskins, typos, and DFC faces merge here.
    const existing = await db
      .prepare(`SELECT slug, name, status, vote_count FROM commanders WHERE oracle_id = ?`)
      .bind(preview.oracle_id)
      .first();
    if (existing) {
      if (existing.status === "live") {
        return Response.json({ ok: true, alreadyLive: true, slug: existing.slug, name: existing.name });
      }
      const vote_count = (existing.vote_count ?? 0) + 1;
      await db
        .prepare(`UPDATE commanders SET vote_count = ?, updated_at = datetime('now') WHERE oracle_id = ?`)
        .bind(vote_count, preview.oracle_id)
        .run();
      await pingDiscord(env, preview, vote_count, false);
      return Response.json({ ok: true, alreadyRequested: true, slug: existing.slug, name: existing.name, vote_count, oracle_id: preview.oracle_id });
    }

    // Also guard against slug collisions (two different cards, same front-face slug).
    const slugTaken = await db
      .prepare(`SELECT slug FROM commanders WHERE slug = ?`)
      .bind(preview.slug)
      .first();
    if (slugTaken) {
      return Response.json({ ok: false, error: `"${preview.name}" conflicts with an existing entry — try a more specific name.` });
    }

    // Stage 1: insert the pending_sync stub. Appears in autocomplete instantly;
    // the daily fulfillment cron builds synergy data (Stage 2).
    await db
      .prepare(
        `INSERT INTO commanders (slug, name, color_identity, deck_count, status, oracle_id, vote_count, image_url, created_at, updated_at)
         VALUES (?, ?, ?, 0, 'pending_sync', ?, 1, ?, datetime('now'), datetime('now'))`
      )
      .bind(preview.slug, preview.front_name, preview.color_identity, preview.oracle_id, preview.image_url)
      .run();
    await pingDiscord(env, preview, 1, true);

    return Response.json({
      ok: true,
      slug: preview.slug,
      name: preview.front_name,
      vote_count: 1,
      oracle_id: preview.oracle_id,
      image_url: preview.image_url,
      unreleased: validation.unreleased,
    });
  } catch (e) {
    return Response.json({ ok: false, error: "Couldn't process that request — try again in a moment." }, { status: 500 });
  }
}
