CREATE TABLE IF NOT EXISTS sites (
  domain  TEXT PRIMARY KEY,
  owner   TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sites_owner ON sites (owner);
