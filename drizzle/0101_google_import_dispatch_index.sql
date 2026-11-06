-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "gbp_import_request_items_due_idx"
  ON "gbp_import_request_items" ("next_dispatch_at", "id");
