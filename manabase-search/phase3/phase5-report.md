# ManaBase Land Search — Phase 5 report (2026-11-07)

**Branch:** `robin/manabase-search-2026-11-06` (from main `beda88c`).
**Preview:** https://search-phase5.manacents.pages.dev (deployment `e77daf87`).
**Status:** built + tested (22/22) + preview-deployed + hosted matrix 27/27
(+ 5 row lookups confirmed via pagination). No merge, no production deploy,
no posts, no nightly-refresh changes, no optimizer changes.

## What Phase 5 did

### 1. Face rows wired into serving data (Q4)
- Generator `phase3/generate_serving_data.py` now merges
  `phase2/face_rows.json` (101 rows) with `phase2/search_data.json`
  (1,101 rows) → `web/functions/api/_manabase_search.json`
  (**1,334,742 bytes, 1,202 rows**).
- Served: 1,101 verified+utility + 101 face rows = **1,202**. Held: **10
  fetchlands only**. Excluded: 100 (3 banned + 97 not Commander-legal).
  Coverage: 1,202 + 10 = 1,212 legal; + 100 excluded = 1,312 roster.
- Face-row `basic_types` comes from each face row itself (land-face type
  lines) — the generator never looks face rows up in the bulk, so the
  combined `"X // Y"` type line can never leak in. All 101 face rows have
  `basic_types: []` (no basic land types on any land face).
- Face rows carry `face_class`, `land_drop` (code + note), `land_faces`,
  `other_faces`, `buy_name` (canonical purchasable name = full `"X // Y"`).
  Land-drop codes: `playable_choice` 60 / `land_front` 4 /
  `requires_transformation` 32 / `single_card` 5 (adventure).
- Cheapest set total: **$19,945.00** ($19,558.88 search + $386.12 faces).

### 2. Charlie's Q14 sort implemented — "Best budget — researched"
- Charlie's file `phase2/charlie-budget-land-sort-2026-11-07.json`
  (25 type lists, 284 ranked entries / 283 distinct cards) is attached per
  row as `budget_rankings` (from `types[].members`; `cards[].rankings`
  asserted to match exactly, 0 mismatches).
- API: `sort=best_budget` + `type=<id>`. Within the selected type, default
  ranked rows come first by editorial rank; ties by actual selected price,
  normalized name, then Oracle ID. Unranked members of the type follow
  alphabetically (null rank = unreviewed, not worst quality). Ranks are
  priorities INSIDE one type, never global power scores — `sort=best_budget`
  without a type is a 400 that says so.
- **$5.00-inclusive gate (500 cents)** on Charlie's RELEASED quote,
  re-checked by the API on every request so a bad serving file cannot
  silently promote a card. All 284 default-ranked entries pass it.
- **Preorder separation:** the 7 preorder-only cards (Godless Shrine,
  Hallowed Fountain, Sacred Foundry, Stomping Ground, Temple Garden,
  Training Center, Watery Grave — all releasing Nov 13) are never ranked;
  they appear in the type's alphabetical remainder with a `preorder_only`
  flag, and in `meta.preorderWatch` with preorder vs released prices.
- **No EDHREC-derived metric anywhere:** `restricted_usage_metrics_used =
  false`, `measured_most_played_claim = false`; the only "edhrec" mentions
  in Charlie's file are disclaimers. Serving-data scan in tests confirms no
  `edhrec` / `most_used` / `num_decks` field on any row or in meta.
  `sort=most_used` / `sort=inclusion` still 400 (Q3 unchanged).
- UI: sort option "Best budget — researched", Type/role dropdown (25 types,
  ranked counts from meta; picking the sort without a type selects Two Color
  Fixing), rank badge `#N budget` + rank context on ranked cards, preorder
  badge, preorder watch list line, face-row land-drop labels.

### 3. Preorder price correction (found by the Phase 5 live spot-check)
- **Finding:** the Nov 6 producers had picked Nov 13 Star Trek preorder
  prices for **18 served rows** (the pinned Nov 6 bulk already contains the
  unreleased TRK/TRC/SDS printings). E.g. Hallowed Fountain $4.18 TRK #286
  foil vs $7.55 released; Training Center $1.05 vs $16.08; Sacred Foundry
  $2.03 vs $10.30.
