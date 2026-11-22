CREATE TABLE IF NOT EXISTS sites (
  domain  TEXT PRIMARY KEY,
  owner   TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sites_owner ON sites (owner);

CREATE TABLE IF NOT EXISTS tokens (
  hash    TEXT PRIMARY KEY,
  owner   TEXT NOT NULL,
  label   TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_owner ON tokens (owner);

-- Click map (src/clicks.js): one row per click, no visitor id. Read back only as counts by GET /api/clicks.
CREATE TABLE IF NOT EXISTS clicks (site TEXT NOT NULL, day TEXT NOT NULL, page TEXT NOT NULL, dev TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS clicks_page ON clicks (site, page, dev, day);
-- Clicks written per UTC day, for the CLICKS_PER_DAY cap.
CREATE TABLE IF NOT EXISTS click_days (day TEXT PRIMARY KEY, n INTEGER NOT NULL);
