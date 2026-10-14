// GET /api/upgrades?commander=<slug>&budget=<dollars>&mode=tuneup|splash
//
// Locked v2 rules applied here:
// - Noise floor: cmdr_rate >= 0.08
// - Universal ceiling: eligible global_rate < 0.40 (color-eligible decks only)
// - Scores are PRECOMPUTED in D1 (commander_synergy.raw_score); display score
//   is normalized 60-99 across the returned list.
// - Budget fill with silent role quotas (fractions of target count):
//     synergy 0.50, ramp 0.15, draw(card advantage) 0.15, removal 0.10
// - Basic lands are never recommended.

const NOISE_FLOOR = 0.08;
const UNIVERSAL_CEILING = 0.4;
const BASIC_LANDS = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"]);

const ROLE_LABELS = {
  synergy: "Core Synergy",
  ramp: "Extra Mana",
  draw: "Draws Cards", // D1 'draw' == the 'advantage' slot
  removal: "Stops Threats",
};

const QUOTAS = { synergy: 0.55, ramp: 0.2, draw: 0.15, removal: 0.1 };
const TARGETS = { tuneup: 15, splash: 6 };
const MIN_TARGETS = { tuneup: 12, splash: 4 };

function tierFor(score) {
  if (score >= 90) return { tier: "gold", label: "Core Staple Value" };
  if (score >= 75) return { tier: "emerald", label: "High Synergy Value" };
  return { tier: "gray", label: "Solid Value" };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get("commander") || "").trim().toLowerCase();
  const budget = parseFloat(url.searchParams.get("budget") || "");
  const mode = url.searchParams.get("mode") === "splash" ? "splash" : "tuneup";
  // "Include them anyway": bypass the universal ceiling (nothing is skipped).
  const includeUniversal = url.searchParams.get("includeUniversal") === "1";

  if (!slug) return Response.json({ error: "Choose a commander first." }, { status: 400 });
  if (!Number.isFinite(budget) || budget < 1 || budget > 1000) {
    return Response.json({ error: "Enter a budget between $1 and $1,000." }, { status: 400 });
  }

  try {
    const cmdr = await env.MANACENTS_DB.prepare(
      `SELECT slug, name, color_identity, deck_count FROM commanders WHERE slug = ?`
    )
      .bind(slug)
      .first();
    if (!cmdr) {
      return Response.json(
        { error: "That card is not a Commander-eligible card. Pick a name from the suggestions and try again." },
        { status: 404 }
      );
    }

    const { results: rows } = await env.MANACENTS_DB.prepare(
      `SELECT s.scryfall_id, c.name, c.usd, c.image_url, s.role, s.cmdr_rate, s.raw_score,
              COALESCE(g.inclusion_rate, 0) AS global_rate
       FROM commander_synergy s
       JOIN cards c ON c.scryfall_id = s.scryfall_id
       JOIN commanders d ON d.slug = s.commander_slug
       LEFT JOIN global_rates g
         ON g.scryfall_id = s.scryfall_id AND g.color_identity = d.color_identity
       WHERE s.commander_slug = ?
         AND s.cmdr_rate >= ?
       ORDER BY s.raw_score DESC
       LIMIT 400`
    )
      .bind(slug, NOISE_FLOOR)
      .all();

    if (!rows || rows.length === 0) {
      return Response.json({
        error: `EDHREC does not have enough data for ${cmdr.name} yet.`,
        commander: { slug: cmdr.slug, name: cmdr.name },
        budget, mode, upgrades: [], skipped: [],
      });
    }

    // Skipped universal staples (for the quiet pill): global_rate >= ceiling,
    // most-played first, basic lands excluded from this list too.
    // With includeUniversal, nothing is skipped — the ceiling is bypassed.
    const skipped = includeUniversal
      ? []
      : rows
          .filter((r) => r.global_rate >= UNIVERSAL_CEILING && !BASIC_LANDS.has(r.name))
          .sort((a, b) => b.cmdr_rate - a.cmdr_rate)
          .slice(0, 12)
          .map((r) => ({ scryfall_id: r.scryfall_id, name: r.name, usd: r.usd, image_url: r.image_url }));

    // Candidates: ceiling applied (unless bypassed), basic lands excluded.
    const candidates = rows.filter(
      (r) => (includeUniversal || r.global_rate < UNIVERSAL_CEILING) && !BASIC_LANDS.has(r.name)
    );

    const target = TARGETS[mode];
    const selected = [];
    let total = 0;

    const fits = (card) => total + card.usd <= budget + 1e-9;

    if (mode === "splash") {
      // Up to 2 top-raw-score cornerstones within 60% of budget.
      let cornerstones = 0;
      for (const c of candidates) {
        if (cornerstones >= 2 || selected.length >= target) break;
        if (total + c.usd <= budget * 0.6 + 1e-9) {
          selected.push(c);
          total += c.usd;
          cornerstones++;
        }
      }
    }

    // Phase A: role minimums (silent quotas), greedy by score.
    const minCounts = {};
    for (const [role, frac] of Object.entries(QUOTAS)) {
      minCounts[role] = Math.floor(target * frac);
    }
    const roleCount = { synergy: 0, ramp: 0, draw: 0, removal: 0 };
    for (const c of selected) roleCount[c.role] = (roleCount[c.role] ?? 0) + 1;

    for (const c of candidates) {
      if (selected.length >= target) break;
      if (selected.includes(c) || !fits(c)) continue;
      const role = c.role in minCounts ? c.role : "synergy";
      if ((roleCount[role] ?? 0) < minCounts[role]) {
        selected.push(c);
        total += c.usd;
        roleCount[role] = (roleCount[role] ?? 0) + 1;
      }
    }

    // Phase B: fill remaining slots by score within budget.
    for (const c of candidates) {
      if (selected.length >= target) break;
      if (selected.includes(c) || !fits(c)) continue;
      selected.push(c);
      total += c.usd;
    }

    // Alternates for "Already own this? Swap it": next-best affordable cards
    // not in the selected list (up to 14).
    const selectedIds = new Set(selected.map((c) => c.scryfall_id));
    const alternates = candidates.filter((c) => !selectedIds.has(c.scryfall_id)).slice(0, 14);

    // Display scores: round(60 + 39 * raw/highestRaw), clamped 60-99
    // (matches the artifact's normalizeDisplayScore exactly).
    const highestRaw = Math.max(...selected.map((c) => c.raw_score), 0) || 1;
    const displayScore = (raw) =>
      Math.max(60, Math.min(99, Math.round(60 + (39 * raw) / highestRaw)));

    const upgrades = selected.map((c) => {
      const score = displayScore(c.raw_score);
      const { tier, label } = tierFor(score);
      return {
        scryfall_id: c.scryfall_id,
        name: c.name,
        usd: c.usd,
        image_url: c.image_url,
        role: c.role,
        roleLabel: ROLE_LABELS[c.role] ?? "Core Synergy",
        cmdr_rate: c.cmdr_rate,
        score,
        tier,
        tierLabel: label,
      };
    });

    // Alternates use the same normalization scale (they naturally score at or
    // below the selected list — truthful, no carried-over scores).
    const alternateItems = alternates.map((c) => {
      const score = displayScore(c.raw_score);
      const { tier, label } = tierFor(score);
      return {
        scryfall_id: c.scryfall_id,
        name: c.name,
        usd: c.usd,
        image_url: c.image_url,
        role: c.role,
        roleLabel: ROLE_LABELS[c.role] ?? "Core Synergy",
        cmdr_rate: c.cmdr_rate,
        score,
        tier,
        tierLabel: label,
      };
    });

    return Response.json({
      commander: { slug: cmdr.slug, name: cmdr.name, color_identity: cmdr.color_identity },
      budget,
      mode,
      checkedAt: new Date().toISOString(),
      total: Math.round(total * 100) / 100,
      upgrades,
      alternates: alternateItems,
      skipped,
      includedUniversalCards: includeUniversal,
    });
  } catch (e) {
    return Response.json({ error: "ManaCents could not build the list. Please try again." }, { status: 500 });
  }
}
