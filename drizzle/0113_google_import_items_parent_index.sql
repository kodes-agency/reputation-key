-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "google_import_items_parent_idx" ON "google_import_items" ("organization_id", "import_id", "created_at", "id");
