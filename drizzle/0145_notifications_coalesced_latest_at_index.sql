-- migrate:nontransactional
CREATE INDEX CONCURRENTLY "notifications_coalesced_latest_at_idx" ON "notifications" ("coalesced_latest_at") WHERE "coalesced_latest_at" IS NOT NULL;
