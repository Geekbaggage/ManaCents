# ManaBase Search — Refresh Runbook

**Scope:** the land-search serving data only (`web/functions/api/_manabase_search.json`).
It does NOT cover the optimizer (43-land pilot) or the nightly refresh on `main`.

## Status warning (read first)

- The search producer is **outside the nightly job**. The nightly refresh on `main`
  uses a **stale** refresh script (no `etbModes`/conditionalColors, no fail-closed GC
  retrieval, no validate-before-write) and must NOT be treated as producing
  corrected search data. Do not touch `main` or the nightly job from this runbook.
- The procedure below is the working refresh procedure, run by hand on the review
  branch until a scheduled job is approved (see §5).

## Owner and cadence (proposed — Val approves)

- **Owner (proposed): Robin.** Runs the refresh, verifies the gates below, files the
  refresh note in Drive 04_Handoffs. Val approves the owner.
- **Cadence (proposed): weekly**, aligned with the existing EDHREC synergy-sync
  cadence. Val approves the cadence.
- Prices are a snapshot: the badge and all displayed prices are as of the snapshot
  date shown in the Search tab ("prices from YYYY-MM-DD"). Scryfall prices move
  daily; between refreshes a card can cross $5 while its badge still shows. The
  weekly refresh is the mitigation; there is no live-price serve path.

## Procedure (one refresh)

Work on the review branch (`robin/manabase-search-2026-11-06` until the search
merges). All paths are under `~/workspace/manabase-search/` unless noted.

### 1. Pin fresh Scryfall bulks
- Download the current `oracle-cards` and `default-cards` bulks from
  `https://data.scryfall.io/oracle-cards/` / `.../default-cards/` into `bulk/`
  (filenames carry the UTC timestamp, e.g. `oracle-cards-20261107100202.jsonl.gz`).
- Record each file's byte size + SHA-256. The bulk's own `updated` timestamp is the
  snapshot's source date.
- Reference (2026-11-07 refresh):
  - oracle `oracle-cards-20261107100202.jsonl.gz`, 25,360,661 bytes,
    SHA `3a2ad385b3791fa3997fca5d6ffc9fcd4d6a8837ffe8871c1e120ed6a6318ed1`,
    updated 2026-11-07T10:02:02Z.
  - default `default-cards-20261107100655.jsonl.gz`, 80,897,089 bytes,
    SHA `dab6246b7bdaefce96d1f49fe5f99359cc09fce3580dafa743d1fd916ebb8065`,
    updated 2026-11-07T10:06:55Z. This is the same bulk Charlie's sort file used
    (`bulk_sha256` inside the sort JSON matches).

### 2. Re-check the roster against the fresh oracle bulk
- Run `phase1/ingest_inventory.py` pointed at the fresh oracle bulk (copy to a temp
  dir, patch the bulk path) and diff the resulting roster against
  `phase1/roster.json`. The roster must be row-identical except the bulk SHA in
  `evidence.snapshot_hash`. Any new/removed/changed land is a STOP: do not proceed
  until the roster change is understood (new set legality, ban, etc.).
- Also re-fetch the live Game Changer list (`is:gamechanger`); it must match the
  53 names in `phase1/gamechangers_checked_2026-11-07.json`.
- 2026-11-07 result: roster identical (1,312 rows; 1,212 legal; 1,053 verified /
  159 held / 100 excluded); GC list identical (53 names).

