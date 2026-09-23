-- The missing-notification gauge runs on every five-minute health snapshot
-- over a day of Inbox items, and two of its correlated lookups had no index,
-- so each read a whole table: whether any notification points at the item,
-- and which `inbox.inbox_item.created` fact announced it (its receipts say
-- whether the item's delivery settled). Each partial index holds only the
-- rows its lookup reads. Both lookups compare against a literal type, so the
-- predicates match.
CREATE INDEX "notifications_inbox_item_resource_idx" ON "notifications" USING btree ("resource_id") WHERE "notifications"."resource_type" = 'inbox_item';--> statement-breakpoint
CREATE INDEX "outbox_events_inbox_item_created_idx" ON "outbox_events" USING btree ("source_aggregate_id") WHERE "outbox_events"."event_type" = 'inbox.inbox_item.created';
