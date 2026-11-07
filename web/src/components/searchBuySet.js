// Buy-whole-set helpers for the ManaBase land search (pure functions —
// no DOM, no fetch — so they are unit-testable in Node as well as the browser).
//
// Q1 (Val, Nov 6): basics are EXCLUDED from the buy set by default.
// Q2 (open — ref tracking on the add-deck link unverified): the Mana Pool
// add-deck URL built here does NOT append ref=manacents, and nothing in the
// UI claims affiliate tracking on it.
//
// DIVERGENCE NOTE (recorded, not hidden): web/src/affiliates.js already has
// manaPoolDeckUrl(), which DOES append &ref=manacents and has been live in
// production since Oct 20, 2026 (commit 1cf73c8, used by CheckoutBar.jsx for
// the upgrades buy-all). This search flow deliberately does not use it until
// Q2 is answered — the two flows are inconsistent on purpose for now, and
// must be reconciled (one helper, one rule) when Q2 clears.

export const BUY_SET_MAX_LINES = 100;

export function buildDeckText(names) {
  return names.map((n) => `1 ${n}`).join("\n");
}

function base64UrlEncode(text) {
  // Same encoding as affiliates.js (Brin's documented format): UTF-8 bytes
  // -> base64 -> URL-safe, no padding.
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function buildManaPoolAddDeckUrl(names) {
  // No ref appended (Q2 unverified). Empty selection -> Mana Pool home.
  if (!Array.isArray(names) || names.length === 0) return "https://manapool.com/";
  return `https://manapool.com/add-deck?deck=${base64UrlEncode(buildDeckText(names))}`;
}

export function buildBuySet(rows, selectedNames) {
  // rows: search result rows (with in_buy_set_by_default + cheapest.price).
  // Returns the buyable set: selected, deduplicated, basics excluded by
  // default (Q1), capped at BUY_SET_MAX_LINES. Excluded basics are reported
  // by name so the UI can say so plainly.
  const byName = new Map(rows.map((r) => [r.name, r]));
  const seen = new Set();
  const names = [];
  const excludedBasics = [];
  for (const name of selectedNames || []) {
    if (seen.has(name)) continue;
    seen.add(name);
    const row = byName.get(name);
    if (!row) continue; // not in the current result set — ignore
    if (!row.in_buy_set_by_default) {
      excludedBasics.push(name);
      continue;
    }
    names.push(name);
  }
  const overCap = Math.max(0, names.length - BUY_SET_MAX_LINES);
  const cappedNames = names.slice(0, BUY_SET_MAX_LINES);
  const total = cappedNames.reduce((s, n) => s + (byName.get(n)?.cheapest?.price ?? 0), 0);
  return {
    names: cappedNames,
    total: Math.round(total * 100) / 100,
    excludedBasics,
    capped: overCap > 0,
    overCap,
  };
}
