-- ManaCents Step 3: precompute raw_score for instant reads.
-- Run after the nightly price job and after the weekly synergy job:
--   wrangler d1 execute manacents-db --remote --file=./recalc_scores.sql
--
-- Scoring engine v2 (locked 2026-10-13):
--   raw_score   = (cmdr_rate * specificity) / ln(price + 1.50)
--   specificity = cmdr_rate / (eligible_global_rate + 0.03)
-- price_log is precomputed at ingest, so this is pure arithmetic.
-- The 40% universal ceiling and 8% noise floor are WHERE filters at query time,
-- not score components, so they do not appear here.
--
-- NOTE: written as a correlated subquery, not UPDATE...FROM, because D1's
-- SQLite does not reliably resolve the target-table alias inside FROM's
-- ON conditions (verified 2026-10-13: UPDATE...FROM silently matched 0 rows).

UPDATE commander_synergy
SET raw_score = (
  SELECT
    (commander_synergy.cmdr_rate
      * (commander_synergy.cmdr_rate / (COALESCE(g.inclusion_rate, 0) + 0.03)))
    / NULLIF(c.price_log, 0)
  FROM commanders AS d
  JOIN cards AS c ON c.scryfall_id = commander_synergy.scryfall_id
  LEFT JOIN global_rates AS g
    ON g.scryfall_id = commander_synergy.scryfall_id
   AND g.color_identity = d.color_identity
  WHERE d.slug = commander_synergy.commander_slug
);