- **Fix:** both producers now exclude printings with `released_at` after
  the price snapshot date (2026-11-06) from cheapest selection. Re-ran
  both: `search_data.json` changed in exactly 18 rows (cheapest field
  only); cheapest set total $19,372.78 → **$19,558.88** (+$186.10).
  `face_rows.json` re-ran with **0 changes** (total still $386.12).
  196 preorder printings skipped across 85 rows.
- Corrected prices now track Charlie's Nov 7 released quotes within normal
  day-to-day movement (most within $0.16; largest gaps are thin-printing
  moves, e.g. Phyrexian Tower — Charlie's released min there is a
  gold-bordered WC printing, ours excludes gold, so ours is higher and is
  the correct playable price).
- The Phase 3 live note "Hallowed Fountain via live API: $4.18 TRK #286
  foil" is superseded: it is now **$7.39 ECL #265** (live API verified).

## Price spot-checks vs LIVE Scryfall (Nov 7)

| Card | Ours (Nov 6, corrected) | Live (Nov 7) | Δ | Note |
|---|---|---|---|---|
| Command Tower | $0.19 TDC #107 | $0.21 | $0.02 | normal movement |
| Exotic Orchard | $0.21 DSC #275 | $0.23 | $0.02 | normal movement |
| Fabled Passage | $0.41 PLST #BLB-252 | $0.42 | $0.01 | normal movement |
| Demolition Field | $0.23 FIC #385 | $0.28 | $0.05 | normal movement |
| War Room | $1.12 FDC #317 | $1.39 | $0.27 | same printing, day-to-day move |
| Hallowed Fountain | $7.39 ECL #265 | $7.55 released | $0.16 | preorder leak corrected |
| Training Center | $16.62 CMR #358 | $16.08 released | $0.54 | preorder leak corrected |
| Sacred Foundry | $10.30 PEOE #256p | $10.30 released | $0.00 | preorder leak corrected |

