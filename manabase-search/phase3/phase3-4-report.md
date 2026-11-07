# ManaBase Land Search — Phase 3 (API) + Phase 4 (UI) report (2026-11-07)

**Branch:** `robin/manabase-search-2026-11-06`, commits `fae263f` + `6dc4979` (pushed).
**Preview:** https://search-phase3.manacents.pages.dev (deployment `74f84943` — redeployed after the dispositions).
**Status:** built + tested + preview-deployed + live-verified. No merge, no
production deploy, no posts, no nightly-refresh changes, no optimizer changes.

## What was built

### Serving data
- Generator `~/workspace/manabase-search/phase3/generate_serving_data.py` turns
  `phase2/search_data.json` (1,601,115 bytes) into
  `web/functions/api/_manabase_search.json` (**903,956 bytes**, 1,101 rows).
- Trimmed (API never returns these): `cheapest.scryfall_uri / market /
  retailer / price_field / oversized / paper / set_name`, `legality.source`,
  `oracle_text` on non-utility rows (utility rows keep it — the UI shows it).
- Generator asserts before writing: 1,101 rows, 12 basics, 48 utility, no
  banned rows, no face/fetch names leaked, buy-set default = exactly the
  non-basics (Q1).

### API — `GET /api/manabase-search` (`web/functions/api/manabase-search.js`)
- Filters: `colors` (WUBRG + C), `mode` (produces/fits — see below),
  `include_basics` (default 1, Q1), `max_price`, `untapped_only`,
  `game_changer` (any/include/exclude), `cycle`.
- Pagination: `limit` (default 50, clamps to 100), `offset`. Deterministic
  order (tie-break name asc) so pages are stable.
- `meta` carries `priceSnapshot` (2026-11-06), `rankingSnapshot: null` +
  `rankingNote`, `servedCount` 1101, `heldCount` 111 (101 face + 10 fetch),
  `excludedCount` 100, `utilityDisplayOnly` 48, `cheapestSetTotal` $19,372.78,
  and `coverageNote`: "1,101 of 1,212 Commander-legal lands searchable; 111
  held (101 double-faced/adventure + 10 fetchlands); 100 excluded (3 banned +
  97 not Commander-legal). This is not full 1,212-card coverage."
- **Two filter modes (Charlie's plan correction #1, Nov 6/7):**
  `mode=produces` (default) — a land matches if it produces at least one
  requested color; colorless-only lands match only on explicit `colors=C`;
  conditional production never counts toward a produces match.
  `mode=fits` — "fits my commander" (CR 903.5c/d): whole-card color identity
  ⊆ requested colors AND every basic land type must produce a color in the
  requested set. Implemented in `web/functions/api/_manabase_search_filters.js`
  (pure functions). `basic_types` was added to the serving data from the
  pinned oracle bulk's type lines (112 rows carry basic types; spot checks:
  Hallowed Fountain [Plains, Island], Plains [Plains], Wastes []).
  The plan's original `colors_produced ⊆ requested` test is NOT CR 903.5c
  and is not used anywhere.
- **Most-used sort:** `sort=most_used` / `sort=inclusion` → **400** with an
  honest message (ranking data pending Q3 — Charlie confirmed Nov 6/7 that
  EDHREC commercial reuse is NOT cleared; ranking stays on hold unless
  written permission/licensing is supplied). No most-used numbers are faked.
  Visible default is `price_asc`.

### UI — "Search lands" tab (`web/src/components/ManaBase.jsx` + `styles.css`)
- Color picker reusing the optimizer's pip buttons + Gemma icons (incl. a
  colorless pip), **mode toggle ("Produces these colors" / "Fits my
  commander")** with a plain-language explainer per mode, sort control
  (Cheapest / Most expensive / Name A–Z, with a disabled "Most used (coming
  soon)" option + the honest note underneath), filters (hide basics, untapped
  only, max price, cycle, Game Changers).
