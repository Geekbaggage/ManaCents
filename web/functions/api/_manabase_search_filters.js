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
