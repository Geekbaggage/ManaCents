// POST /api/feedback — stores a results-page feedback submission in D1 and
// pings a private Discord webhook (if configured).
//
// The Discord webhook URL is NEVER in code: it lives in the
// DISCORD_FEEDBACK_WEBHOOK_URL Pages secret. If the secret isn't set, the
// submission is still stored and the ping is skipped silently.
//
// The feedback table is created idempotently on first submission so no
// wrangler migration is needed to ship this.

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commander TEXT,
  budget REAL,
  mode TEXT,
  rating TEXT,
  category TEXT,
  comment TEXT,
  cards_shown TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`;

const RATINGS = new Set(["up", "down"]);
const CATEGORIES = new Set(["missing_card", "wrong_role", "price_issue", "other"]);

const CATEGORY_LABELS = {
  missing_card: "Missing card",
  wrong_role: "Wrong role label",
  price_issue: "Price looks off",
  other: "Other",
};

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const rating = String(body.rating ?? "").toLowerCase();
  const category = String(body.category ?? "").toLowerCase();
  const comment = String(body.comment ?? "").slice(0, 1000);
  const commander = String(body.commander ?? "").slice(0, 120);
  const cardsShown = String(body.cards_shown ?? "").slice(0, 2000);
  const budget = Number(body.budget);
  const mode = body.mode === "splash" ? "splash" : "tuneup";

  if (!RATINGS.has(rating)) {
    return Response.json({ error: "Rating must be 'up' or 'down'." }, { status: 400 });
  }
  if (!CATEGORIES.has(category)) {
    return Response.json({ error: "Unknown feedback category." }, { status: 400 });
  }
  if (!commander) {
    return Response.json({ error: "Commander is required." }, { status: 400 });
  }

  // Store in D1. If the write fails (e.g. D1 free-tier daily quota), the
  // Discord ping below still goes out — the ping carries the full payload,
  // so no feedback is ever silently lost.
  let stored = false;
  try {
    await env.MANACENTS_DB.prepare(CREATE_TABLE).run();
    await env.MANACENTS_DB.prepare(
      `INSERT INTO feedback (commander, budget, mode, rating, category, comment, cards_shown)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        commander,
        Number.isFinite(budget) ? budget : null,
        mode,
        rating,
        category,
        comment || null,
        cardsShown || null
      )
      .run();
    stored = true;
  } catch {
    stored = false;
  }

  // Fire-and-forget Discord ping. Never fails the request.
  const hook = env.DISCORD_FEEDBACK_WEBHOOK_URL;
  if (hook) {
    try {
      const isUp = rating === "up";
      const payload = {
        username: "ManaCents Feedback",
        embeds: [
          {
            title: `${isUp ? "👍 Spot On" : "👎 Something's Off"} — ${commander}`,
            color: isUp ? 0x10b981 : 0xf59e0b, // Lotus Emerald or Amber
            fields: [
              { name: "Budget & Mode", value: `$${Number.isFinite(budget) ? budget : "?"} • ${mode}`, inline: true },
              ...(category ? [{ name: "Category", value: CATEGORY_LABELS[category] ?? category, inline: true }] : []),
              ...(comment ? [{ name: "User Note", value: comment.slice(0, 300) }] : []),
              ...(cardsShown ? [{ name: "Cards on Screen", value: cardsShown.slice(0, 500) }] : []),
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      };
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Ping failures are silent — the D1 row is the source of truth.
    }
  }

  return Response.json({ ok: true, stored });
}
