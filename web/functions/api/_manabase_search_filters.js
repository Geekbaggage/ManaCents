// Land-search match semantics (pure functions — unit-testable in Node).
// Two DISTINCT semantics (Charlie's plan correction #1, Nov 6/7):
//
// 1. "produces" — the land produces at least one of the requested colors,
//    unconditionally OR conditionally (CEO decision, Nov 6: a color search
//    includes conditional production, with the dependency shown). A land
//    matches if any of its unconditional produced colors is in the requested
//    set, or any of its conditional colors is. Lands that produce no colored
//    mana at all match only on an explicit colorless request (C).
//    Conditional production is a "may produce" match, never a guaranteed
//    source — the UI must always show the dependency next to a conditional
//    match (no false zero-color guarantee).
//    Fetchlands are the exception to the colorless rule: they produce no
//    mana at all (they tutor), so they never match produces — not even C.
//
// 2. "fits" — the land is legal in a Commander deck with the requested
//    color identity (CR 903.5c/d): the WHOLE-CARD color identity must be a
//    subset of the requested colors AND every basic land type the card has
//    must produce a color in the requested set. Basic types are checked
//    separately because a card's color identity alone does not always carry
//    them (e.g. a card with CI [] but a Forest basic land type fits only a
//    green-identity commander). A colorless identity request (C, no colors)
//    matches only rows with empty CI and no basic types.
//
// The plan's original `colors_produced ⊆ requested` test is NOT CR 903.5c
// and is not used anywhere here.

export const BASIC_TYPE_COLORS = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

export function matchesProduces(row, wantColors, wantColorless) {
  // Fetchlands produce no mana at all — they tutor for a land. They never
  // match a produces filter, not even a colorless request: C is for lands
  // that tap for {C} (or produce no colored mana), not for tutors.
  if (row.cycle === "fetch") return false;
  const conditional = row.conditional_colors ?? [];
  if (row.colors_produced.length === 0 && conditional.length === 0) return wantColorless;
  if (row.colors_produced.some((c) => wantColors.includes(c))) return true;
  // Conditional production counts (CEO decision, Nov 6) — a "may produce"
  // match; the dependency is carried on the row and shown in the UI.
  if (conditional.some((cc) => wantColors.includes(cc.color))) return true;
  // No colored production at all (unconditional or conditional): matches
  // only on an explicit colorless request.
  if (row.colors_produced.length === 0) return wantColorless;
  return false;
}

export function matchesFits(row, wantColors) {
  const ci = row.color_identity ?? [];
  if (!ci.every((c) => wantColors.includes(c))) return false;
  const basicTypes = row.basic_types ?? [];
  return basicTypes.every((t) => wantColors.includes(BASIC_TYPE_COLORS[t]));
}

// Normalized name for deterministic tie-breaking in the best-budget sort:
// lowercase, non-alphanumerics stripped ("Barkchannel Pathway // Tidechannel
// Pathway" and "Barkchannel Pathway" sort on letters only). Oracle ID is
// the final tie-break, so the order is total even for identical names.
export function normalizeName(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function compareNormalizedName(a, b) {
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (na < nb) return -1;
  if (na > nb) return 1;
  if (a.oracle_id < b.oracle_id) return -1;
  if (a.oracle_id > b.oracle_id) return 1;
  return 0;
}
