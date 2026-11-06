-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "work_items_due_idx" ON "work_items" ("dispatch_after", "organization_id", "id") WHERE "state" = 'pending';
