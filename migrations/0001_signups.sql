CREATE TABLE IF NOT EXISTS signups (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, interest TEXT NOT NULL,
 handle TEXT NOT NULL, public_opt_in INTEGER NOT NULL DEFAULT 0,
 consent_at TEXT NOT NULL, source_page TEXT NOT NULL, utm TEXT NOT NULL,
 referrer TEXT NOT NULL, unsubscribe_token TEXT NOT NULL UNIQUE,
 unsubscribed_at TEXT
);
CREATE TABLE IF NOT EXISTS signup_rate_limits (
 ip_hash TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL
);
