-- Low ratings: how low a review or rated private feedback must be for each
-- channel to tell the person (ADR 0046, amended 2026-09-30).
--
-- One column on the per-Property preference and on the personal default,
-- which must offer the same answers: the highest rating a channel is on for,
-- "N★ or lower", 1 to 4. It belongs to `low_ratings` alone — required there,
-- absent everywhere else — so a stored threshold can never be read for a
-- category that has none. Nobody has a `low_ratings` row yet, so both CHECKs
-- hold for every existing row.
ALTER TABLE "notification_preferences" ADD COLUMN "max_rating" smallint;
--> statement-breakpoint
ALTER TABLE "notification_category_defaults" ADD COLUMN "max_rating" smallint;
--> statement-breakpoint
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_max_rating_scope"
  CHECK (("category" = 'low_ratings') = ("max_rating" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_max_rating_range"
  CHECK ("max_rating" IS NULL OR "max_rating" BETWEEN 1 AND 4);
--> statement-breakpoint
ALTER TABLE "notification_category_defaults"
  ADD CONSTRAINT "notification_category_defaults_max_rating_scope"
  CHECK (("category" = 'low_ratings') = ("max_rating" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "notification_category_defaults"
  ADD CONSTRAINT "notification_category_defaults_max_rating_range"
  CHECK ("max_rating" IS NULL OR "max_rating" BETWEEN 1 AND 4);
--> statement-breakpoint
-- Rated private feedback leaves Action needed for Low ratings. Whoever set
-- their Action needed EMAIL switch chose whether low-rated feedback was mailed
-- to them (1-3★ was Action needed): that answer is carried over, per Property
-- row and per personal default, on or off alike. "On" keeps 3★ or lower, what
-- they were mailed before; nobody who never touched the switch has a row, and
-- they get the new default (2★ or lower). In-app is not carried over: Action
-- needed could not be turned off in the app, and Low ratings in the app
-- defaults to 3★ or lower, which is what they had.
--
-- Idempotent — a row the person already has for `low_ratings` is kept.
INSERT INTO "notification_preferences"
  ("user_id", "organization_id", "property_id", "category", "channel", "enabled", "cadence", "max_rating", "created_at", "updated_at")
SELECT "user_id", "organization_id", "property_id", 'low_ratings', 'email', "enabled", "cadence", 3, now(), now()
FROM "notification_preferences"
WHERE "category" = 'urgent_operational' AND "channel" = 'email'
ON CONFLICT ("user_id", "organization_id", "property_id", "category", "channel") DO NOTHING;
--> statement-breakpoint
INSERT INTO "notification_category_defaults"
  ("user_id", "organization_id", "category", "channel", "enabled", "cadence", "max_rating", "created_at", "updated_at")
SELECT "user_id", "organization_id", 'low_ratings', 'email', "enabled", "cadence", 3, now(), now()
FROM "notification_category_defaults"
WHERE "category" = 'urgent_operational' AND "channel" = 'email'
ON CONFLICT ("user_id", "organization_id", "category", "channel") DO NOTHING;
