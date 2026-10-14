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
    return Response.json({ commanders: results ?? [] });
  } catch (e) {
    return Response.json({ error: "Commander search failed." }, { status: 500 });
  }
}
