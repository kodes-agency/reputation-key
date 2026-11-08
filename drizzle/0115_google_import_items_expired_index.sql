-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "google_import_items_expired_idx" ON "google_import_items" ("status", "effect_deadline_at", "id");
