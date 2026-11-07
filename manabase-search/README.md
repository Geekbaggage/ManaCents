# ManaBase Land Search — producers + data (review snapshot)

Review snapshot of the search-track implementation, published on branch
`robin/manabase-search-2026-11-06` at Charlie's request (his Nov 6 search
answers: "Publish the ingest/producer source, pinned manifests and
generated roster on the review branch or in 04_Handoffs, with a small
quality report and fixtures").

**Canonical working copies live in `~/workspace/manabase-search/`** — the
producers use absolute paths into that working area, so these committed
files are the review snapshot, not a second runnable copy. If the working
copies change, this snapshot goes stale; re-copy on the next review
checkpoint. The `web/` serving data (`web/functions/api/_manabase_search.json`,
the `manabase-search.js` API and `manabase-search.test.mjs` suite, the
"Search lands" UI) is committed normally on this branch and is NOT
duplicated here.

## Contents

- `phase1/` — inventory: `ingest_inventory.py` (roster producer),
  `roster.json` (1,312 rows), `inventory_report.md`, `bulk_manifest.json`,
  `gamechangers_checked_2026-11-07.json` (53 GC names).
- `phase2/` — per-land data: `build_search_data.py` (1,101 rows, cheapest
  price + provenance + legality), `build_face_rows.py` (Q4 face-rows,
  101 rows), `land_classify.py` + `test_land_classify.py` (65 tests),
  `fetch_edhrec.py` (ranking fetcher — sample only; full run refuses until
  Q3 clears), `search_data.json`, `face_rows.json`, `phase2_report.md`,
  `face_rows_report.md`, `spotcheck_face_rows.py`, `edhrec_sample.json`.
- `phase3/` — serving-data generator (`generate_serving_data.py`, trims
  `search_data.json` into `web/functions/api/_manabase_search.json`) +
  `phase3-4-report.md` (API + UI, preview `search-phase3`).
- `bulk/` — `BULK_MANIFEST.md` only. The pinned bulk `.gz` files
  (25 MB + 81 MB) are NOT committed; download them by SHA from the URIs
  in the manifest. Every producer verifies bulk SHAs before running.

## Status (2026-11-07)

- Phase 1 complete: 1,212 legal lands (verified 1,053 / held 159 /
  excluded 100). MDFC count corrected 108 → 96 (60 modal + 36 transform;
  the 12 extra `is:dfc` hits are `reversible_card` printings).
- Phase 2 complete: `search_data.json` 1,101 rows, cheapest set $19,372.78
  (Nov 6 snapshot); `face_rows.json` 101 rows, cheapest set $386.12,
  spot-checked 5/5 live vs Scryfall. Ranking NOT attached (Q3 EDHREC
  terms — not cleared; written permission pending).
- Phase 3+4 complete: API + UI on preview, 14/14 tests, Charlie's Q2/Q4
  dispositions + plan corrections applied; most-used sort honestly
  returns 400 until Q3 clears.
- Build plan (with all dispositions): Drive
  `1LBKXhiCdOXbZqOb_jCYgMMQk7KpAb2eK`.
