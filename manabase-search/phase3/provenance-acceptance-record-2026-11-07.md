# ManaBase Search — Provenance Acceptance Record (Q14 sort file)

**File:** `ManaCents-Budget-Land-Sort-2026-11-07.json`
**Drive file ID:** `1-wLvCOSkBSlgwsXJ34EhRD6b6cjUrkDn`
**Verification date:** 2026-11-07 (re-downloaded 11:45:29 AM PT / 19:45:29 UTC)
**Verifier:** Robin (subagent, read-only verification; no production, no main merge, no code changes, no deploys)
**Status: PENDING — awaiting Valerie Estrada's signature below. Nothing in this record constitutes acceptance by Robin.**

## 1. Approved file (as downloaded)

| Field | Value |
|---|---|
| File name | `ManaCents-Budget-Land-Sort-2026-11-07.json` |
| Drive file ID | `1-wLvCOSkBSlgwsXJ34EhRD6b6cjUrkDn` |
| Download method | `/opt/hatch/bin/hatch_gws_cli drive files get --params '{"fileId":"1-wLvCOSkBSlgwsXJ34EhRD6b6cjUrkDn","alt":"media"}'`, stdout captured to file (stderr empty, exit 0) |
| Download time | 2026-11-07 11:45:29 PT / 19:45:29 UTC |
| Downloaded size | 4,091,374 bytes |
| **Downloaded SHA-256 (raw bytes)** | **`8838474db0df8f0a922cfcfe4eeba68dd06db6f4ea99afb08a46332d5d301b5b`** |
| Downloaded SHA-256 (trailing newline stripped) | `44a4bfb70a096bd81e834f7291bee736dc2d1f12d221e8df8187c5dbf2cfb665` |
| Local copy compared against | `phase2/charlie-budget-land-sort-2026-11-07.json` (saved 2026-11-07 16:58 UTC) |
| Evidence copy of this download | `/tmp/manabase-provenance-2026-11-07/drive-download-2026-11-07.json` |

## 2. Hash comparison — the stated hash does NOT match and is not claimed

| Hash | Value | Matches today's download? |
|---|---|---|
| Stated in Charlie's handoff (Drive `13lQnoqTbu43DF3p-mn3-NFXLra2y4gDg`) | `dbfbf125d88a3335ee81b31ad8da02cb0497562287101df24df492cfb82b4da6` | **No** — matches neither the raw download nor the newline-stripped variant |
| Downloaded 2026-11-07 ~08:58 PT (Nov 7 record) | `5261fd25c198723f27d774a3697b6680747ecbee263f1ad325b26fd372f0a822` | **No** — today's re-download hashes differently |
| Downloaded 2026-11-07 11:45 PT (this verification) | `8838474db0df8f0a922cfcfe4eeba68dd06db6f4ea99afb08a46332d5d301b5b` | — (this is the reference value for this download) |

**Why the hash changes on every download (proven, not assumed):** today's download and the Nov 7 local copy are the same size (4,091,374 bytes) and differ in exactly 17 bytes, all on line 1236 — the embedded `retrieved_at` timestamp (`2026-11-07T08:58:36.656-08:00` / `16:58:36.656Z` on Nov 7 vs `2026-11-07T11:45:29.272-08:00` / `19:45:29.272Z` today). That timestamp is stamped at download/retrieval time. Proof: replacing today's `retrieved_at` values with the Nov 7 values reproduces the Nov 7 bytes exactly and reproduces hash `5261fd25…`. The parsed JSON of the two downloads is deep-equal ignoring `retrieved_at` only.

**Consequence:** SHA-256 of the downloaded bytes can never match a precomputed hash, because the file restamps itself on each retrieval. Byte-identical provenance is therefore unachievable by re-download, and the stated hash `dbfbf125…` cannot be reproduced by downloading. It is not claimed here.

**Stable content identifier (for reference only, NOT the stated hash):** SHA-256 of the parsed JSON with `retrieved_at` removed, re-serialized with `json.dumps(indent=2)` — identical for both downloads: `beeec6b6a6f5aafb80b56a12f4691c89a73c022ea83692df8d42b4a9afa22af5` (no trailing newline) / `c759ad8842d63681fe17755633a71a4a35cac09ec8f46ed56137a4ca5472071b` (with trailing newline). This identifies the content, not the file as delivered.

## 3. Acceptance basis: verified-by-content ONLY, never byte-identical

