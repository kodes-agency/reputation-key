-- A notice that asks for work stops asking once the work is done.
--
-- "Approve a reply", "Escalated", "Follow-up reopened", "Response target
-- passed" and "Choose a responsible manager" all kept standing after somebody
-- handled them: the bell counted them, and a reply approved at 23:00 still
-- produced a 07:00 "Approve a reply" email, because the send re-checked scope
-- only, never the state of the work.
--
-- docs/BETA.md says read is not resolved, so the settling fact does not mark
-- the row read. It stamps `resolved_at` — an explicit marker the reader sees —
-- and the unread count, the unread tab and the pre-send checks read that
-- column. The row stays in the feed with its "Done" marker; nothing pretends
-- the reader looked at it.
ALTER TABLE "notifications" ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
-- The settlement writes by (organization, resource, type) across every
-- recipient; this is exactly that predicate.
CREATE INDEX "notifications_unresolved_resource_idx" ON "notifications" USING btree ("organization_id","resource_id","type") WHERE status = 'unread' AND resolved_at IS NULL;
