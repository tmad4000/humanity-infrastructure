-- Additive delivery receipt only. No subscriber columns or backlog sends.
CREATE TABLE IF NOT EXISTS welcome_deliveries (
 signup_id TEXT PRIMARY KEY REFERENCES signups(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','sending','retry','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 sent_at TEXT
);
