// POST /api/track — minimal analytics event ingestion.
//
// Privacy posture: collects event type, sanitized route label, optional
// combo/commander slug, affiliate destination category (enum), bounded UTM
// params, and timestamp. No cookies. No IP storage. No user-agent storage.
// No fingerprinting. Query strings are stripped from paths to avoid
// accidentally persisting tokens or identifiers.
//
// Reporting is NOT exposed here. Aggregates are read via secured operator
// tooling (wrangler D1) only. There is no public GET on this route.
//
// Abuse resistance: strict event-type enum, destination enum, hard body-size
// cap enforced on the raw stream (not Content-Length), per-field length
// limits, slug format validation. Rate limiting is enforced at the Cloudflare
// edge (30 req / 10s per IP, Block) — no in-code IP tracking.

const MAX_BODY_BYTES = 2048;
const MAX_PATH_LEN = 200;
const MAX_SLUG_LEN = 100;

// Destination is an enum, not a URL. The client sends a category label;
// we store exactly that label. No URL parsing, no merchant URL storage.
const DESTINATIONS = new Set(["manapool", "manapool_deck", "tcgplayer"]);

// Slugs must match what the app actually generates.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Path: must be a known logical view label. The SPA routes via query
// params, so the client sends labels like "/combos" — never raw URLs.
const VIEW_PATHS = new Set([
  "/", "/landing", "/combos", "/combo", "/results", "/about", "/privacy", "/unknown",
]);

// Bounded UTM values — stored only when present, never raw full URLs.
const UTM_RE = /^[A-Za-z0-9._-]{1,64}$/;

function bad(msg, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

export async function onRequestPost({ request, env }) {
  try {
    // Enforce body cap on the RAW stream — Content-Length can be omitted
    // or lied about, so we count bytes as we read.
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch {}
        return bad("payload too large", 413);
      }
      chunks.push(value);
    }
    const raw = new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : (() => {
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
        return merged;
      })()
    );

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return bad("invalid json");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return bad("invalid body");
    }

    // Reject unknown top-level fields — no silent extra data.
    const allowedKeys = new Set([
      "type", "path", "combo_slug", "commander_slug", "destination",
      "utm_source", "utm_medium", "utm_campaign",
    ]);
    for (const k of Object.keys(body)) {
      if (!allowedKeys.has(k)) return bad("unexpected field: " + k);
    }

    const { type, path, combo_slug, commander_slug, destination,
            utm_source, utm_medium, utm_campaign } = body;

    // Strict event-type enum.
    if (type !== "pageview" && type !== "affiliate_click") {
      return bad("bad type");
    }

    // Path: required, must be a known logical view label.
    if (typeof path !== "string" || !VIEW_PATHS.has(path) || path === "/") {
      return bad("bad path");
    }
    const cleanPath = path;

    // Slugs: format-validated, length-limited.
    for (const [label, val] of [["combo_slug", combo_slug], ["commander_slug", commander_slug]]) {
      if (val != null && (typeof val !== "string" || val.length > MAX_SLUG_LEN || !SLUG_RE.test(val))) {
        return bad("bad " + label);
      }
    }

    // Destination: enum only, required for affiliate_click.
    let cleanDest = null;
    if (type === "affiliate_click") {
      if (typeof destination !== "string" || !DESTINATIONS.has(destination)) {
        return bad("bad destination");
      }
      cleanDest = destination;
    } else if (destination != null) {
      return bad("unexpected destination for pageview");
    }

    // UTM: bounded, optional, validated.
    const utm = {};
    for (const [k, v] of [["utm_source", utm_source], ["utm_medium", utm_medium], ["utm_campaign", utm_campaign]]) {
      if (v != null) {
        if (typeof v !== "string" || !UTM_RE.test(v)) return bad("bad " + k);
        utm[k] = v;
      } else {
        utm[k] = null;
      }
    }

    await env.MANACENTS_DB.prepare(
      `INSERT INTO analytics_events
         (event_type, path, combo_slug, commander_slug, destination,
          utm_source, utm_medium, utm_campaign)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      type,
      cleanPath,
      combo_slug || null,
      commander_slug || null,
      cleanDest,
      utm.utm_source,
      utm.utm_medium,
      utm.utm_campaign
    ).run();

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false }, { status: 500 });
  }
}

// No public GET. Reporting reads go through secured operator tooling
// (wrangler d1 execute) with the Cloudflare account credentials, never
// through this endpoint.
export async function onRequestGet() {
  return Response.json({ ok: false, error: "not available" }, { status: 404 });
}
