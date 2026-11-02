# Plan: Instagram Carousel — "5 Upgrades Under $1" for the New Jace

**Status:** PLAN ONLY — no build until Valerie + Gemini review and Valerie gives the go.
**Date:** Oct 20, 2026 · **Channel:** @manacents (Instagram carousel) · **Series:** Budget upgrades

## 1. The commander (assumption — correct me if wrong)
"The new Jace commander" = **Jace, Multiverse Architect** — Legendary Planeswalker from
*Reality Fracture Commander*, released Oct 2, 2026 (the precon's face commander).
Alternates from the same set if you meant a different one: *Jace, Reality Sculptor*
(main set) or *The Theorist, Jace Beleren*.

## 2. Step 0 — the data problem (must solve first)
No Jace commander exists in the ManaCents registry yet (checked D1 Oct 20), so the site
has no synergy data or prices for him — the carousel can't pull picks from ManaCents
until he's in.

**Recommended path (Option A):** add him through our own commander-request flow
(stub → EDHREC synergy sync, normally live within 48h). Then the picks are 100% real
ManaCents output, and the post can honestly say "you asked, we added him."
- Bonus: it's a live end-to-end test of the request pipeline.
- Note: the Discord request ping is still broken until the Pages secret is updated
  (separate pending fix) — the request itself works fine without it.

**Fallback (Option B):** hand-pick from his EDHREC page (top-inclusion cards under $1).
Faster, but manual, and his page is only ~18 days old so deck data is still thin.

**Recommendation:** Option A. Post lands ~Oct 23–24 instead of tomorrow — worth it for
real data and a better story.

## 3. Pick criteria (once data exists)
- Exactly 5 cards, each **under $1.00** (cheapest printing, Scryfall USD, re-checked the
  day the slides are built — the date goes on the closing slide)
- Ranked by ManaCents value score for this commander; skip any card already in his
  precon list (an "upgrade" he ships with isn't an upgrade)
- Role variety across the 5 (e.g., not 5 draw spells): aim for a mix of draw / ramp /
  protection / win-con / synergy piece
- Each pick gets a one-line "why" in plain language (no rules-lawyer text)

## 4. The slides (7 total, 1080×1350, 4:5 portrait)
Brand: dark navy bg (22,30,49), white text, lotus emerald (16,185,129), relic gold
(212,175,55), two-tone ManaCents wordmark. Same family look as the reels.

1. **Cover** — "5 UPGRADES UNDER $1" big, "for Jace, Multiverse Architect" under it,
   his card art right side, ManaCents wordmark top, "swipe →" hint
2–6. **One card each** — big number (1–5), card image, name, price pill ("$0.63"),
   value score, one-line why. Ordered cheapest → priciest OR best score first
   *(open question for Gemini)*
7. **CTA** — "Get the full list for your budget → manacents.com (link in bio)",
   "Prices checked [date] · Cheapest printings", wordmark, small line:
   "Commander requests open — ask and we add yours"

## 5. Caption draft (Valerie's voice, editable)
> 5 upgrades for the new Jace precon — all under $1 each 💸
>
> Jace, Multiverse Architect just landed and his best cheap upgrades are
> basically bulk prices rn. Full list with live prices on the site 👉 link in bio
>
> Which commander should we do next?
>
> #MTG #MagicTheGathering #MTGCommander #EDH #BudgetBrews #PreconUpgrade #ManaCents

## 6. Build & post flow
1. Robin builds slides (PIL, same brand system as the reels) → sends all 7 to Valerie
2. Valerie approves (or edits the caption) → Robin posts to @manacents via the
   connector, approval card shows final media + caption before anything goes live
3. Robin verifies the post is live and reports the link

## 7. Verification before posting
- Prices re-pulled the day of the build (nightly refresh can move a card over $1 —
  if one crosses, it swaps for the next pick, no exceptions)
- Every card name/spelling checked against Scryfall
- Slides proofed at full size (text inside safe margins, no clipped pills)

## 8. Questions for Gemini
1. Slide order: cheapest-first or best-score-first for swipe retention?
2. Cover hook: is "5 UPGRADES UNDER $1" strong enough, or lead with the commander
   ("Your Jace precon needs these 5 cards")?
3. Should the CTA slide also tease the next post (Bad Decisions Ep. 2 / combo series)?
4. Anything in the pick criteria that would mislead a buyer?