This file is accepted (if Valerie signs below) **verified-by-content only**. The hash gap in §2 remains open and is not waived by the content checks below.

## 4. Reconciliation evidence (all recomputed from the downloaded bytes, not taken from the file's own `counts` field)

### 4a. Handoff claims vs independent recomputation

| Handoff claim | Recomputed from downloaded file | Result |
|---|---|---|
| 1,212 cards | `len(cards)` = 1,212 | ✓ match |
| 25 type lists | `len(types)` = 25 | ✓ match |
| 23 populated budget lists + 2 reference-only sections | 23 types with ≥1 `default_recommendation`; 0-default types are `nonland_permanent_answers` and `modal_spell_utility` | ✓ match |
| 284 ranked entries / 283 distinct cards | 284 members with `default_recommendation=true`; 283 distinct `oracle_id`s | ✓ match |
| Duplicate ranked card | `Path of Ancestry` (`b473e293-59e3-4e04-acf2-622604aeb25f`) appears twice: `rainbow_commander_fixing` rank 3 and `kindred_commander_support` rank 3 | ✓ explains 284 vs 283 |
| 1,006 released under $5 | 1,006 cards with `budget_eligible_released_quote=true`; independently recomputed from `cheapest_released_paper_default_language.price_usd ≤ 5` = 1,006; 0 flag/price mismatches | ✓ match |
| 1,013 all-quotes under $5 | 1,013 cards with `budget_eligible_any_quote=true`; recomputed from `cheapest_any_quoted_paper_default_language.price_usd ≤ 5` = 1,013; 0 mismatches | ✓ match |
| 7 preorder-only cards | 7 cards with `preorder_only_under_5=true`, recomputed from any-quote ≤ $5 and released-quote > $5 = 7: Godless Shrine, Hallowed Fountain, Sacred Foundry, Stomping Ground, Temple Garden, Training Center, Watery Grave | ✓ match |
| `ui_sort_label` "Best budget — researched" | `"Best budget — researched"` (em dash) | ✓ match |
| `restricted_usage_metrics_used` false | `false` | ✓ match |
| `measured_most_played_claim` | `false` | ✓ (no most-played claim made) |
| No EDHREC-derived metric (only disclaimer mentions) | "EDHREC" appears 3 times in the whole file, all in source `basis` disclaimers stating EDHREC data was NOT used / excluded; no EDHREC source entry; `popularity.measured_usage` is null on all 1,212 cards; `editorial.measured_usage_count` is null on all 1,212 cards | ✓ match |
| All type members resolve to catalog cards | 0 type-member `oracle_id`s outside the `cards` array | ✓ match |

### 4b. Oracle-ID reconciliation vs local roster and served rows

| Comparison | Result |
|---|---|
| Charlie 1,212 oracle_ids vs `phase1/roster.json` (1,312 rows) | 0 extra (every Charlie ID is in the roster); roster-not-Charlie = 100, all `excluded` (97 Commander not-legal + 3 banned) |
| Charlie vs `phase2/search_data.json` (1,101 rows) + `phase2/face_rows.json` (101 rows) | Union served = 1,202; Charlie − served = 10; served − Charlie = 0 |
| The 10 Charlie-only IDs | Arid Mesa, Bloodstained Mire, Flooded Strand, Marsh Flats, Misty Rainforest, Polluted Delta, Scalding Tarn, Verdant Catacombs, Windswept Heath, Wooded Foothills — all roster status `held`, reason "typed fetchland — pending fetch modeling" (the 10 held fetches) |
| Arithmetic | **1,212 = 1,101 + 101 + 10; 0 missing, 0 extra** ✓ |
| Roster `held` (159) ∩ Charlie | 159/159 (149 in served rows, 10 are the fetchlands above) |
| Roster `verified` (1,053) ∩ Charlie | 1,053/1,053, all in served rows |

### 4c. File-internal provenance fields

- `prepared_at_utc`: `2026-11-07T16:52:00.068085+00:00`
- `price_calculated_at`: `2026-11-07T16:50:35.332432+00:00`
- `price_bulk_updated_at` (Scryfall Default Cards snapshot): `2026-11-07T10:06:55.230+00:00`
- `catalog_snapshot_at`: `2026-11-07T05:32:04.940402+00:00`
- `bulk_sha256` (Scryfall bulk data, not this file): `dab6246b7bdaefce96d1f49fe5f99359cc09fce3580dafa743d1fd916ebb8065`
- `schema_version`: `1.0.0-research`; `purpose`: "Temporary budget SEARCH sort for Robin; not a solver or production deployment"

