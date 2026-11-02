# Paste-into-Gemini prompt: produce ALL generatable assets for Mythic Chronicles Ep. 1
(From Robin — incorporates the spec review. Gemini generates; Robin assembles,
verifies, and finishes. Valerie will hand the files to Robin.)

---

Production task: generate every asset listed below for the ManaCents reel
"The $5 Mythic Chronicles (Ep. 1)", using the scene concepts from your spec.
Robin assembles everything programmatically, so follow the specs exactly —
especially the no-text rules. AI-rendered lettering garbles; all words, prices,
and HUD elements are added later in code.

## Global rules
- **No text, letters, numbers, logos, or watermarks baked into any image.**
  (Exception: none. Zero text. If a scene concept includes a sign or price tag,
  leave that area visually clean — Robin overlays the real text in post.)
- The brand domain, if it ever appears in a later round, is **manacents.com**
  (no hyphen). It does not appear in this round at all.
- Colors: navy `#0F172A`, lotus emerald `#10B981`, relic gold `#D4AF37`,
  mahogany `#5C3A21`, ochre `#8B5A2B`.

## Generate these 8 files

1. **`cardback_base.png` — 1600×2232, PNG.**
   An EMPTY Magic-style card back: weathered mahogany-brown outer border (`#5C3A21`),
   warm ochre-brown inner oval frame (`#8B5A2B`), subtle dark vignette, rich leather
   texture. The oval center stays clean and empty. **No text, no emblem, no symbols.**

2. **`crest_transparent.png` — 1600×1600, PNG with transparency (alpha).**
   The ManaCents Astral Node crest ONLY: lotus emerald (`#10B981`) and gold runic
   geometry, 5 pentagonal gems, a dark green-teal card silhouette with a gold "¢"
   symbol at its center. Centered with generous padding. **No words, no background**
   — transparent everywhere except the emblem itself.

3. **`scene1_hook.png` — 1296×2304, PNG or JPG.**
   Scene 1 (the hook) as designed in your spec: the POV moment of needing one
   Mythic upgrade with almost no money. Main subject centered, headroom on all
   sides (the frame gets a punch-in zoom). No text.

4. **`scene2_vendor_shark.png` — 1296×2304.**
   Scene 2 (Vendor 1, the Shark) as designed: smug vendor energy, overpriced-card
   smugness. Composition should tolerate a slow pan to the right — keep the subject
   left-of-center with scene depth to the right. No text, no price tags.

5. **`scene3_vendor_gambler.png` — 1296×2304.**
   Scene 3 (Vendor 2, the Pack Gambler) as designed: flashy sealed-product gambling
   energy. No text, no pack branding/logos.

6. **`scene4_bulk_bin.png` — 1296×2304.**
   Scene 4 (Vendor 3, the Bulk Bin) as designed: a sad bulk bin with one fake
   "Mythic" card on top (scribbled blank orange/red rarity look is fine, but **no
   readable words or letters on it**). Composition should tolerate a slow zoom
   toward the fake Mythic.

7. **`vocal_tag_manacents.wav` (or .mp3) — audio, ≤1.2 seconds.**
   A spoken vocal tag: "ManaCents!" — confident, a little playful, dry and clean
   (no music, no reverb wash). This drops over the outro at the 28.2s cue.

8. **The 3 upgrade cards for the Scene 6 spread — DECIDE AND NAME THEM.**
   Pick 3 REAL Magic cards (Mythic rarity upgrades) whose current prices are as
   close as possible to **$1.40, $1.85, and $1.43**. In your reply, list each
   card's exact name and the price you're claiming for it. Robin will verify the
   prices against Scryfall and pull the official card art himself — do NOT
   generate fake versions of real cards.

## When you reply
- Confirm each file by its exact filename above, with its dimensions.
- List the 3 chosen cards + claimed prices.
- Flag anything you could not produce to spec (e.g. if true transparency isn't
  possible for the crest, say so and use a pure solid `#0F172A` background instead —
  Robin can key it out, but only if he knows).