- Results grid: name, colors-produced pips, **conditional-color pips where
  applicable (12 rows produce colored mana only conditionally — e.g. Nimbus
  Maze, Tainted Field — shown with the dependency, never as colorless-only)**,
  entry badges, GC flags, utility Oracle text + "shown for reference".
- Buy-whole-set (checklist, Q6 built as the plan's recommendation — Val's
  confirmation still owed): tick lands, "select all on this page", buy bar
  shows selected / in-buy-set / total. Primary: **"Review selected lands on
  Mana Pool"** — the add-deck link is built WITH `ref=manacents` via the
  established `manaPoolDeckUrl()` helper (Q2 verified by Charlie Nov 6/7:
  real browser check, 3/3 in stock, Mana Pool's own affiliate docs document
  the `&ref=` placement). No commission promise anywhere; the copy says the
  review does not complete a purchase, and prices are labeled Scryfall
  cheapest-printing quotes, not guaranteed Mana Pool checkout prices.
  Fallbacks: copy list for Mana Pool mass entry (with link), copy list for
  TCGplayer mass entry (tracked link, existing flow). Basics excluded by
  default and the control says so plainly ("Basics are left out of the buy
  set — a Plains is a Plains.").
- Staleness warning on the price snapshot (>7d amber, >30d red), same rule as
  the optimizer. Auto-runs once when the tab first opens.

### Tests — `web/functions/api/manabase-search.test.mjs` (14/14 pass)
API filters/pagination/meta honesty, **fits-mode HTTP tests (Sunken Hollow
produces-U but does not fit-U; Hallowed Fountain fits-WU not U; Academy
Ruins fits-U but does not produce-U; fits-C = 346 empty-CI rows)**,
**synthetic filter tests (off-identity utility land, modal DFC, transforming
back face, colorless query, basic-type-only row)**, no-leak scan of all 1,101
rows, buy-set helpers (excludes basics, dedupes, caps at 100, add-deck URL
round-trips WITH ref), UI smoke (ManaBase renders all three tabs). Wired into
`prebuild` alongside the combo validator (same pattern as the optimizer
branch). `npm run build` passes (Vite 40 modules; frontend JS 273 KB — the
search data is NOT in the frontend bundle).

## Live preview verification (2026-11-07, all against search-phase3)
- Home 200; API no-params: total 1101, 50 returned, snapshot 2026-11-06,
  ranking null, cheapest Desert of the Mindful $0.06, coverageNote present.
- `colors=WU`: 534 total. `colors=C`: 299 (all colorless-only).
  `cycle=shock`: 11. `game_changer=include`: 7 (all seven names).
  `include_basics=0`: 1089. `sort=most_used`: 400 with the honest message.
  Invalid `colors=X`: 400. WU + untapped + max $1: 110, all untapped, all ≤$1.
- **Fits mode live:** `colors=U&mode=fits` total 396; Sunken Hollow absent,
  Academy Ruins present, all pages CI ⊆ {U}. `colors=C&mode=fits` total 346.
  `mode=bogus`: 400.
- Hallowed Fountain via live API: $4.18 TRK #286 foil — matches
  `search_data.json` exactly (incl. printing_id).
- Optimizer untouched on this preview: `/api/manabase?list=all` → 43 lands,
  seed 0.4.2, snapshot 2026-11-05. Frontend bundle contains "Search lands",
  "Fits my commander", "Review selected lands on Mana Pool", and the
  "not a guaranteed Mana Pool checkout price" disclaimer.
- Mana Pool add-deck URL with a 2-land list resolves HTTP 200 (cart
  population verified by Charlie in a real browser — Q2).

## Size note (Q10)
The bundled serving JSON is 903,956 bytes (trimmed from 1.6 MB). It deploys
fine on the Paid plan — the preview deploy succeeded and the endpoint
answers. No switch to D1 was made. If the roster grows past ~2,000 rows the
file will pass 1.6 MB again and the format should be revisited then.

## Charlie's dispositions applied (Nov 6/7 — Drive 1GP1NcXoKX2qp21vgmb4ekfMGOmryWL0Z)
- **Q2 VERIFIED, applied:** add-deck import + ref placement cleared by a real
  browser check + Mana Pool's own affiliate docs. The search buy flow now uses
  `manaPoolDeckUrl()` (ref appended) — the earlier no-ref divergence is
  resolved; one helper, one rule, same as the upgrades buy-all. What remains
  unverified is account-side commission attribution only: the UI promises no
  commission, and the wording is "Review selected lands on Mana Pool".
- **Plan correction #1, applied:** distinct produces/fits modes (above) +
  tests. The plan's `colors_produced ⊆ requested` test is not used.
  Conditional production is shown on the card, never silently counted.
- **Q4 approved, not blocking:** face policy (modal 60 / transform-front 4 /
  transform-back 32 / adventure 5) is approved, but the 101 face-rows are NOT
  in `search_data.json` yet — that is a data-producer follow-up (Phase 2
  re-run with the Q4 display model). The API/UI keep building on the 1,101
  rows; face-rows arrive later.
- **Q3 NOT cleared, unchanged:** EDHREC commercial reuse is not permitted
  under the published terms (personal/noncommercial). Ranking stays stubbed;
  no most-used numbers anywhere.
- **Plan correction #2, applied:** meta + UI publish actual served/held counts
  and reasons (`coverageNote`); nothing calls this full 1,212-card coverage.
  The 10 fetch rows stay held in this data (fetch modeling open) and the 48
  utility rows are served display-only — a data follow-up can add fetch rows
  with truthful display data without optimizer support.
- **Q9 (96 = 60 modal + 36 transform):** accepted; the 12 extra `is:dfc` hits
  are `reversible_card` printings, not a search bug. The serving generator
  uses the oracle bulk's canonical rows, so no reversible-card duplicates.
- **Noted, not done here:** Charlie asked for the ingest/producer source,
  pinned manifests and generated roster to be published on the review branch
  or in 04_Handoffs with a quality report + fixtures. The search branch is
  now published remotely (`fae263f`, `6dc4979`), which answers the branch
  part; publishing the phase1/phase2 producers is a follow-up.

## Stubbed / pending (Phase 5 needs)
- **Most-used sort** — waits on Q3 (EDHREC terms, Charlie). When it clears:
  run the ranking producer, attach `most_used` per row, re-generate serving
  data, enable the sort + the "Most used" option in the UI.
- **Q2** — ref tracking + cart population on the add-deck link (Brin/Charlie,
  needs a live browser check and/or a test order). Plus the divergence
  decision above.
- **Q4** — 101 face-rows (96 MDFC + 5 adventure) absent from search entirely.
- **Q5** — 48 utility rows served as display-only with Oracle text; Charlie's
  call on whether they stay.
- **Q6** — checklist buy-set built as recommended; Val's confirmation owed.
- **Q7/Q10** — ranking refresh cadence (weekly recommended) + serving format
  (bundled JSON, ~904 KB — fine for now).
- **Gold-border exclusion** (Phase 2's pricing rule) — Charlie to confirm as
  standing policy.
- **Phase 5** — hosted matrix on this preview (the optimizer's 24-case
  pattern), phone-scale visual check by Val, Charlie release-gate assessment,
  Val's explicit release decision. Nothing merges or deploys without her word.

## Files
- `~/workspace/manabase-search/phase3/generate_serving_data.py` (generator,
  now adds `basic_types` from the pinned oracle bulk)
- `web/functions/api/_manabase_search.json` (926,793 bytes, generated)
- `web/functions/api/manabase-search.js` (API)
- `web/functions/api/_manabase_search_filters.js` (produces/fits semantics)
- `web/functions/api/manabase-search.test.mjs` (14 tests)
- `web/src/components/searchBuySet.js` (buy-set helpers; wraps `manaPoolDeckUrl`)
- `web/src/components/ManaBase.jsx` (Search lands tab: mode toggle, conditional pips)
- `web/src/styles.css` (`.mb-search-*` styles)
- `web/package.json` (prebuild + `test:manabase-search`)
