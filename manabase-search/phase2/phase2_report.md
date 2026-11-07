# ManaBase Search — Phase 2 report (ungated parts only, 2026-11-07)

**Scope:** price producer + display-model builder + legality stamping for the
full-catalog land search. The EDHREC ranking producer is NOT built — Q3
(EDHREC terms/licensing, with Charlie) gates it; only the fetcher + a 3-card
sample were validated. Nothing merged, nothing deployed, nothing written to
`web/`, the nightly refresh untouched, the optimizer release work untouched.

**Decided by Val (Nov 6, 9:17 PM) — Q1 basics:** show basics in search
results with a "hide basics" toggle, but EXCLUDE basics from buy-whole-set
by default. Applied in the data: every row carries `is_basic` and
`in_buy_set_by_default` (false for all 12 basics, true for the other 1,089).

## Files (~/workspace/manabase-search/phase2/)

| File | What it is |
|---|---|
| `build_search_data.py` | The producer (price + display model + legality) |
| `land_classify.py` | Pure classifiers: colors produced, entry, cycle |
| `test_land_classify.py` | 65 classifier cases vs real oracle text from the pinned bulk |
| `search_data.json` | Output: 1,101 rows + meta (1.6 MB) |
| `fetch_edhrec.py` | EDHREC fetcher (sample mode only; full run gated on Q3) |
| `edhrec_sample.json` | Sample validation results |

## Counts reconciled against the roster

| Set | Expected | Got |
|---|---|---|
| Served rows | 1,101 (1,053 verified + 48 utility) | 1,101 |
| Verified served | 1,053 | 1,053 |
| Utility display-only (flagged, not held) | 48 | 48 |
| Face-rows excluded (96 MDFC + 5 adventure, Q4) | 101 | 101 excluded |
| Fetchlands excluded (fetch modeling open) | 10 | 10 excluded |
| Excluded rows leaked into the data | 0 | 0 |
| Verified rows missing from the data | 0 | 0 |
| Held on price gaps | — | **0** |
| Held on legality | — | **0** |

## Prices (snapshot 2026-11-06, pinned default_cards bulk)

- Policy: cheapest printing in ANY finish, foils count (CEO, Oct 23).
  Mirrors `scripts/manabase-refresh.mjs`: usd (nonfoil) / usd_foil (foil) /
  usd_etched (etched), cheapest wins, tie prefers nonfoil. Every row carries
  full Defect E provenance: oracle_id, printing_id, set, collector_number,
  finish, currency USD, quoted_price, observed_at, market (TCGplayer market
  via Scryfall), legalities_at.
- **Cheapest 1,101-land set total: $19,372.78.** Price range $0.06–$3,925.00
  (median $0.32). Most expensive: Mishra's Workshop $3,925.00 (ATQ #81),
  The Tabernacle at Pendrell Vale $3,619.50, Bazaar of Baghdad $2,012.63,
  Gaea's Cradle $1,649.66, Diamond Valley $690.00.
- **Live spot-check vs Scryfall (by hand, 2026-11-07): 6/6 match** —
  Hallowed Fountain $4.18 TRK #286 foil, Watery Grave $4.47 TRK #306,
  Command Tower $0.19 TDC #107, Plains $0.08 WAR #252, Floodfarm Verge
  $8.55 DSK #259 foil, City of Brass $11.49 TMC #62 (after the gold fix).

### Gold-bordered printings — found by the spot-check, fixed in the producer

