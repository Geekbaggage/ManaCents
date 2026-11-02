# Robin's Review — Reel "The $5 Mythic Chronicles (Ep. 1)" Spec
Phase 1: architecture, timing & card-back spec. For Valerie → Gemini.
Verified against live assets/specs on Oct 21, 2026.

## 0. Corrections (checked, in order of severity)
1. **❌ WRONG DOMAIN in Scene 6.** The brief puts `mana-cents.com` on the end banner.
   Our domain is **manacents.com** (no hyphen). Fix before any art is generated —
   a hyphenated URL sends viewers to a site we don't own.
2. **⚠️ The "existing transparent HD logo asset" does not exist.** What we actually
   have: `logo.png` (1200×896, RGB, baked on navy), `logo-mark.png` (256×256, RGB —
   too small for a hero emblem), `logo-animated.mp4`. No transparent crest anywhere.
   → The crest goes on the generation manifest below (transparent PNG, emblem only).
3. **⚠️ The vocal tag is an asset we don't have.** "ManaCents!" at 28.2s needs a
   generated audio file (see manifest). Our theme is instrumental by design; a
   one-word spoken tag over the outro works, but it has to be produced.
4. **⚠️ The 3 spread cards are unnamed.** Prices ($1.40 / $1.85 / $1.43) can't be
   verified and art can't be sourced until they're named. If they're real cards,
   Robin pulls Scryfall art for free and verifies the prices. If they're invented,
   they go on the generation manifest instead.
5. **✓ HUD math checks out:** 1.40 + 1.85 + 1.43 = 4.68 · 4.75 − 4.68 = $0.07 left ·
   4.68/4.75 ≈ 98.5% ≈ "98% OPTIMIZED." Timeline sums to exactly 30.0s. The
   safe-zone box (X 90–990, Y 220–1520) is sane for Reels UI.

## 1. Timeline critique
**What works:** cold-open POV hook; the vendor escalation ladder ($140 shark →
pack EV → bulk-bin despair) is a clean comedy structure; the 21s hero-card pattern
interrupt; the register tick-down as the payoff beat; the Part 2 cliffhanger.

**What's crowded or sagging:**
- **Scene 1 has two pills saying the same thing.** The POV pill ("...have $4.75")
  and the HUD pill ("BUDGET: $4.75") stack in the same top zone for 3s. Merge them:
  the POV pill carries the setup alone; the HUD fades in with Scene 2 at 3.0s.
- **Vendor scenes sag at 6s each.** Each gag (price tag, EV badge, HOPE LEVEL)
  lands in ~2s; the remaining 4s is pan time. Tighten to 5.5s each.
- **Scene 5 is the retention valley.** 5.5s on a near-static card back is long.
  The push-in + light sweep help; add a second sweep (or a slow emerald glow pulse)
  mid-hold so the frame never sits dead.
