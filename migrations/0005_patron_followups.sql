ALTER TABLE patron_interest ADD COLUMN allocations TEXT NOT NULL DEFAULT '{}';
ALTER TABLE patron_interest ADD COLUMN ideaflow_sub TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS patron_nominations (
 id TEXT PRIMARY KEY,
 batch TEXT NOT NULL,
 name TEXT NOT NULL,
 url TEXT NOT NULL,
 ecosystem TEXT NOT NULL,
 why TEXT NOT NULL,
 email TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
 created_at TEXT NOT NULL,
 source_page TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS patron_nominations_status ON patron_nominations(status, created_at);
