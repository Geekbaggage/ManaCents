// GET /api/upgrades?commander=<slug>&budget=<dollars>&mode=tuneup|splash
//
// Locked v2 rules applied here:
// - Noise floor: cmdr_rate >= 0.08
// - Universal ceiling: eligible global_rate < 0.40 (color-eligible decks only)
// - Scores are PRECOMPUTED in D1 (commander_synergy.raw_score); display score
//   is normalized 60-99 across the returned list.
// - Budget fill with silent role quotas (fractions of target count):
//     synergy 0.50, ramp 0.15, draw(card advantage) 0.15, removal 0.10
// - Budget utilization pass (both modes, budgets >= $15): if the score-greedy
//   pick totals under 85% of budget, iteratively swap the weakest sub-$1
//   pick for the highest pure-synergy staple (raw_score * ln(usd + 1.5),
//   i.e. synergy with the price dampener removed) priced $2–$max(8, 30% of
//   budget) — the ceiling scales because a $50 budget has real $10–$15
//   options a $15 budget doesn't — preferring the same role, stopping in
//   the [85%, 98%] band. Guard: a swap's pure synergy never under 60% of
//   the card it replaces.
// - Splash cornerstones prefer $3+ high-synergy cards (Big Splash wants a
//   few high-impact staples, not penny cards).
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

    // type_line was added 2026-10-13 and backfills on the next price-sync;
    // if the column doesn't exist yet, fall back to NULL (the splash land
    // filter treats NULL as "unknown" and skips exclusion).
    let rows;
    try {
      ({ results: rows } = await env.MANACENTS_DB.prepare(
        `SELECT s.scryfall_id, c.name, c.usd, c.image_url, c.type_line, s.role, s.cmdr_rate, s.raw_score,
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
        .all());
    } catch (e) {
      ({ results: rows } = await env.MANACENTS_DB.prepare(
        `SELECT s.scryfall_id, c.name, c.usd, c.image_url, NULL AS type_line, s.role, s.cmdr_rate, s.raw_score,
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
        .all());
    }

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

    // Big Splash pool: powerhouse slots are for mid-to-high-tier NON-LAND
    // staples — exclude lands (type_line containing "Land") and enforce a
    // $2.00 floor so a $0.25 bulk card can't take one of only 4–6 slots.
    // type_line is NULL until the nightly price-sync backfills it; NULL
    // means "unknown", so those cards stay eligible (no false exclusions).
    const isLand = (c) => c.type_line != null && /land/i.test(c.type_line);
    const splashPool =
      mode === "splash" ? candidates.filter((c) => c.usd >= 2 && !isLand(c)) : candidates;
    // If the filtered pool is too thin to fill the minimum, fall back to
    // the unfiltered pool (still excluding known lands) rather than
    // returning a 2-card "splash".
    const pool = splashPool.length >= MIN_TARGETS[mode] ? splashPool : candidates.filter((c) => !isLand(c));
    const usePool = mode === "splash" ? pool : candidates;

    if (mode === "splash") {
      // Up to 2 cornerstones: the priciest cards among the top scorers
      // (each within 60% of budget). Big Splash is for a few high-impact
      // staples — not the $0.10 cards the pure score ranking favors.
      let cornerstones = 0;
      for (const c of usePool) {
        if (cornerstones >= 2 || selected.length >= target) break;
        if (c.usd >= 3 && total + c.usd <= budget * 0.6 + 1e-9) {
          selected.push(c);
          total += c.usd;
          cornerstones++;
        }
      }
      // Fallback: if no $3+ cornerstone fit, take top-by-score within 60%.
      for (const c of usePool) {
        if (cornerstones >= 2 || selected.length >= target) break;
        if (selected.includes(c)) continue;
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

    for (const c of usePool) {
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
    for (const c of usePool) {
      if (selected.length >= target) break;
      if (selected.includes(c) || !fits(c)) continue;
      selected.push(c);
      total += c.usd;
    }

    // Phase C: budget utilization swap pass (both modes, budgets >= $15).
    // The score-greedy pick above ranks by raw_score, which dampens synergy
    // by ln(price) — so a $50 budget can return ~$20 of penny cards even
    // when the pool holds $10–$15 staples with genuinely higher synergy.
    // Pure synergy (raw_score * ln(usd + 1.5), i.e. the score with the price
    // dampener removed) is the honest "how good is this card" metric, so
    // the swap pass ranks by it: iteratively replace the weakest sub-$1
    // pick (lowest pure synergy) with the highest pure-synergy staple
    // priced $2–$max($8, 30%-of-budget) remaining in the pool — preferring
    // the same role so the role balance survives — stopping once the total
    // lands in [85%, 98%] of budget. Guard: never swap in a card whose
    // pure synergy is under 60% of the card it replaces. If the pool has
    // no valid swaps, the loop ends early and the total stays wherever
    // the honest swaps got it.
    const UTIL_LO = budget * 0.85;
    const UTIL_HI = budget * 0.98;
    const SWAP_MIN = 2;
    const SWAP_MAX = Math.max(8, budget * 0.3);
    const pureSynergy = (c) => c.raw_score * Math.log(c.usd + 1.5);
    if (budget >= 15 && total < UTIL_LO && selected.length > 0) {
      const findSwap = (drop, sameRole) => {
        const dropSyn = pureSynergy(drop);
        let best = null;
        let bestSyn = -Infinity;
        for (const c of candidates) {
          if (selected.includes(c)) continue;
          if (sameRole && c.role !== drop.role) continue;
          if (c.usd < SWAP_MIN || c.usd > SWAP_MAX) continue;
          const s = pureSynergy(c);
          if (s < dropSyn * 0.6) continue;
          if (total - drop.usd + c.usd > UTIL_HI + 1e-9) continue;
          if (s > bestSyn) { bestSyn = s; best = c; }
        }
        return best;
      };
      for (;;) {
        let dropIdx = -1;
        let dropSyn = Infinity;
        selected.forEach((c, i) => {
          if (c.usd < 1) {
            const s = pureSynergy(c);
            if (s < dropSyn) { dropSyn = s; dropIdx = i; }
          }
        });
        if (dropIdx === -1) break;
        const drop = selected[dropIdx];
        const swap = findSwap(drop, true) || findSwap(drop, false);
        if (!swap) break;
        selected[dropIdx] = swap;
        total = total - drop.usd + swap.usd;
        if (total >= UTIL_LO) break;
      }
    }

    // Alternates for "Already own this? Swap it": next-best affordable cards
    // not in the selected list (up to 14).
    const selectedIds = new Set(selected.map((c) => c.scryfall_id));
    const alternates = candidates.filter((c) => !selectedIds.has(c.scryfall_id)).slice(0, 14);

    // Budget Breaker callouts: the priciest high-synergy cards that didn't make
    // the list — top 3 by commander inclusion rate among unselected cards
    // costing > 40% of budget (or > $15). Each is paired with the
    // highest-scoring selected card covering the same role. "Pricey" is an
    // honest heuristic proxy — we don't track per-card skip reasons — so the
    // UI copy must not claim the price is why it wasn't picked. The frontend
    // lets the user add any of them anyway, per card.
    let budgetBreakers = [];
    {
      const pricey = [];
      for (const c of candidates) {
        if (selectedIds.has(c.scryfall_id)) continue;
        if (!(c.usd > budget * 0.4 || c.usd > 15)) continue;
        pricey.push(c);
      }
      pricey.sort((a, b) => b.cmdr_rate - a.cmdr_rate);
      for (const p of pricey.slice(0, 3)) {
        let partner = null;
        for (const c of selected) {
          if (c.role !== p.role) continue;
          if (!partner || c.raw_score > partner.raw_score) partner = c;
        }
        if (!partner) continue;
        budgetBreakers.push({
          scryfall_id: p.scryfall_id,
          expensiveName: p.name,
          expensiveUsd: p.usd,
          expensiveImage: p.image_url,
          expensiveRate: Math.round(p.cmdr_rate * 100),
          role: p.role,
          roleLabel: ROLE_LABELS[p.role] ?? "Core Synergy",
          partnerName: partner.name,
          partnerUsd: partner.usd,
        });
      }
    }

    // Synergy micro-tags: a support card (ramp/draw/removal) whose specificity
    // ratio (cmdr_rate / (global_rate + 0.03)) is >= 3.0 is genuinely tailored
    // to this commander, not generic — but only when real global data exists
    // (global_rate > 0); with no global data the ratio is meaningless.
    const SYNERGY_MICRO_TAG = {
      ramp: "Synergy Mana",
      draw: "Synergy Draw",
      removal: "Synergy Removal",
    };
    const roleLabelFor = (c) => {
      const base = ROLE_LABELS[c.role] ?? "Core Synergy";
      // Overwhelming commander inclusion (>=75%) means the card is a core
      // synergy piece for THIS deck, even when its oracle text matched a
      // support keyword (e.g. Saw in Half's "destroy target" is a clone
      // effect in Deadpool at 92% inclusion).
      if (c.role !== "synergy" && c.cmdr_rate >= 0.75) return "Core Synergy";
      const g = c.global_rate ?? 0;
      if (c.role !== "synergy" && g > 0 && c.cmdr_rate / (g + 0.03) >= 3.0) {
        return SYNERGY_MICRO_TAG[c.role] ?? base;
      }
      return base;
    };

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
        roleLabel: roleLabelFor(c),
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
        roleLabel: roleLabelFor(c),
        cmdr_rate: c.cmdr_rate,
        score,
        tier,
        tierLabel: label,
      };
    });

    // Search analytics (Workers Paid made writes cheap): log every search so
    // we learn which commanders/budgets are popular. Best-effort — never
    // blocks or breaks the response.
    try {
      await env.MANACENTS_DB.prepare(
        `CREATE TABLE IF NOT EXISTS search_log (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           commander_slug TEXT,
           commander_name TEXT,
           budget REAL,
           mode TEXT,
           result_count INTEGER,
           total REAL,
           created_at DATETIME DEFAULT CURRENT_TIMESTAMP
         )`
      ).run();
      await env.MANACENTS_DB.prepare(
        `INSERT INTO search_log (commander_slug, commander_name, budget, mode, result_count, total)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(cmdr.slug, cmdr.name, budget, mode, upgrades.length, Math.round(total * 100) / 100)
        .run();
    } catch {
      // Analytics is best-effort; the search result is what matters.
    }

    return Response.json({
      commander: { slug: cmdr.slug, name: cmdr.name, color_identity: cmdr.color_identity },
      budget,
      mode,
      checkedAt: new Date().toISOString(),
      total: Math.round(total * 100) / 100,
      upgrades,
      alternates: alternateItems,
      skipped,
      budgetBreakers,
      includedUniversalCards: includeUniversal,
    });
  } catch (e) {
    return Response.json({ error: "ManaCents could not build the list. Please try again." }, { status: 500 });
  }
}
