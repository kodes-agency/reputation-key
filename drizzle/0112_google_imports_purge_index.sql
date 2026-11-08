-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "google_imports_purge_idx" ON "google_imports" ("purge_at", "id");
