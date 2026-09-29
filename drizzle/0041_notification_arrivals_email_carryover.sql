-- New reviews and feedback become their own notification category, off by
-- default (docs/design/notifications D4; ADR 0046, amended 2026-09-30).
--
-- `review.created`, `review.updated` and 4-5 star Portal feedback used to be
-- governed by Workflow and collaboration (reviews) or Action needed (feedback).
-- Whoever set their Workflow EMAIL switch chose, among other things, whether
-- new reviews were mailed to them. That answer is carried over to the new
-- `arrivals` category — per Property row and per personal default, on or off
-- alike — so nobody gains or loses review email without deciding to. Nobody
-- who never touched the switch has a row, and the new default (off) matches
-- the old one (Workflow email was off by default too).
--
-- In-app is deliberately NOT carried over: arrivals in the bell are off by
-- default by the owner's decision, however Workflow in-app was set.
--
-- Data only: no column, index or constraint changes. Idempotent — a row the
-- person already has for `arrivals` is kept.
INSERT INTO "notification_preferences"
  ("user_id", "organization_id", "property_id", "category", "channel", "enabled", "cadence", "created_at", "updated_at")
SELECT "user_id", "organization_id", "property_id", 'arrivals', 'email', "enabled", "cadence", now(), now()
FROM "notification_preferences"
WHERE "category" = 'workflow_collaboration' AND "channel" = 'email'
ON CONFLICT ("user_id", "organization_id", "property_id", "category", "channel") DO NOTHING;
--> statement-breakpoint
INSERT INTO "notification_category_defaults"
  ("user_id", "organization_id", "category", "channel", "enabled", "cadence", "created_at", "updated_at")
SELECT "user_id", "organization_id", 'arrivals', 'email', "enabled", "cadence", now(), now()
FROM "notification_category_defaults"
WHERE "category" = 'workflow_collaboration' AND "channel" = 'email'
ON CONFLICT ("user_id", "organization_id", "category", "channel") DO NOTHING;