### 3. Update the producers and re-run them
- In `phase2/build_search_data.py` and `phase2/build_face_rows.py`, update:
  `ORACLE_BULK` / `DEFAULT_BULK` filenames, `EXPECTED_ORACLE_SHA` /
  `EXPECTED_DEFAULT_SHA`, `PRICE_BULK_UPDATED` (default bulk's `updated` timestamp),
  `PRICE_SNAPSHOT` (today's date). The meta filenames are derived from the bulk
  path constants (`DEFAULT_BULK.name` / `ORACLE_BULK.name`) — never hardcode them
  (a hardcoded stale filename shipped once; fixed Nov 7).
- Back up the current `phase2/search_data.json` and `phase2/face_rows.json` as
  `search_data-YYYYMMDD.json` / `face_rows-YYYYMMDD.json` before overwriting.
- Run `python3 build_search_data.py` then `python3 build_face_rows.py`.
  Both are fail-closed: bulk SHA mismatch, roster-count mismatch, or a missing
  oracle row aborts the run.

### 4. Regenerate serving data
- Run `python3 phase3/generate_serving_data.py` (writes
  `~/workspace/manacents-infra/web/functions/api/_manabase_search.json`).

### 5. Verification gates (ALL must pass before any deploy)
1. **Counts:** 1,101 search rows + 101 face rows = 1,202 served; held = 10 fetches
   only; 0 held on price/legality; entry split and class counts as recorded.
2. **Totals:** record the new cheapest-set totals (search + face + combined).
3. **Preorder separation:** the Nov 13 Star Trek printings (and any other future
   release) must NOT be the cheapest pick on any row. Check `meta.preorder_watch`
   (7 cards) and confirm every ranked row's cheapest `released_at ≤ snapshot`.
4. **$5 badge divergence check (mandatory, 0 allowed):** for every one of the 284
   ranked entries, compare the serving row's displayed `cheapest.price` against
   Charlie's `released_quote_usd` in `phase2/charlie-budget-land-sort-2026-11-07.json`.
   Any divergence blocks the deploy until explained. Cause is usually snapshot
   drift (see §6); a gold-bordered cheapest on Charlie's side is the other known
   cause — our producer excludes gold, Charlie's file does not.
5. **Live spot-checks:** at least 5 quotes vs live Scryfall (`unique=prints`,
   minima computed client-side; never trust `order=usd`). Flag > $0.10.
6. **Tests + build:** `npm run build` in `web/` (prebuild runs the hook guard,
   combo tests, and search tests), plus the hosted API matrix against the preview.

### 6. Why the $5 badge can drift (and what the refresh does about it)
- The gate quote is Charlie's `cheapest_released_paper_default_language`
  (cheapest released paper printing, any finish, default language) from his
  2026-11-07 snapshot. Our displayed cheapest is the same definition computed
  from our bulk, minus gold-bordered printings.
- On the Nov 6 snapshot, 118 of 284 displayed prices differed from the gate
  quotes (all by snapshot-date moves; 0 displayed over $5). After refreshing to
  the same Nov 7 bulk Charlie used, **0 of 284 diverged** — every displayed price
  exactly equals its gate quote. The divergence is a snapshot-date artifact, and
  the refresh is what closes it. That is why the divergence check in §5.4 is a
  deploy gate, not a report-only step.
- Residual risk between refreshes: prices move daily; a card can cross $5 while
  the badge (as of the snapshot date, shown in the Search tab) still shows.
  Weekly refresh is the mitigation. There is no live-price serve path.

## Draft cron definition (DO NOT CREATE — needs Val's separate approval)

```yaml
# Proposed only. Creating this cron needs Valerie's explicit approval.
# Weekly ManaBase search refresh, e.g. Sundays 07:00 PT (after the DB backup
# cron at 06:54 PT; does not touch the nightly main refresh).
# Job: run steps 1–6 above on the review branch, verify the gates, redeploy the
# search-phase5 preview, re-run the hosted matrix, file a refresh note in Drive
# 04_Handoffs. Never auto-merge to main, never deploy to production.
```

## Refresh history

| Date | Snapshot | Oracle bulk SHA (short) | Default bulk SHA (short) | Served | Cheapest set | $5 divergences |
|---|---|---|---|---|---|---|
| 2026-11-06 | 2026-11-06 | ccbc99fd… | dc826f98… | 1,202 | $19,945.00 | 118 (vs Charlie Nov 7 gate; snapshot drift) |
| 2026-11-07 | 2026-11-07 | 3a2ad385… | dab6246b… | 1,202 | $19,950.58 | 0 |
