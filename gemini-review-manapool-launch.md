# Review request: ManaCents — Mana Pool affiliate launch (Oct 20, 2026)

## Context
ManaCents (manacents.com) is a free Commander upgrade tool: pick a commander + budget, get an optimized buy list. Today Mana Pool became our FIRST approved affiliate (5% commission, ref code "manacents", Tapfiliate). Per the owner's decision, Mana Pool is now the PRIMARY buy path. TCGplayer (via Impact) is still pending approval; Card Kingdom and CardTrader also pending.

## What shipped today (all live on manacents.com)
1. **Footer affiliate disclosure re-added** — names Mana Pool only (the only approved program): "Affiliate Disclosure: ManaCents participates in the Mana Pool affiliate program. Buying cards through links on this site supports ManaCents at no extra cost to you."
2. **affiliates.js**: `MANAPOOL_REF` set to "manacents"; new `manaPoolDeckUrl(cards)` builds Mana Pool's documented whole-list link: `https://manapool.com/add-deck?deck=<base64url>&ref=manacents`, where the deck payload is "1 <Card Name>" lines, UTF-8 → base64 → URL-safe, padding stripped (encoding per Mana Pool's own affiliate docs).
3. **CheckoutBar.jsx**: Mana Pool modal gained a primary "Buy all on Mana Pool" button (add-deck link) above the per-card links. Then, as a follow-up: for non-EU visitors the checkout bar's PRIMARY button is now "Buy All on Mana Pool" (direct add-deck link); TCGplayer is a secondary button (copy list + mass-entry). EU visitors keep TCGplayer as primary and see CardTrader instead of the Mana Pool modal button (Mana Pool is US-focused).

## Verified before deploy
- Real-browser check: `manapool.com/card/sol-ring?ref=manacents` loads a full product page; a 3-card add-deck link decoded correctly on Mana Pool's Mass Entry page (3/3 in stock, Optimize enabled).
- Live bundle on manacents.com confirmed to contain the new code after each deploy.

## Questions for you
1. **Encoding edge cases**: any risk with card names containing non-ASCII (e.g. "Lim-Dûl, the Necromancer"), apostrophes, commas, or double-faced names ("Delver of Secrets // Insectile Aberration") in the add-deck payload or the per-card `/card/<slug>` URLs?
2. **UX hierarchy**: non-EU users now see BOTH a primary "Buy All on Mana Pool" button AND a secondary "Mana Pool" button that opens the per-card modal. Redundant or useful? Better label for the modal button?
3. **EU logic**: keeping TCGplayer primary for EU (Mana Pool barely serves EU). Sensible, or should EU primary be CardTrader once approved?
4. **Disclosure**: is the footer wording + the checkout bar's existing line ("Buying through these links supports ManaCents at no extra cost to you") sufficient FTC coverage for the add-deck flow?
5. **Leftover inconsistency**: the checkout bar still shows a "$35 free-shipping" upsell line (a TCGplayer-era threshold) linking to Amazon sleeves. With Mana Pool primary, is that line now misleading? Suggest replacement copy or removal.
6. Anything else in the diff you'd change — bugs, accessibility (buttons inside anchor tags), rel="sponsored" usage, or edge cases when the selected card list is empty/very long (100 cards → very long URL)?

## Diff
diff --git a/web/src/affiliates.js b/web/src/affiliates.js
index 6e4e5b1..e653eae 100644
--- a/web/src/affiliates.js
+++ b/web/src/affiliates.js
@@ -6,7 +6,7 @@
 export const AFFILIATE_CODES = {
   IMPACT_TAG: "", // TCGplayer via Impact — applied to outbound TCGplayer links when set
   CK_PARTNER: "", // Card Kingdom ?partner=
-  MANAPOOL_REF: "", // Mana Pool ?ref=
+  MANAPOOL_REF: "manacents", // Mana Pool ?ref= (approved Oct 20, 2026; 5%)
   CARDTRADER_CODE: "", // CardTrader influencer program
   AMAZON_TAG: "", // Amazon Associates tag (e.g. "example-20"); empty = untracked
 };
@@ -48,6 +48,22 @@ export function manaPoolCardUrl(cardName) {
   return has(AFFILIATE_CODES.MANAPOOL_REF) ? `${url}?ref=${AFFILIATE_CODES.MANAPOOL_REF}` : url;
 }
 