The first producer run put City of Brass at $9.18 (WC97 #jk413). Live
Scryfall search said $11.49 (TMC #62). Root cause: the pinned bulk contains
gold-bordered World Championship / Pro Tour Collector printings, but
Scryfall's card search API does not return them — a plain-name search for
City of Brass returns 22 printings; the bulk has 39; the 17 missing are 2
oversized (no USD price) + 15 gold-bordered. Gold-bordered cards are
commemorative, not tournament-playable (different back, not legal to play).
Before the fix, **19 winners were gold-bordered**, including Gaea's Cradle
$303.59 (WC99) vs $1,649.66 playable and Ancient Tomb $57.21 (WC99) vs
$125.70 playable.

**Fix applied:** the producer skips `border_color == 'gold'` printings.
This aligns the bulk producer with the live-search producer (which never
sees them) and with the buy list's purpose. The pre-fix total was
$17,266.50; post-fix $19,372.78 (+$2,106.28 — the honest playable total).
0 gold-bordered winners now; 0 oversized winners; 0 non-paper winners.
**Open for Charlie:** confirm the gold-border exclusion as a standing
pricing rule (it is now in the producer, not just in this report).

## Display model (per row)

- **Colors produced:** parsed from mana-ability "Add ..." fragments +
  intrinsic abilities from basic land types (CR 305.6). Unknown production
  = zero credit. "One mana of any color" = all five; old wording "any
  type" (Reflecting Pool, Horizon of Progress, Cactus Preserve, Plaza of
  Harmony) mapped the same way; "chosen color" / "chosen basic land type"
  (Thriving lands, Thran Portal, Multiversal Passage, Nykthos) = all five
  with a note. Conditional production (verges) is a separate field with
  the dependency ("Plains or Island"). Colored mana only in
  `colors_produced`; colorless is a separate flag (mirrors the optimizer's
  `producesColorless`, so the colors-subset search rule is not broken by
  pain lands).
- **Entry:** tapped 439 / conditional 150 / untapped 512. Shock ("pay 2
  life"), snarl ("reveal ... If you don't") and "unless ..." are
  conditional with the condition recorded.
- **Cycle:** 341 classified, 760 unclassified (the plan allows
  unclassified until classified). Counts: gainland 33, check 25, temple
  15, surveil 14, thriving 22, snarl 20, storage 18, bounce 17, pain 16,
  slow 15, shock 11, fast 11, snow_dual 10, triome 10, bicycle 10,
  filter 10, bond 10, tango 10, guildgate 10, triple 17, panorama 5,
  rainbow 2, utility 2, urza 3, vivid 5, basic 12.
- **Classifier verification:** `test_land_classify.py` — **65/65 cases pass**
  against real oracle text from the pinned bulk. Two audit rounds caught
  real issues and fixed them: (1) the first full-run audit found the
  gainland/temple/surveil/thriving checks were too loose (they matched
  activated/upkeep abilities — e.g. Inventors' Fair, Prismari Campus,
  Sinister Hideout, Nykthos); all four are now entry-trigger-only, and
  the test file has negative cases for each. (2) The "any type" wording
  gap (Reflecting Pool et al. produced nothing) is fixed. Cycle ids are
  mechanic families, not just the flagship 10: e.g. "check" includes the
  5 Castles and other check-entry lands (25 total); "pain" includes the
  5 Mirage pains + Grand Coliseum (16); "slow" includes the 5 AFR
  man-lands (15); "snarl" includes the tribal reveal lands (20).
- **No colored production: 287 rows** — colorless-only lands (Ancient
  Tomb, Wastes, Strip Mine, Reliquary Tower, panoramas...) plus the 48
  no-mana utility lands. Expected for a full catalog; the UI needs a
  colorless filter in Phase 3 (flagged, not decided).

## Legality stamping (fail-closed)

- Every row validated via the shared `eligibility.py` metadata check
  (nonblank source, no "not yet checked", freshness 2026-11-07, age 0 days
  vs the real UTC date) + cross-checked against the dated GC snapshot
  (53 names, 2026-11-07) and bulk Commander legalities. 0 failures.
- GC served: all 7 (Ancient Tomb, Field of the Dead, Gaea's Cradle,
  Glacial Chasm, Mishra's Workshop, Serra's Sanctum, The Tabernacle at
  Pendrell Vale) — legal, flagged, never labeled banned. 0 banned rows in
  the served set (a banned served row aborts the run; none appeared).
- GC rows are served with the flag (the converter pattern: valid legal GC
  rows reach the data and the runtime/UI applies bracket rules), not
  excluded by `is_eligible`'s solver-side bracket-context rule.

## EDHREC ranking — fetcher validated, full run NOT done (Q3 gates it)

- `fetch_edhrec.py` sample run (2026-11-07): **top/lands.json 100 entries**
  (#1 Forest 4,498,393 decks, min 182,883 — matches Phase 1 exactly);
  Command Tower 7,737,286 / 10,507,954 (inclusion 0.7363 — matches the
  expected ~7.7M); Hallowed Fountain 1,008,456 / 2,427,109 (0.4155);
  Forest 4,498,393 / 4,807,524 (0.9357). Results in `edhrec_sample.json`.
- **Path correction:** Phase 1's note said `container.json_dict.cardviews`;
  the real path is `container.json_dict.cardlists[0].cardviews`. Fixed in
  the fetcher. Also discovered: the top list is paginated
  (`total_pages: 12`, `more: top/lands-toplands-1.json`) — the full run can
  cover ~1,200 lands' counts from those pages instead of ~1,112 per-card
  fetches. Full-run design note for when Q3 clears.
- `fetch_all()` exists but refuses to run until Q3 clears (raises with the
  gate message). No full fetch was run; no EDHREC counts are in
  `search_data.json` (meta says so explicitly).

## What Phase 3 needs / open items

- **Q3 (Charlie):** EDHREC terms/licensing — gates the ranking producer.
  When it clears: run `fetch_all()` (or the paginated top-lands variant),
  attach `most_used` per row, re-verify counts.
- **Q4 (Val + Charlie):** MDFC/adventure face policy — gates the 101
  held face-rows. They are absent from `search_data.json` entirely.
- **Q5 (Charlie):** the 48 utility rows are IN the data, flagged
  `utility — display only, pending Charlie Q5` (status
  `utility_display_only`), with Oracle text. His call decides whether
  they show in search.
- **Gold-border rule (Charlie):** confirm the exclusion as standing policy
  (see above). If he disagrees, the producer change is one filter + a
  re-run.
- **Phase 3 (API + UI)** can start on `search_data.json` as-is for
  color/price/cycle filtering; sorting by most-used waits on Q3.
- **Star Trek release (Nov 13):** re-run Phase 1 after release — the
  excluded set shrinks and the legal total grows past 1,212; Phase 2
  re-runs from the refreshed roster.

## Guardrails held

No merge to main, no production deploy, no posts, no serving-data writes
to `web/`, no nightly-refresh changes, no optimizer-release changes.
Bulk SHAs verified before use (oracle `ccbc99fd…`, default `dc826f98…`).
Producer exits 0; classifier tests 65/65.

## Addendum — preorder price correction (Phase 5, Nov 7, 2026)

**Finding (Phase 5 live spot-check vs Scryfall):** the Nov 6 cheapest
selection had picked Nov 13 Star Trek preorder prices for **18 rows** —
the pinned Nov 6 default bulk already contains the unreleased TRK/TRC/SDS
printings with preorder prices, and nothing filtered them out. Worst cases:
Hallowed Fountain $4.18 (TRK #286 foil) vs $7.55 released; Training Center
$1.05 vs $16.08; Sacred Foundry $2.03 vs $10.30. All 18 corrected rows are
listed in `phase3/phase5-report.md`.

**Fix:** both producers now skip printings with `released_at` after the
price snapshot date (2026-11-06). Re-ran `build_search_data.py`: exactly
18 rows changed (cheapest field only); cheapest set total $19,372.78 →
$19,558.88; 196 preorder printings skipped across 85 rows; 0 held on price
gaps, 0 held on legality. Policy string now reads "cheapest RELEASED
printing in ANY finish". The pre-correction $19,372.78 total in this report
is superseded.
