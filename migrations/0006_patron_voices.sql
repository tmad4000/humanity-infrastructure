CREATE TABLE IF NOT EXISTS patron_voices (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 relation TEXT NOT NULL CHECK(relation IN ('use','benefit','believe')),
 voter_hash TEXT NOT NULL,
 comment TEXT NOT NULL DEFAULT '',
 display_name TEXT NOT NULL DEFAULT '',
 comment_status TEXT NOT NULL DEFAULT 'none' CHECK(comment_status IN ('none','pending','approved','declined')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(project_id, voter_hash)
);
CREATE INDEX IF NOT EXISTS patron_voices_comments ON patron_voices(comment_status, updated_at);
