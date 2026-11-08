-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "google_import_items_destination_idx" ON "google_import_items" ("organization_id", "destination_property_id", "created_at", "id");
