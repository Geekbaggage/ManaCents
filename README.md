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
