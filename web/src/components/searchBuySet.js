// Buy-whole-set helpers for the ManaBase land search (pure functions —
// no DOM, no fetch — so they are unit-testable in Node as well as the browser).
//
// Q1 (Val, Nov 6): basics are EXCLUDED from the buy set by default.
// Q2 (Charlie, Nov 6/7 — VERIFIED): the Mana Pool add-deck link imports a
// list into the review/mass-entry step (3/3 in stock in a real browser
// check) and Mana Pool's own affiliate docs explicitly document the URL
// with `&ref=YOUR_REFERRAL_CODE`. So the add-deck link is built WITH
// `ref=manacents`, via the established `manaPoolDeckUrl()` helper in
// affiliates.js (live in production for the upgrades buy-all since Oct 20,
// 2026). What is STILL unverified is account-side commission attribution —
// the UI must never promise commission tracking, and the link is presented
// as "Review selected lands on Mana Pool", not as a completed purchase
// (the link does not itself complete a cart or purchase).

import { manaPoolDeckUrl } from "../affiliates.js";

export const BUY_SET_MAX_LINES = 100;

export function buildDeckText(names) {
  return names.map((n) => `1 ${n}`).join("\n");
}

export function buildManaPoolAddDeckUrl(names) {
  // Thin wrapper over the established helper so the search buy flow and the
  // upgrades buy flow use one helper and one rule (ref appended, per Q2).
  return manaPoolDeckUrl(names.map((n) => ({ name: n })));
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
