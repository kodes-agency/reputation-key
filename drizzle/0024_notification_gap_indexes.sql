-- The missing-notification gauge runs on every five-minute health snapshot
-- over a day of Inbox items. To tell an item still owed an announcement from
-- one whose delivery settled without a notification, it finds the
-- `inbox.inbox_item.created` fact that announced the item, whose receipts say
-- whether that delivery settled. This partial index holds only those facts,
-- and the lookup compares against the literal type, so the predicate matches.
CREATE INDEX "outbox_events_inbox_item_created_idx" ON "outbox_events" USING btree ("source_aggregate_id") WHERE "outbox_events"."event_type" = 'inbox.inbox_item.created';
