CREATE TABLE IF NOT EXISTS patron_interest (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE,
 tier TEXT NOT NULL CHECK(tier IN ('seed','supporter','patron','custom')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 100 AND 100000),
 notify_opt_in INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 source_page TEXT NOT NULL
);
