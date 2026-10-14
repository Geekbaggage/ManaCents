-- ManaCents D1 schema v1 (2026-10-13)
-- Applied with: wrangler d1 execute manacents-db --remote --file=./schema.sql

-- Canonical card record. usd is Scryfall NON-FOIL USD only, floored at 0.10 at ingest.
-- price_log = ln(usd + 1.50) precomputed at ingest (D1 may lack ln()).
CREATE TABLE IF NOT EXISTS cards (
  scryfall_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  usd REAL,
  price_log REAL,
  usd_30d_avg REAL NOT NULL DEFAULT 0, -- EMA baseline for price-drop/spike flags (seeded by price-sync)
  type_line TEXT,                     -- e.g. "Legendary Creature — ..."; powers the Big Splash land exclusion
  tcgplayer_id INTEGER,
  image_url TEXT,                 -- Scryfall image_uris.normal (cards.scryfall.io hotlink)
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);

-- Commander registry. deck_count drives the "active commander" cutoff
-- (top 1,000 by deck count, or >= 200 decks in the last 2 years).
-- status: 'live' (full synergy data) or 'pending_sync' (user-requested stub
-- awaiting the daily fulfillment cron). vote_count tracks request demand.
CREATE TABLE IF NOT EXISTS commanders (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color_identity TEXT NOT NULL,
  deck_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live',
  oracle_id TEXT,
  vote_count INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  fulfill_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_commanders_oracle ON commanders(oracle_id);
CREATE INDEX IF NOT EXISTS idx_commanders_status ON commanders(status);

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

-- Inline results-page feedback. Created idempotently by POST /api/feedback on
-- first submission (no separate migration needed); the Discord webhook ping
-- uses the DISCORD_FEEDBACK_WEBHOOK_URL Pages secret.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commander TEXT,
  budget REAL,
  mode TEXT,
  rating TEXT,          -- 'up' or 'down'
  category TEXT,        -- 'missing_card', 'wrong_role', 'price_issue', 'other'
  comment TEXT,
  cards_shown TEXT,     -- comma-separated names of the recommended cards on screen
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Search analytics: one row per search (added 2026-10-13 once Workers Paid
-- made writes cheap). Powers "most searched commanders / popular budgets"
-- reporting. Created idempotently by GET /api/upgrades.
CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commander_slug TEXT,
  commander_name TEXT,
  budget REAL,
  mode TEXT,            -- 'tuneup' or 'splash'
  result_count INTEGER,
  total REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
