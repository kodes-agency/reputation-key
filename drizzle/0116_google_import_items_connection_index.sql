-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "google_import_items_connection_idx" ON "google_import_items" ("organization_id", "connection_id");
