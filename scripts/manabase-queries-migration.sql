-- ManaBase query log — production calibration evidence.
-- One row per /api/manabase solver query (list=all gallery reads excluded).
-- Used to tune the provisional node caps (200K default / 1.5M extended)
-- from real traffic distributions. Never read by the solver itself.
CREATE TABLE IF NOT EXISTS manabase_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colors TEXT NOT NULL,
  priorities TEXT NOT NULL,
  budget REAL NOT NULL,
  slots INTEGER NOT NULL,
  opponents INTEGER NOT NULL,
  bracket INTEGER NOT NULL,
  nodes_visited INTEGER NOT NULL,
  status TEXT NOT NULL,
  interrupt_reason TEXT,
  result_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_manabase_queries_created
  ON manabase_queries(created_at);
