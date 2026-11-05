// Minimal analytics. No cookies. No fingerprinting.
// Sends only: event type, logical view label, optional combo/commander
// slug, affiliate destination enum, bounded UTM params, and timestamp.
//
// What we deliberately do NOT send: referrer (can leak identifiers),
// raw query strings, full URLs, user-agent, IP, or any client-generated
// visitor ID. Bots that don't run JS are excluded; JS blockers mean no
// telemetry, and the site works fine without it.

function send(payload) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

// UTM params are captured ONCE on first page load and held in memory for
// the SPA session. Reading them fresh on every event would lose attribution
// when SPA navigation replaces the URL query string.
const _firstTouchUtm = (() => {
  try {
    const p = new URLSearchParams(window.location.search);
    const out = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign"]) {
      const v = p.get(k);
      if (v && /^[A-Za-z0-9._-]{1,64}$/.test(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
})();

// Logical view labels — the SPA routes via query params, so pathname is
// always "/". The caller passes which view is actually showing.
const VIEW_LABELS = new Set([
  "landing", "combos", "combo", "results", "about", "privacy",
]);

export function trackPageview({ view, comboSlug, commanderSlug } = {}) {
  const label = VIEW_LABELS.has(view) ? "/" + view : "/unknown";
  send({
    type: "pageview",
    path: label,
    combo_slug: comboSlug || null,
    commander_slug: commanderSlug || null,
    ..._firstTouchUtm,
  });
}

export function trackAffiliateClick(destination, { view, comboSlug, commanderSlug } = {}) {
  // Destination is an enum label ("manapool", "manapool_deck", "tcgplayer"),
  // validated server-side. We send it through unchanged.
  // View must be passed explicitly — no silent "/" fallback.
  const label = VIEW_LABELS.has(view) ? "/" + view : "/unknown";
  send({
    type: "affiliate_click",
    path: label,
    combo_slug: comboSlug || null,
    commander_slug: commanderSlug || null,
    destination,
    ..._firstTouchUtm,
  });
}