- **Scene 6 is overloaded.** Flip + 3-card spread + equation + HUD tick + vocal
  pulse + end-hook badge in 3.5s = the most important scene gets the least time.
  It earns 5.5s in the retime below (flip 24.5→24.9, spread settled by 25.5,
  equation at 26.2, register tick ~26.5, vocal tag 28.2 ✓, end hook 29.0–30.0 ✓ —
  the brief's audio cue and end hook survive unchanged).

**Proposed retime (still exactly 30.0s):**

| Scene | Brief | Proposed |
|---|---|---|
| 1 Hook | 0.0–3.0 | 0.0–3.0 (HUD pill held back to 3.0s) |
| 2 Shark | 3.0–9.0 | 3.0–8.5 |
| 3 Gambler | 9.0–15.0 | 8.5–14.0 |
| 4 Bulk bin | 15.0–21.0 | 14.0–19.5 |
| 5 Card back | 21.0–26.5 | 19.5–24.5 |
| 6 Flip + spread | 26.5–30.0 | 24.5–30.0 |

**Legibility/mechanics notes:**
- HUD pill: fixed width, right-aligned, tabular digits — the tick-down must not
  make the pill resize/jitter. Final state text ("$0.07 LEFT · 98% OPTIMIZED") is
  long; size the pill for the FINAL string from the start.
- Equation + card prices: render as pills *under* each card at ≥48px bold, never
  as on-card text. Three cards ≈ 320px wide each inside the safe zone.
- HOPE LEVEL red flash: ≤3 pulses, use brand soft red `#F87171`.
- End-hook badge: place ~Y 1380–1480 — inside the safe zone, clear of the caption bar.

## 2. Card-back composite plan — DECISION: programmatic PIL assembly
Assemble in Python (PIL) from layers, do NOT bake one finished image:
- **Base layer:** ONE Gemini-generated texture — empty brown card back (frame +
  oval + vignette), **no text, no emblem**. AI image models garble lettering;
  our PIL text is pixel-exact and brand-consistent every episode.
- **Crest layer:** transparent PNG (manifest below), composited center-oval.
- **Text layers (PIL):** "MANA" white bold with a gold bevel (dual offset shadow
  layers), straight-centered — at phone size straight reads cleaner than per-letter
  arching; "CENTS" in Lotus Emerald `#10B981` with a thin dark outline for contrast
  on brown. Font: DejaVu Sans Bold (our brand font) unless Gemini supplies a
  runic display font file we can legally embed.
- **Animation layers stay separate** so the pipeline can animate them: push-in
  (scale 1.00→1.08 crop), light sweep (moving diagonal gold/white gradient at low
  alpha, masked to the card), and the 26.5s flip (perspective warp over ~12 frames
  with a mid-flip edge highlight). A baked template can't do any of that cleanly.

## 3. Build plan (for Gemini's evaluation)
- **Script:** `manacents-ig-reel/build_reel_mythic_chronicles_ep1.py` — PIL frame
  renderer at 30fps (900 frames) → FFmpeg (libx264 + AAC), same pipeline as our
  previous reels. Placeholder slates for Phase 1 timing validation.
- **Timeline config (JSON, embedded in the script):**
```json
{
  "fps": 30, "duration_s": 30.0, "size": [1080, 1920],
  "safe_zone": {"x": [90, 990], "y": [220, 1520]},
  "hud": {"anchor": "top-right", "pos": [990, 240], "appears_at": 3.0,
          "tick_down_at": 26.5, "final_text": "$0.07 LEFT · 98% OPTIMIZED"},
  "scenes": [
    {"id": "s1_hook",    "in": 0.0,  "out": 3.0,  "camera": "punch-in 1.08->1.00"},
    {"id": "s2_shark",   "in": 3.0,  "out": 8.5,  "camera": "slow pan right",
     "overlay": "price tag $140.00"},
    {"id": "s3_gambler", "in": 8.5,  "out": 14.0, "camera": "whip-pan in (0.2s blur)",
     "overlay": "badge PACK EV: $0.14"},
    {"id": "s4_bulkbin", "in": 14.0, "out": 19.5, "camera": "slow zoom",
     "overlay": "HUD flash HOPE LEVEL: 0% (<=3 pulses, #F87171)"},
    {"id": "s5_cardback","in": 19.5, "out": 24.5, "camera": "slide-in 0.4s ease-out + push-in 1.00->1.08 + light sweep x2",
     "bg": "#0F172A"},
    {"id": "s6_flip",    "in": 24.5, "out": 30.0, "camera": "Y-flip 0.4s at 24.5, spread settles 25.5",
     "audio_cue": {"t": 28.2, "event": "vocal tag + banner scale pulse 1.0->1.12->1.0"},
     "end_hook": {"t": 29.0, "text": "FOLLOW FOR PART 2: $4.75 vs. THE $3,000 WHALE", "y": 1420}}
  ]
}
```
- **Audio:** bed = "The Last Move" theme, 0–30s edit (master in
  `manacents-ig-reel/assets/`); vocal tag mixed at 28.2s with a −5 dB duck on the
  bed from 27.9–28.8s (FFmpeg volume automation); final mix normalized for IG.

## 4. Asset manifest — what Gemini/Valerie generate next
All scene art: **no baked-in text anywhere** (every word is a programmatic overlay).

| File | Spec |
|---|---|
| `cardback_base.png` | 1600×2232 PNG. EMPTY MTG-style card back: mahogany border `#5C3A21`, ochre inner oval `#8B5A2B`, subtle dark vignette. **No text, no emblem, no logo.** |
| `crest_transparent.png` | 1600×1600 PNG **with alpha**. Astral Node crest ONLY (emerald `#10B981` + gold, 5 pentagonal gems, gold ¢), centered, padded. No text, no background. |
| `scene1_hook.png` | 1296×2304 (1.2× for zoom headroom). Hook visual, subject centered. |
| `scene2_vendor_shark.png` | 1296×2304. Vendor/shark scene, pan-friendly composition. |
| `scene3_vendor_gambler.png` | 1296×2304. Pack-gambler scene. |
| `scene4_bulk_bin.png` | 1296×2304. Bulk bin with a fake "Mythic" card, zoom-friendly. |
| `vocal_tag_manacents.wav` | ≤1.2s spoken "ManaCents!" — energetic, dry/clean, no music under it. |
| The 3 spread cards | **Names first** (Gemini/Valerie). If real: Robin pulls Scryfall art (1040×1454) + verifies $1.40/$1.85/$1.43. If invented: 3 art images, 1040×1454 each, no text. |

## 5. Questions back to Gemini
1. Name the 3 spread cards (or confirm Robin should source real mythics at those prices).
2. OK to merge the Scene 1 pills (HUD debuts at 3.0s)?
3. OK to adopt the proposed retime (Scene 6 grows to 5.5s; audio cue + end hook unchanged)?