## 5. Live Scryfall spot-checks (2026-11-07 ~19:47 UTC)

Method: `curl` to `api.scryfall.com/cards/search?q=!"<name>" game:paper&unique=prints`, headers `User-Agent: ManaCents/1.0 (contact: geekbaggage@gmail.com)` and `Accept: application/json`; minima computed client-side (Scryfall's `order=usd` sort is not trusted). Scope matched to Charlie's: English, non-oversized, paper USD, any finish (`usd`/`usd_foil`/`usd_etched`); "released" = `released_at ≤ 2026-11-07`, so the 2026-11-13 Star Trek (`trk`) printings count as preorder. All 8 searches returned `has_more=false` (complete, no pagination gap); all printings were English. `cards/named?exact=Command Tower` also confirmed Charlie's oracle_id `0895c9b7-ae7d-4bb3-af17-3b75deb50a25`.

| Card | Charlie released quote | Live cheapest released | Live cheapest any-finish | Divergence |
|---|---|---|---|---|
| Command Tower | $0.21 nonfoil TDC #107 (2025-04-11) | $0.21 nonfoil TDC #107 (2025-04-11) | $0.21 | $0.00 |
| Exotic Orchard | $0.23 nonfoil DSC #275 (2024-09-27) | $0.23 nonfoil FRC #70 (2026-10-02) | $0.23 | $0.00 (price matches; cheapest printing differs — DSC #275 vs FRC #70, both $0.23) |
| Fabled Passage | $0.42 nonfoil PLST #BLB-252 (2026-09-28) | $0.42 nonfoil PLST #BLB-252 (2026-09-28) | $0.42 | $0.00 |
| Demolition Field | $0.28 nonfoil FIC #385 (2025-06-13) | $0.28 nonfoil FIC #385 (2025-06-13) | $0.28 | $0.00 |
| War Room | $1.39 nonfoil FDC #317 (2026-10-02) | $1.39 nonfoil FDC #317 (2026-10-02) | $1.39 | $0.00 |
| Hallowed Fountain | $7.55 nonfoil ECL #265 (2026-01-23); any-quote $4.34 foil TRK #286 preorder (2026-11-13) | $7.55 nonfoil ECL #265 (2026-01-23) | $4.34 foil TRK #286 (2026-11-13, preorder) | $0.00 on both views |
| Godless Shrine | $8.61 nonfoil PEOE #254p (2025-08-01); any-quote $3.81 nonfoil TRK #285 preorder (2026-11-13) | $8.61 nonfoil PEOE #254p (2025-08-01) | $3.81 nonfoil TRK #285 (2026-11-13, preorder) | $0.00 on both views |
| Path of Ancestry | $0.18 nonfoil SCD #312 (2022-12-02) | $0.18 nonfoil SCD #312 (2022-12-02) | $0.18 | $0.00 |

**Result: 8/8 exact matches, $0.00 divergence on every card and every view. No card exceeded the $0.10 flag threshold. No gold-bordered printing was the cheapest in any of the 8 checks.** Prices are a 2026-11-07 ~19:47 UTC live snapshot; Scryfall prices move day to day, so these spot-checks evidence the file's quotes as of its 2026-11-07 snapshot, not a standing price guarantee.

## 6. What is NOT established by this verification

- The stated hash `dbfbf125…` is not verified and is not claimed; the cause of the mismatch is identified (§2) but Charlie's original hash computation was not reproduced.
- Live prices were checked for 8 of 1,212 cards only; the other 1,204 quotes were not re-checked live.
- This record does not approve production, release, or deployment — that decision is Valerie's alone (see §7).

## 7. Acceptance

> **Accepted by: Valerie Estrada — signature/date: ______ (PENDING — not signed)**
>
> By signing, Valerie accepts `ManaCents-Budget-Land-Sort-2026-11-07.json` (Drive `1-wLvCOSkBSlgwsXJ34EhRD6b6cjUrkDn`, downloaded 2026-11-07, SHA-256 `8838474db0df8f0a922cfcfe4eeba68dd06db6f4ea99afb08a46332d5d301b5b`) **verified-by-content only**. The hash stated in Charlie's handoff (`dbfbf125…`) does not match any downloaded copy and is explicitly NOT claimed as verified. The file is never to be described as byte-identical to the handoff file.
