-- Portal goals get their own notification row (ADR 0046, amended 2026-10-17).
--
-- The "Goals" row (`recognition`) splits in two: `recognition` keeps the
-- Google rating goal's change notices, shown as "Google rating goal", and the
-- new `portal_goals` takes the Monthly portal goal results (`goal.completed`,
-- `goal.result_revised`), shown as "Portal goals". Both rows inherit the old
-- "Goals" answer, on or off alike, on both channels: a person's Property rows
-- and their defaults for every Property. An old "Goals" email's one-click
-- unsubscribe link keeps stopping both halves it offered, because its kept
-- scopes are copied too, with their date, so they expire with the original.
--
-- Data only and idempotent: every statement copies `recognition` rows that
-- have no `portal_goals` twin yet and leaves an existing `portal_goals` answer
-- as it is. `max_rating` stays NULL (Low ratings only). Stored notification
-- rows and queued emails keep their category, because an old web server
-- asserts it when it reads one (notification-row.mapper.ts); the new code
-- reads both.
--
-- Deploy: web runs this in preDeploy, then the new worker writes
-- `portal_goals` notices and queues `portal_goals` emails. Forward-only: once
-- those exist, an old web or an old worker (a rollback, or an old worker still
-- running while the new one starts) fails on them, because the bell and the
-- email jobs read notices through that check. Never in the same deploy as
-- 0062: pending files share one transaction.
--
-- Down: only while `SELECT count(*) FROM notifications WHERE category =
-- 'portal_goals'` and the same count on notification_email_queue are both 0.
-- Then delete the copied rows (`DELETE ... WHERE category = 'portal_goals'` in
-- the three settings tables) and the 0063 row of drizzle.__drizzle_migrations.
-- If either count is above 0, a rollback also needs `UPDATE notifications SET
-- category = 'recognition' WHERE category = 'portal_goals'` and the same
-- UPDATE on notification_email_queue. Both delete answers people gave since or
-- change stored rows, so they are data-destructive: ask the owner.
--
-- Beta state: checked read-only before and after the deploy (PR body): no
-- `recognition` row from before this migration lacks its `portal_goals` twin,
-- no `recognition` answer is newer than its copy, and no goal-result notice
-- or queued email exists under `recognition`.
INSERT INTO "notification_preferences" ("user_id", "organization_id", "property_id", "category", "channel", "enabled", "cadence", "created_at", "updated_at")
SELECT "user_id", "organization_id", "property_id", 'portal_goals', "channel", "enabled", "cadence", now(), now()
FROM "notification_preferences"
WHERE "category" = 'recognition'
ON CONFLICT ("user_id", "organization_id", "property_id", "category", "channel") DO NOTHING;
--> statement-breakpoint
INSERT INTO "notification_category_defaults" ("user_id", "organization_id", "category", "channel", "enabled", "cadence", "created_at", "updated_at")
SELECT "user_id", "organization_id", 'portal_goals', "channel", "enabled", "cadence", now(), now()
FROM "notification_category_defaults"
WHERE "category" = 'recognition'
ON CONFLICT ("user_id", "organization_id", "category", "channel") DO NOTHING;
--> statement-breakpoint
INSERT INTO "notification_unsubscribe_scopes" ("target_kind", "target_id", "organization_id", "user_id", "property_id", "category", "created_at")
SELECT "target_kind", "target_id", "organization_id", "user_id", "property_id", 'portal_goals', "created_at"
FROM "notification_unsubscribe_scopes"
WHERE "category" = 'recognition'
ON CONFLICT ("target_kind", "target_id", "property_id", "category") DO NOTHING;