+function base64UrlEncode(text) {
+  // Brin's documented encoding: UTF-8 bytes -> base64 -> URL-safe, no padding.
+  const bytes = new TextEncoder().encode(text);
+  let bin = "";
+  for (const b of bytes) bin += String.fromCharCode(b);
+  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
+}
+
+export function manaPoolDeckUrl(cards) {
+  // Whole-list buy link: https://manapool.com/add-deck?deck=<base64url>&ref=CODE
+  // Deck links are Mana Pool's top affiliate revenue driver (per Brin Reed).
+  const text = cards.map((c) => `1 ${c.name}`).join("\n");
+  const url = `https://manapool.com/add-deck?deck=${base64UrlEncode(text)}`;
+  return has(AFFILIATE_CODES.MANAPOOL_REF) ? `${url}&ref=${AFFILIATE_CODES.MANAPOOL_REF}` : url;
+}
+
 export function cardTraderUrl() {
   // Placeholder only — per-card deep-link format not verified. Canonical marketplace URL.
   return "https://www.cardtrader.com/";
diff --git a/web/src/components/CheckoutBar.jsx b/web/src/components/CheckoutBar.jsx
index 7d61fc7..4478d95 100644
--- a/web/src/components/CheckoutBar.jsx
+++ b/web/src/components/CheckoutBar.jsx
@@ -5,6 +5,7 @@ import {
   tcgplayerMassEntryUrl,
   cardKingdomSearchUrl,
   manaPoolCardUrl,
+  manaPoolDeckUrl,
   cardTraderUrl,
   SLEEVES_URL,
   isEuLocale,
@@ -160,7 +161,16 @@ export default function CheckoutBar({ commander, budget, cards, total, remaining
               )}
             </div>
             <div className="actions">
-              <button className="primary" onClick={buyTcgplayer}>Buy All on TCGplayer</button>
+              {eu ? (
+                <button className="primary" onClick={buyTcgplayer}>Buy All on TCGplayer</button>
+              ) : (
+                <>
+                  <a href={manaPoolDeckUrl(cards)} target="_blank" rel="noreferrer sponsored">
+                    <button className="primary">Buy All on Mana Pool</button>
+                  </a>
+                  <button onClick={buyTcgplayer}>Buy All on TCGplayer</button>
+                </>
+              )}
               <button onClick={() => setModal("ck")}>Card Kingdom</button>
               {eu
                 ? <button onClick={() => setModal("ct")}>CardTrader</button>
@@ -191,7 +201,12 @@ export default function CheckoutBar({ commander, budget, cards, total, remaining
 
       {modal === "mp" && (
         <Modal title="Mana Pool products" onClose={() => setModal(null)}>
-          <p className="note">Open each card search below. Mana Pool can optimize seller and shipping choices at checkout.</p>
+          <p className="note">Buy the whole list at once — Mana Pool optimizes sellers and shipping at checkout — or open individual cards below.</p>
+          <div style={{ marginBottom: "0.8rem" }}>
+            <a href={manaPoolDeckUrl(cards)} target="_blank" rel="noreferrer sponsored">
+              <button className="primary">Buy all on Mana Pool</button>
+            </a>
+          </div>
           {cards.map((c) => (
             <div className="vendor-row" key={c.scryfall_id}>
               <span>{c.name} · {money(c.usd)}</span>
diff --git a/web/src/components/Footer.jsx b/web/src/components/Footer.jsx
index a268956..e140e20 100644
--- a/web/src/components/Footer.jsx
+++ b/web/src/components/Footer.jsx
@@ -19,6 +19,11 @@ export default function Footer({ onAbout }) {
           Content Policy. Not approved/endorsed by Wizards. Portions of the materials used
           are property of Wizards of the Coast. ©Wizards of the Coast LLC.
         </div>
+        <div className="legal">
+          Affiliate Disclosure: ManaCents participates in the Mana Pool affiliate
+          program. Buying cards through links on this site supports ManaCents at no
+          extra cost to you.
+        </div>
         <div className="legal">
           Questions or feedback? <a href="mailto:hello@manacents.com">hello@manacents.com</a>
           {" · "}
