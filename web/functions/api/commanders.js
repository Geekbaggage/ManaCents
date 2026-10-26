// GET /api/commanders?q= — commander autocomplete from D1.
// GET /api/commanders?all=1 — full registry (slug, name, color_identity,
// deck_count, status, image_url) for client-side fuzzy search. ~300 rows.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (url.searchParams.get("all") === "1") {
    // status/vote_count/image_url exist after the request-commander migration;
    // fall back to the base columns on a fresh DB where it hasn't run yet.
    let commanders;
    try {
      ({ results: commanders } = await env.MANACENTS_DB.prepare(
        `SELECT slug, name, color_identity, deck_count, status, vote_count, image_url
         FROM commanders ORDER BY deck_count DESC`
      ).all());
    } catch {
      try {
        ({ results: commanders } = await env.MANACENTS_DB.prepare(
          `SELECT slug, name, color_identity, deck_count, image_url
           FROM commanders ORDER BY deck_count DESC`
        ).all());
        commanders = (commanders ?? []).map((c) => ({ ...c, status: "live", vote_count: 0 }));
      } catch {
        return Response.json({ error: "Commander list failed." }, { status: 500 });
      }
    }
    return Response.json(
      { commanders: commanders ?? [] },
      // Registry changes rarely (daily sync at most); let Cloudflare cache
      // it at the edge instead of reading ~300 D1 rows on every page load.
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } }
    );
  }

  if (q.length < 2) {
    return Response.json({ commanders: [] });
  }
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  try {
    // status/vote_count/image_url exist after the request-commander migration;
    // fall back to the base columns on a fresh DB where it hasn't run yet.
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
    // Instant Discord alert (added Oct 25, 2026): ping on the FIRST miss
    // for a normalized query in 24h only. Repeats in that window are still
    // logged, but do not re-ping — otherwise autocomplete keystrokes and
    // repeat searches would flood the channel. Ping failures are silent,
    // like feedback/request pings; the D1 row is the source of truth.
    if (q.length >= 5 && commanders.length === 0) {
      let firstMissIn24h = false;
      try {
        await env.MANACENTS_DB.prepare(
          `CREATE TABLE IF NOT EXISTS missed_searches (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             query TEXT,
             created_at DATETIME DEFAULT CURRENT_TIMESTAMP
           )`
        ).run();
        const prior = await env.MANACENTS_DB.prepare(
          `SELECT COUNT(*) AS n FROM missed_searches
           WHERE lower(trim(query)) = lower(trim(?))
           AND created_at >= datetime('now', '-24 hours')`
        )
          .bind(q.slice(0, 60))
          .first();
        firstMissIn24h = (prior?.n ?? 0) === 0;
        await env.MANACENTS_DB.prepare(
          `INSERT INTO missed_searches (query) VALUES (?)`
        )
          .bind(q.slice(0, 60))
          .run();
      } catch {
        // Analytics is best-effort.
      }
      if (firstMissIn24h && env.DISCORD_FEEDBACK_WEBHOOK_URL) {
        try {
          await fetch(env.DISCORD_FEEDBACK_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: "ManaCents Missed Search",
              embeds: [
                {
                  title: `❓ Missed search — ${q.slice(0, 60)}`,
                  color: 0xf59e0b,
                  fields: [
                    { name: "Query", value: q.slice(0, 60), inline: true },
                    { name: "Note", value: "No commander matched. Repeats in 24h are logged, not re-pinged.", inline: false },
                  ],
                  timestamp: new Date().toISOString(),
                },
              ],
            }),
          });
        } catch {
          // Ping failures are silent.
        }
      }
    }
    return Response.json({ commanders });
  } catch (e) {
    return Response.json({ error: "Commander search failed." }, { status: 500 });
  }
}
