-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "google_import_items_existing_property_idx" ON "google_import_items" ("organization_id", "existing_property_id");
