# ManaCents — infra

Cloudflare D1 + GitHub Actions data pipelines for ManaCents ("Commander upgrades that respect your wallet").

## Layout

- `schema.sql` — D1 schema (cards, commanders, global_rates, commander_synergy)
- `recalc_scores.sql` — Step 3: precompute `raw_score` for instant reads
- `wrangler.toml` — Cloudflare binding config
- `scripts/price-sync.mjs` — nightly: refresh non-foil USD for the card pool via Scryfall `/cards/collection`
- `scripts/synergy-sync.mjs` — weekly: rebuild synergy rows from EDHREC, rebuild `global_rates` from our own corpus, recalc scores
- `scripts/seed-commanders.json` — cold-start commander list (used until D1's registry is populated)
- `.github/workflows/` — cron schedules for both jobs

## Data flow

```
GitHub Actions (cron)
  ├─ price-sync (daily 06:00 UTC): Scryfall → cards → recalc_scores
  └─ synergy-sync (Sundays 05:00 UTC): EDHREC → commander_synergy
                                        → global_rates (from corpus)
                                        → recalc_scores
Cloudflare D1 (manacents-db): serves reads to the frontend
```

## Web frontend (`web/`)

Vite + React SPA deployed to Cloudflare Pages. Pages Functions in
`web/functions/api/` read the same D1 via the `MANACENTS_DB` binding:

- `GET /api/commanders?q=` — commander autocomplete
- `GET /api/upgrades?commander=<slug>&budget=<n>&mode=tuneup|splash` —
  ranked upgrades with the locked v2 rules applied in SQL (8% noise floor,
  40% universal ceiling on color-eligible global rates), budget fill with
  silent role quotas, display scores normalized 60–99.

Card images hotlink Scryfall's CDN (`cards.image_url`, backfilled from
`image_uris.normal`; populated on every price-sync upsert). All affiliate
codes are empty placeholders (`web/src/affiliates.js`) — tracked URLs are
built only when a code is configured.

Local dev: `cd web && npm install && npm run build`. API functions can be
exercised against the real D1 with the `/tmp/test-api.mjs` harness pattern
(D1 HTTP API shim).

## Scoring engine v2 (locked 2026-10-13)

`raw_score = (cmdr_rate × specificity) / ln(price + 1.50)`, `specificity = cmdr_rate / (eligible_global_rate + 0.03)`.
Price floored at $0.10, non-foil USD only. 40% universal ceiling + 8% noise floor are query-time filters.

## Setup

1. `npm install`
2. Secrets (repo Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` (D1 Edit, Pages Edit, Workers Scripts Edit)
   - `CLOUDFLARE_ACCOUNT_ID` (dash sidebar)
3. Apply schema: `wrangler d1 execute manacents-db --remote --file=./schema.sql`

## D1 gotchas

- `UPDATE...FROM` silently matches 0 rows in D1 — use correlated subqueries (see `recalc_scores.sql`).
- `ln()` not guaranteed — `price_log` is precomputed at ingest.
