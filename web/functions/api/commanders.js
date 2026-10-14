// GET /api/commanders?q= — commander autocomplete from D1.
// GET /api/commanders?all=1 — full registry (slug, name, color_identity,
// deck_count, status, image_url) for client-side fuzzy search. ~300 rows.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const all = url.searchParams.get("all") === "1";
  const COLS = "slug, name, color_identity, deck_count, status, vote_count, image_url";
  try {
    if (all) {
      // status/vote_count/image_url exist after the request-commander migration;
      // fall back to the base columns on a fresh DB where it hasn't run yet.
      let commanders;
      try {
        ({ results: commanders } = await env.MANACENTS_DB.prepare(
          `SELECT ${COLS} FROM commanders ORDER BY deck_count DESC`
        ).all());
      } catch {
        ({ results: commanders } = await env.MANACENTS_DB.prepare(
          `SELECT slug, name, color_identity, deck_count FROM commanders ORDER BY deck_count DESC`
        ).all());
        commanders = (commanders ?? []).map((c) => ({ ...c, status: "live", vote_count: 0, image_url: null }));
      }
      return Response.json({ commanders: commanders ?? [] });
    }
    if (q.length < 2) {
      return Response.json({ commanders: [] });
    }
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  try {
    // status/vote_count exist after the request-commander migration; fall
    // back to the base columns on a fresh DB where it hasn't run yet.
    let commanders;
    try {
      ({ results: commanders } = await env.MANACENTS_DB.prepare(
        `SELECT slug, name, color_identity, deck_count, status, vote_count, image_url
         FROM commanders
         WHERE name LIKE ? ESCAPE '\\'
         ORDER BY deck_count DESC
         LIMIT 20`
      )
        .bind(like)
        .all());
    } catch {
      ({ results: commanders } = await env.MANACENTS_DB.prepare(
        `SELECT slug, name, color_identity, deck_count, image_url
         FROM commanders
         WHERE name LIKE ? ESCAPE '\\'
         ORDER BY deck_count DESC
         LIMIT 20`
      )
        .bind(like)
        .all());
      commanders = (commanders ?? []).map((c) => ({ ...c, status: "live", vote_count: 0 }));
    }
    commanders = commanders ?? [];
    // Missed-search logging: a 5+ character query with zero matches almost
    // always means a commander we don't carry yet. This table drives which
    // commanders to add next. Best-effort, never blocks the response.
    if (q.length >= 5 && commanders.length === 0) {
      try {
        await env.MANACENTS_DB.prepare(
          `CREATE TABLE IF NOT EXISTS missed_searches (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             query TEXT,
             created_at DATETIME DEFAULT CURRENT_TIMESTAMP
           )`
        ).run();
        await env.MANACENTS_DB.prepare(
          `INSERT INTO missed_searches (query) VALUES (?)`
        )
          .bind(q.slice(0, 60))
          .run();
      } catch {
        // Analytics is best-effort.
      }
    }
    return Response.json({ commanders });
  } catch (e) {
    return Response.json({ error: "Commander search failed." }, { status: 500 });
  }
}
