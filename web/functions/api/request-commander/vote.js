// POST /api/request-commander/vote — "+1 / Notify me when ready" on a stub
// commander page. Increments vote_count (drives fulfillment priority) and
// returns the card's oracle_id so the frontend can add it to the
// localStorage watchlist.
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const slug = (body.slug || "").trim().toLowerCase().slice(0, 120);
  if (!slug) return Response.json({ error: "slug required." }, { status: 400 });

  try {
    const db = env.MANACENTS_DB;
    const row = await db
      .prepare(`SELECT slug, name, oracle_id, vote_count, status FROM commanders WHERE slug = ?`)
      .bind(slug)
      .first();
    if (!row) return Response.json({ error: "Commander not found." }, { status: 404 });

    const vote_count = (row.vote_count ?? 0) + 1;
    await db
      .prepare(`UPDATE commanders SET vote_count = ?, updated_at = datetime('now') WHERE slug = ?`)
      .bind(vote_count, slug)
      .run();

    return Response.json({
      ok: true,
      slug: row.slug,
      name: row.name,
      vote_count,
      oracle_id: row.oracle_id,
      already_live: row.status === "live",
    });
  } catch {
    return Response.json({ error: "Vote failed — try again." }, { status: 500 });
  }
}
