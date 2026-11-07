# ManaBase Search — Face-rows display data (Q4) — 2026-11-07

**Producer:** `phase2/build_face_rows.py` → `phase2/face_rows.json` (101 rows).
**Basis:** Charlie's Q4 dispositions (Drive `1GP1NcXoKX2qp21vgmb4ekfMGOmryWL0Z`).
**Price snapshot:** 2026-11-06 (same pinned bulks as Phase 2). **Ranking:** not
attached — Q3 (EDHREC terms) with Charlie.

## What it is

One row per canonical card/Oracle identity for the 101 held face-rows.
Whole-card color identity, one whole-card cheapest-printing quote with full
Defect E provenance (cheapest-any-finish, foils count, gold-bordered
printings excluded), land-drop availability explicit per class, the other
face(s) named on the row, buy lists export the canonical purchasable card
name (full `"X // Y"`). Search display only — showing a card here does NOT
certify its solver model.

## Counts (all validated by the producer, fail-closed)

| Class | Rows | Land-drop code | Meaning |
|---|---|---|---|
| modal | 60 | `playable_choice` | Land face is a playable choice under normal land-play rules |
| transform_front | 4 | `land_front` | Front face can be played as the land |
| transform_back | 32 | `requires_transformation` | NOT an ordinary land drop from hand |
| adventure | 5 | `single_card` | Land + Adventure are one card, not two purchases |

- **Cheapest 101-land face set total: $386.12** (price range $0.14–$36.00, median $1.35).
- Held on price gaps: **0**. Held on legality: **0**. GC served: none (no GC land is a DFC).
- Entry: 45 untapped / 56 tapped / 0 varies. Cycles: all 101 `unclassified`
  (the classifier has no pathway/modal rules; the plan allows unclassified).
- Disjointness verified: 0 of the 101 oracle_ids appear in `search_data.json`
  (1,101 served rows). No duplicate oracle_ids in the file. Every row has
  whole-card CI, a cheapest quote with printing_id, and a land-drop flag.

## Multi-land-face cards (found by the fail-closed run, not assumed)

11 of the 101 have TWO land faces — the 10 Pathways (modal_dfc, both faces
are lands) and Havengul Laboratory // Havengul Mystery (transform, front
AND back are lands). One row per canonical identity still holds: each row
carries a `land_faces` array (per-face text, production, entry, basic
types) and row-level colors/entry aggregated across faces (union of
production; shared entry status, else `"varies"`). A Pathway's alternative
face IS a land face, so it is shown as one — never as a non-land "other
face". Havengul's land-drop note adds that the back face is also a land,
reached by transformation.

## Reversible printings (Q9)

- **Face rows: 0 reversible printings encountered** among these cards'
  printings (reversible printings occur on single-faced cards). The
  resolver is in the producer and was exercised over the whole bulk.
- **Served set check (separate finding):** 92 printings in the default bulk
  lack top-level `oracle_id`; all 92 resolve via faces to a single canonical
  id; 12 resolve to oracle_ids in `search_data.json`. **Impact: 0** — none
  was cheaper than the filed cheapest quote (all are premium ecl/rex/sld
  printings). `build_search_data.py` was patched with the same resolver
  (Q9) and re-run: **0 cheapest-quote diffs, total still $19,372.78**
  (13 reversible printings resolved via faces in the re-run). The served
  data was already correct; the producer no longer has the blind spot.

## Spot-check vs live Scryfall (5/5 match)

`phase2/spotcheck_face_rows.py` — one row per class + one extra modal,
exact-name search with `unique=prints`, gold-bordered skipped, cheapest
price + printing + finish + whole-card CI compared:

| Card | Class | Filed | Live |
|---|---|---|---|
| Bala Ged Recovery // Bala Ged Sanctuary | modal | $6.89 ZNR #180 foil | $6.89 ZNR #180 foil |
| Hagra Mauling // Hagra Broodpit | modal | $1.07 ZNR #106 foil | $1.07 ZNR #106 foil |
| Westvale Abbey // Ormendahl, Profane Prince | transform_front | $2.23 INR #474 foil | $2.23 INR #474 foil |
| Aclazotz, Deepest Betrayal // Temple of the Dead | transform_back | $8.77 LCI #88 nonfoil | $8.77 LCI #88 nonfoil |
| Ishgard, the Holy See // Faith & Grief | adventure | $1.48 FIN #283 nonfoil | $1.48 FIN #283 nonfoil |

Lesson recorded in the script: Scryfall search defaults to `unique=cards`
(one representative printing per Oracle card) — the first spot-check run
without `unique=prints` falsely flagged Westvale Abbey ($3.33 vs the true
$2.23). Always pass `unique=prints` for cheapest-printing checks.

## What's next (Phase 5, not this run)

- Wire `face_rows.json` into the serving generator (`generate_serving_data.py`):
  served becomes 1,101 + 101 = 1,202 rows; held becomes 10 fetch rows only.
  The generator's `basic_types` must come from each face row's `basic_types`
  (land-face type lines) — the oracle bulk's top-level type line is the
  combined `"X // Y"` line and must not be used for face rows.
- The API's `mode=fits` already handles whole-card CI + basic types; face
  rows carry both. Verify a modal card and an Adventure import in the next
  UI review (Charlie's ask).
- The `entry: "varies"` case does not occur in this data (0 rows) but the
  shape supports it; the API's `untapped_only` filter must decide how a
  varies row is treated when one arises.
