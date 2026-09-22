-- ADR 0046: a mandatory notice always goes by email, once per event.
--
-- Every account notice keys on (organization, orgId), so ADR 0046 r.2 folds a
-- second role change or a second purge-pending notice into the first one's
-- unread in-app row while that row is unread. Its email is still owed. It is
-- anchored on that same row and keyed on its own event, so a mandatory row can
-- now carry one email per event it absorbed.
--
-- The index that allowed one email per notification refused that second row.
-- It now covers only non-mandatory mail, where r.2 still means one email per
-- unread row: a repeat that coalesces there sends nothing new. Every row the
-- old index admitted satisfies the narrower one.
CREATE UNIQUE INDEX "email_queue_non_mandatory_notification_unique" ON "notification_email_queue" USING btree ("notification_id") WHERE "notification_email_queue"."category" <> 'mandatory';--> statement-breakpoint
DROP INDEX "email_queue_notification_unique";
