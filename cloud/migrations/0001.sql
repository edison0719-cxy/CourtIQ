CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL,
 run_id TEXT, metadata TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner,updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_pending ON sessions(status,updated_at);
CREATE TABLE IF NOT EXISTS uploads (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, session_id TEXT NOT NULL, object_key TEXT NOT NULL,
 multipart_id TEXT NOT NULL, fingerprint TEXT NOT NULL, size INTEGER NOT NULL,
 metadata TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'uploading', expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS uploads_owner ON uploads(owner,fingerprint);
CREATE INDEX IF NOT EXISTS uploads_expiry ON uploads(expires_at);
CREATE TABLE IF NOT EXISTS upload_parts (
 upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
 number INTEGER NOT NULL, etag TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
 PRIMARY KEY(upload_id,number)
);

CREATE TABLE IF NOT EXISTS compute_slot (id INTEGER PRIMARY KEY CHECK(id=1), run_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