Charlie's released quotes are within normal movement; the pre-correction
outliers were OUR preorder picks, not his. No divergence over $0.10 remains
unexplained (War Room $0.27 is the same FDC #317 printing moving in a day).

## SHA provenance caveat (flagged, not hidden)

Charlie's handoff states the sort JSON SHA-256 is
`dbfbf125d88a3335ee81b31ad8da02cb0497562287101df24df492cfb82b4da6`, but the
file downloaded from Drive hashes to
`5261fd25c198723f27d774a3697b6680747ecbee263f1ad325b26fd372f0a822`
(independently re-hashed; also not matching with a trailing newline
stripped). Content checks all pass: 1,212 cards reconcile exactly with the
search roster (1,101 + 101 + 10 held fetch); counts block matches the
handoff (284 / 283 / 1,006 / 1,013); prices spot-checked vs live Scryfall.
**Treat as verified-by-content, not byte-identical provenance.** Both SHAs
are recorded in the serving meta (`ranking.sha_stated` /
`ranking.sha_downloaded`, `sha_match: false`) so the caveat travels with
the data. Do not claim byte-identical provenance.

## Tests — 22/22 pass (`npm run test:manabase-search`)

15 original (counts updated for the 1,202-row served set) + 7 new:
- best_budget two_color_fixing view: 208 members, 161 ranked; rank-1 pain
  tie (10 members, Battlefield Forge first at $0.20) and rank-4 check tie
  ordered by price then normalized name; unranked tail alphabetical;
  deterministic pagination.
- best_budget rainbow view: 5 rows, Command Tower first (ranks 1–5).
- $5.00-inclusive gate unit test (500 → pass, 501 → fail, null → fail,
  preorder-only → fail, non-default → fail, wrong type → fail).
- Preorder separation: watch list 7, all released > $5, release 2026-11-13;
  all 7 unranked + flagged in the type view; Hallowed Fountain $7.39 ECL #265.
- max_price boundary: $0.06 → 3 rows, $0.05 → 0, $5 → 1,004 rows.
- Face rows via API: Barkchannel Pathway (modal, 2 land faces,
  playable_choice), Ishgard (adventure, single_card, other face Faith &
  Grief), Aclazotz (transform_back, requires_transformation).
- Coverage arithmetic: 1,202 + 10 = 1,212 legal; + 100 = 1,312 roster.
- No-EDHREC scan; face-row serving counts (60/4/32/5); transform-back
  labeling (32); untapped_only excludes transform-back rows (525 total).

Full build passes (`npm run build`: combos validator 69/69 + search 22/22;
Vite 40 modules; frontend JS 275 KB).

## Hosted matrix — 27/27 pass on search-phase5 (+ 5 paginated lookups)

Home 200; no-params total 1,202 / 50 returned / snapshots / ranking label /
cheapest $0.06 / preorderWatch 7 / budgetTypes 25; colors WU 591, C 308;
cycle shock 11; GC include 7; include_basics=0 → 1,190; fits U 416, fits C
354; sort=most_used 400; colors=X 400; mode=bogus 400; best_budget w/o type
400; type=bogus 400; two_color_fixing 208/161 with Battlefield Forge rank 1
first; rainbow 5 with Command Tower first; WU+untapped+max$1 all untapped
≤$1; untapped_only excludes transform-back; optimizer untouched
(`/api/manabase?list=all` → 43 lands). The 5 name lookups (Hallowed
Fountain $7.39 ECL #265 + preorder flag; Pathway modal 2 faces; Ishgard
adventure single_card; Aclazotz requires_transformation) were confirmed via
paginated fetches — they sit past the first 100 cheapest rows, not missing.
Note: the preview answers non-browser UAs inconsistently (urllib got
IncompleteRead / closed connections; curl and browsers work) — the matrix
ran via curl.

## UI review — data + code verified; visual browser check still owed

- Built bundle contains "Best budget — researched", "two_color_fixing",
  "Requires transformation", "Preorder watch list".
- API returns every field the UI renders for face rows (face_class,
  land_drop, land_faces, other_faces, buy_name) and rank context.
- A live visual render check (modal DFC + Adventure cards on the Search
  tab at phone scale) still needs a browser pass — not done in this task
  (no browser access in this session). Val's eyes remain the acceptance test.

## Files changed (review branch)
- `manabase-search/phase2/build_search_data.py`, `build_face_rows.py`
  (preorder filter), `search_data.json` (18 rows corrected),
  `face_rows.json` (re-run, 0 changes),
  `charlie-budget-land-sort-2026-11-07.json`,
  `charlie-ranked-budget-lands-2026-11-07.csv`,
  `charlie-full-land-catalog-2026-11-07.csv` (Charlie's inputs, new).
- `manabase-search/phase3/generate_serving_data.py` (Phase 5 rewrite),
  `phase5-report.md` (this file).
- `web/functions/api/_manabase_search.json` (1,202 rows),
  `manabase-search.js` (type + best_budget), `_manabase_search_filters.js`
  (normalized-name compare), `manabase-search.test.mjs` (22 tests).
- `web/src/components/ManaBase.jsx` (sort + type filter + face/rank/
  preorder rendering), `web/src/styles.css` (badge styles).

## Open questions (unchanged by Phase 5)
- **Q5** (utility-tag scope, Charlie), **Q6** (checklist confirmation —
  Val's call; the checklist UI is built per the plan's recommendation, not
  decided), **Q7** (ranking cadence, Charlie), **Q10** (serving format —
  bundled JSON in use, 1.33 MB), **Q13** (gold-border exclusion
  confirmation, Charlie). **Q14 DELIVERED + IMPLEMENTED** (this phase, with
  the SHA caveat above). **Q3** still NOT CLEARED (EDHREC permission email
  sent Nov 6, awaiting reply); most-used sort still 400s honestly.
- Charlie's release-gate assessment of this phase + Val's phone-scale visual
  check + her explicit release decision are still owed. Nothing merges or
  deploys to production without her word.
- Methodology note for Charlie: his released-quote view does not exclude
  gold-bordered printings (e.g. his Phyrexian Tower released min is a WC
  printing); our served data excludes gold (Q13 pending his confirmation).
  No ranked entry is affected (0 of 284 released quotes are gold-bordered).
