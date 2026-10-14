-- ManaCents D1 schema v1 (2026-10-13)
-- Applied with: wrangler d1 execute manacents-db --remote --file=./schema.sql

-- Canonical card record. usd is Scryfall NON-FOIL USD only, floored at 0.10 at ingest.
-- price_log = ln(usd + 1.50) precomputed at ingest (D1 may lack ln()).
CREATE TABLE IF NOT EXISTS cards (
  scryfall_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  usd REAL,
  price_log REAL,
  tcgplayer_id INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);

-- Commander registry. deck_count drives the "active commander" cutoff
-- (top 1,000 by deck count, or >= 200 decks in the last 2 years).
CREATE TABLE IF NOT EXISTS commanders (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color_identity TEXT NOT NULL,
  deck_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Format-wide staple inclusion per card per FULL color identity (all 32).
-- Powers the 40% universal ceiling and the specificity denominator.
-- Computed from our own synergy corpus (Step 1), not fetched separately.
CREATE TABLE IF NOT EXISTS global_rates (
  scryfall_id TEXT NOT NULL,
  color_identity TEXT NOT NULL,
  inclusion_rate REAL NOT NULL,
  PRIMARY KEY (scryfall_id, color_identity)
);

-- Per-commander synergy rows. cmdr_rate = inclusion rate in this commander's decks.
-- role drives the silent fill quotas (ramp | removal | draw | synergy).
-- in_base_precon / precon_keep_rate stay NULL until a precon decklist source exists.
-- raw_score is precomputed by recalc_scores.sql (Step 3).
CREATE TABLE IF NOT EXISTS commander_synergy (
  commander_slug TEXT NOT NULL,
  scryfall_id TEXT NOT NULL,
  cmdr_rate REAL NOT NULL,
  role TEXT,
  in_base_precon INTEGER,
  precon_keep_rate REAL,
  raw_score REAL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (commander_slug, scryfall_id)
);
CREATE INDEX IF NOT EXISTS idx_synergy_commander ON commander_synergy(commander_slug);
CREATE INDEX IF NOT EXISTS idx_synergy_card ON commander_synergy(scryfall_id);
