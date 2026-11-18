CREATE TABLE IF NOT EXISTS interest_signals (
 id TEXT PRIMARY KEY,
 item_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('want','building')),
 ip_hash TEXT NOT NULL,
 day INTEGER NOT NULL,
 email TEXT NOT NULL DEFAULT '',
 handle TEXT NOT NULL DEFAULT '',
 letter_opt_in INTEGER NOT NULL DEFAULT 0,
 consent_at TEXT NOT NULL,
 source_page TEXT NOT NULL,
 utm TEXT NOT NULL,
 referrer TEXT NOT NULL,
 UNIQUE(item_key, ip_hash, day)
);
CREATE INDEX IF NOT EXISTS interest_signals_counts ON interest_signals(item_key, kind);
