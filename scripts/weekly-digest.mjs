// ManaCents weekly Discord digest (GitHub Actions, Mondays 08:00 PT).
// Posts top searches, missed searches, feedback summary, and newly added
// commanders to the feedback Discord webhook as a rich embed.
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DISCORD_FEEDBACK_WEBHOOK_URL

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const WEBHOOK = process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
const DATABASE_ID = "1acf65bc-ed4c-44ac-8815-6b46a9d57f67";
const D1 = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}`;

if (!TOKEN || !ACCOUNT_ID || !WEBHOOK) {
  console.error("Missing CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, or DISCORD_FEEDBACK_WEBHOOK_URL");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function d1Query(sql, params = []) {
  const res = await fetch(`${D1}/query`, { method: "POST", headers, body: JSON.stringify({ sql, params }) });
  const json = await res.json();
  if (!json.success) throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  return json.result[0].results ?? [];
}

async function tableExists(name) {
  const rows = await d1Query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
  return rows.length > 0;
}

async function main() {
  const fields = [];

  if (await tableExists("search_log")) {
    const total = await d1Query(
      `SELECT COUNT(*) AS n, ROUND(AVG(budget), 0) AS avg_budget FROM search_log
       WHERE created_at >= datetime('now', '-7 days')`
    );
    const top = await d1Query(
      `SELECT commander_name, COUNT(*) AS n FROM search_log
       WHERE created_at >= datetime('now', '-7 days')
       GROUP BY commander_slug ORDER BY n DESC LIMIT 5`
    );
    const modes = await d1Query(
      `SELECT mode, COUNT(*) AS n FROM search_log
       WHERE created_at >= datetime('now', '-7 days') GROUP BY mode`
    );
    const topLines = top.map((r, i) => `${i + 1}. ${r.commander_name} (${r.n})`).join("\n") || "No searches yet";
    const modeLine = modes.map((r) => `${r.mode}: ${r.n}`).join(" · ") || "—";
    fields.push({
      name: `🔍 Searches (7d): ${total[0]?.n ?? 0}`,
      value: `${topLines}\n\nAvg budget $${total[0]?.avg_budget ?? "—"} · ${modeLine}`,
    });
  }

  if (await tableExists("missed_searches")) {
    const missed = await d1Query(
      `SELECT query, COUNT(*) AS n FROM missed_searches
       WHERE created_at >= datetime('now', '-7 days')
       GROUP BY lower(trim(query)) ORDER BY n DESC LIMIT 5`
    );
    const lines = missed.map((r, i) => `${i + 1}. "${r.query}" (${r.n})`).join("\n") || "None — every search found its commander";
    fields.push({ name: "❓ Missed searches (7d)", value: lines });
  }

  if (await tableExists("intake_log")) {
    const added = await d1Query(
      `SELECT resolved_name, slug FROM intake_log
       WHERE status = 'added' AND created_at >= datetime('now', '-7 days')
       ORDER BY created_at DESC`
    );
    if (added.length) {
      fields.push({
        name: `✨ Auto-added commanders (${added.length})`,
        value: added.map((r) => `• ${r.resolved_name}`).join("\n"),
      });
    }
  }

  if (await tableExists("feedback")) {
    const fb = await d1Query(
      `SELECT rating, COUNT(*) AS n FROM feedback
       WHERE created_at >= datetime('now', '-7 days') GROUP BY rating`
    );
    const up = fb.find((r) => r.rating === "up")?.n ?? 0;
    const down = fb.find((r) => r.rating === "down")?.n ?? 0;
    fields.push({ name: "💬 Feedback (7d)", value: `👍 ${up} · 👎 ${down}` });
  }

  if (!fields.length) {
    console.log("No analytics tables exist yet; skipping digest.");
    return;
  }

  const embed = {
    username: "ManaCents Weekly",
    embeds: [
      {
        title: "📊 ManaCents weekly digest",
        color: 0x10b981,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: "manacents.com" },
      },
    ],
  };

  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(embed),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
  console.log("Digest posted.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
