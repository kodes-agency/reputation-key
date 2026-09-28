-- ADR 0046 r.2 coalesces a repeat into the one row still asking its reader for
-- something. Settling a notice stamps `resolved_at` and leaves `status`, because
-- read is not resolved, so a settled row kept the unread slot this index
-- guards: a second escalation, a resubmitted reply's approval request or a
-- later cycle's Response Target reminder folded into the settled row, and
-- queued no email, because only a mandatory repeat is mailed. The new request
-- reached nobody by email.
--
-- A settled row now leaves the slot. The next request on the resource gets a
-- row of its own, and with it an email of its own; the settled row keeps its
-- "Done" marker. Every row the old index admitted satisfies the narrower one.
DROP INDEX "notifications_unread_resource_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_unread_resource_unique" ON "notifications" USING btree ("user_id","type","resource_id") WHERE status = 'unread' AND resolved_at IS NULL;
