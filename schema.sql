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
