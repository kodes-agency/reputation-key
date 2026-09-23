-- Quiet hours and the urgent bypass become the PERSON's (ADR 0046, amended
-- 2026-09-23), with an optional per-Property override, and a category gains a
-- default that a Property with no row of its own inherits.
--
-- They were stored per (Property, category, channel). A manager with 30
-- Properties needed about 60 saves to stop 03:00 email, and a window set on
-- only some Properties split the one digest ADR 0046 r.4 promises: the rows of
-- the quiet Properties were deferred while the rest went out as a second mail.
--
-- WHAT THIS MIGRATION DOES WITH THE ROWS THAT EXIST
--
--  1. A person's per-Property quiet hours are lifted into their one personal
--     window ONLY where every row they have agrees on the times — the case
--     where "quiet hours are the same everywhere" was already true and moving
--     them changes nothing. `urgent_bypass_enabled` is lifted the same way, and
--     independently: the bypass and the window are separate answers.
--  2. Where a person's rows DISAGREE, nothing is lifted and the rows are
--     dropped with the columns. No merge is invented — a majority window, or
--     the widest one, would be a setting nobody chose, and inventing one is
--     worse than asking. Nobody is left mailed at 03:00 by the drop: the
--     settings page shows the personal window (empty) and the person sets it
--     once. There is no important production data (owner, 2026-09-23).
--  3. Per-category defaults are seeded the same way: from the (category,
--     channel) rows a person has across their Properties, where every one of
--     them agrees on `enabled` and `cadence`. A person configuring one
--     Property differently keeps that Property's row and gets no default.
--  4. No per-Property OVERRIDE row is created. An override is a deliberate
--     "this Property is different", and this migration has no evidence of one:
--     a disagreement is exactly what step 2 refuses to guess at.
--
-- The old columns are dropped at the end, so the personal window is the only
-- place delivery can read them from.

CREATE TABLE "notification_property_delivery_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"urgent_bypass_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_property_delivery_windows_quiet_pair" CHECK (("notification_property_delivery_windows"."quiet_hours_start" IS NULL) = ("notification_property_delivery_windows"."quiet_hours_end" IS NULL)),
	CONSTRAINT "notification_property_delivery_windows_quiet_distinct" CHECK ("notification_property_delivery_windows"."quiet_hours_start" IS NULL OR "notification_property_delivery_windows"."quiet_hours_start" <> "notification_property_delivery_windows"."quiet_hours_end")
);
--> statement-breakpoint
CREATE TABLE "notification_category_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"category" varchar(40) NOT NULL,
	"channel" varchar(16) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cadence" varchar(16) DEFAULT 'daily' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_category_defaults_channel_valid" CHECK ("notification_category_defaults"."channel" IN ('in_app', 'email')),
	CONSTRAINT "notification_category_defaults_cadence_valid" CHECK ("notification_category_defaults"."cadence" IN ('immediate', 'daily')),
	CONSTRAINT "notification_category_defaults_configurable_category_check" CHECK ("notification_category_defaults"."category" <> 'mandatory'),
	CONSTRAINT "notification_category_defaults_required_enabled" CHECK ("notification_category_defaults"."enabled" OR NOT ("notification_category_defaults"."category" = 'urgent_operational' AND "notification_category_defaults"."channel" = 'in_app'))
);
--> statement-breakpoint
ALTER TABLE "notification_property_delivery_windows" ADD CONSTRAINT "notification_property_delivery_windows_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_property_delivery_windows_scope_unique" ON "notification_property_delivery_windows" USING btree ("user_id","organization_id","property_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_category_defaults_scope_unique" ON "notification_category_defaults" USING btree ("user_id","organization_id","category","channel");
--> statement-breakpoint
ALTER TABLE "notification_user_settings" ADD COLUMN "quiet_hours_start" time;
--> statement-breakpoint
ALTER TABLE "notification_user_settings" ADD COLUMN "quiet_hours_end" time;
--> statement-breakpoint
ALTER TABLE "notification_user_settings" ADD COLUMN "urgent_bypass_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Step 1/2 — the quiet-hours window, only where every row of a person's agrees.
-- A person with no settings row yet gets one; `locale` and `timezone` keep
-- their column defaults, which is what delivery was already resolving for them
-- (the user's zone, else the Organization's — see recipient-timezone.ts).
INSERT INTO "notification_user_settings" ("user_id", "organization_id", "quiet_hours_start", "quiet_hours_end")
SELECT
  "user_id",
  "organization_id",
  MIN("quiet_hours_start"),
  MIN("quiet_hours_end")
FROM "notification_preferences"
WHERE "quiet_hours_start" IS NOT NULL
  AND "quiet_hours_start" <> "quiet_hours_end"
GROUP BY "user_id", "organization_id"
HAVING COUNT(DISTINCT ("quiet_hours_start", "quiet_hours_end")) = 1
ON CONFLICT ("user_id", "organization_id") DO UPDATE
SET "quiet_hours_start" = EXCLUDED."quiet_hours_start",
    "quiet_hours_end" = EXCLUDED."quiet_hours_end",
    "updated_at" = now();
--> statement-breakpoint
-- The urgent bypass, agreed across a person's email rows. Asked separately
-- from the window above: a person may agree about one and not the other.
INSERT INTO "notification_user_settings" ("user_id", "organization_id", "urgent_bypass_enabled")
SELECT "user_id", "organization_id", bool_or("urgent_bypass_enabled")
FROM "notification_preferences"
WHERE "channel" = 'email'
GROUP BY "user_id", "organization_id"
HAVING COUNT(DISTINCT "urgent_bypass_enabled") = 1 AND bool_or("urgent_bypass_enabled")
ON CONFLICT ("user_id", "organization_id") DO UPDATE
SET "urgent_bypass_enabled" = EXCLUDED."urgent_bypass_enabled",
    "updated_at" = now();
--> statement-breakpoint
-- Step 3 — the per-category default, from the rows that already agree.
INSERT INTO "notification_category_defaults" ("user_id", "organization_id", "category", "channel", "enabled", "cadence")
SELECT "user_id", "organization_id", "category", "channel", bool_or("enabled"), MIN("cadence")
FROM "notification_preferences"
WHERE "category" <> 'mandatory'
GROUP BY "user_id", "organization_id", "category", "channel"
HAVING COUNT(DISTINCT "enabled") = 1 AND COUNT(DISTINCT "cadence") = 1
ON CONFLICT ("user_id", "organization_id", "category", "channel") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_quiet_pair";
--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP COLUMN "urgent_bypass_enabled";
--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP COLUMN "quiet_hours_start";
--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP COLUMN "quiet_hours_end";
--> statement-breakpoint
ALTER TABLE "notification_user_settings" ADD CONSTRAINT "notification_user_settings_quiet_pair" CHECK (("notification_user_settings"."quiet_hours_start" IS NULL) = ("notification_user_settings"."quiet_hours_end" IS NULL));
--> statement-breakpoint
ALTER TABLE "notification_user_settings" ADD CONSTRAINT "notification_user_settings_quiet_distinct" CHECK ("notification_user_settings"."quiet_hours_start" IS NULL OR "notification_user_settings"."quiet_hours_start" <> "notification_user_settings"."quiet_hours_end");
