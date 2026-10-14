// ManaCents affiliate link builders.
// All codes are EMPTY placeholders until Valerie completes each signup.
// Rule: tracked URLs are built ONLY when their code is configured;
// otherwise every builder degrades to the canonical untracked destination.

export const AFFILIATE_CODES = {
  IMPACT_TAG: "", // TCGplayer via Impact — applied to outbound TCGplayer links when set
  CK_PARTNER: "", // Card Kingdom ?partner=
  MANAPOOL_REF: "", // Mana Pool ?ref=
  CARDTRADER_CODE: "", // CardTrader influencer program
  AMAZON_TAG: "", // Amazon Associates tag (e.g. "example-20"); empty = untracked
};

const has = (code) => typeof code === "string" && code.length > 0;

export const TCGPLAYER_MASS_ENTRY_URL = "https://www.tcgplayer.com/massentry";

// "1 Card Name" lines — the format TCGplayer's mass entry parses best.
export function tcgplayerListText(cards) {
  return cards.map((c) => `1 ${c.name}`).join("\n");
}

export function tcgplayerMassEntryUrl() {
  // Impact tracking for mass entry is applied via the affiliate's Impact click
  // wrapper once IMPACT_TAG is configured; until then, the canonical page.
  return TCGPLAYER_MASS_ENTRY_URL;
}

export function cardKingdomSearchUrl(cardName) {
  // Verified format: https://www.cardkingdom.com/catalog/search?search=header&filter[name]=<name>
  const url = `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(
    cardName
  )}`;
  return has(AFFILIATE_CODES.CK_PARTNER) ? `${url}&partner=${AFFILIATE_CODES.CK_PARTNER}` : url;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['",.:;!?()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function manaPoolCardUrl(cardName) {
  // Documented by Mana Pool affiliates: https://manapool.com/card/<slug>?ref=CODE
  const url = `https://manapool.com/card/${slugify(cardName)}`;
  return has(AFFILIATE_CODES.MANAPOOL_REF) ? `${url}?ref=${AFFILIATE_CODES.MANAPOOL_REF}` : url;
}

export function cardTraderUrl() {
  // Placeholder only — per-card deep-link format not verified. Canonical marketplace URL.
  return "https://www.cardtrader.com/";
}

export function amazonSearchUrl(query) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
  return has(AFFILIATE_CODES.AMAZON_TAG) ? `${url}&tag=${AFFILIATE_CODES.AMAZON_TAG}` : url;
}

// Sleeves upsell: canonical Dragon Shield product URL (verified from the
// ManaCents artifact source 2026-10-14 — no guessed product IDs).
const SLEEVES_DP_URL = "https://www.amazon.com/dp/B00WX57O7M";
export const SLEEVES_URL = () =>
  has(AFFILIATE_CODES.AMAZON_TAG)
    ? `${SLEEVES_DP_URL}?tag=${AFFILIATE_CODES.AMAZON_TAG}`
    : SLEEVES_DP_URL;

export function isEuLocale() {
  try {
    const region = new Intl.Locale(navigator.language).region;
    return ["GB", "IE", "FR", "DE", "IT", "ES", "NL", "BE", "AT", "PT", "SE", "FI", "DK", "PL", "CZ", "HU", "GR", "RO"].includes(region);
  } catch {
    return false;
  }
}
