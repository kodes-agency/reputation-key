-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "work_items_org_created_idx" ON "work_items" ("organization_id", "created_at", "id");
