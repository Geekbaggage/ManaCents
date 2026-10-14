// GET /api/commanders?q= — commander autocomplete from D1.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return Response.json({ commanders: [] });
  }
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  try {
    const { results } = await env.MANACENTS_DB.prepare(
      `SELECT slug, name, color_identity, deck_count
       FROM commanders
       WHERE name LIKE ? ESCAPE '\\'
       ORDER BY deck_count DESC
       LIMIT 20`
    )
      .bind(like)
      .all();
    const commanders = results ?? [];
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
