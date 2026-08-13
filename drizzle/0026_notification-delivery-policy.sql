CREATE TABLE "notification_governance_quarantine" (
  "notification_id" uuid PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL,
  "reason" varchar(64) NOT NULL,
  "quarantined_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "property_id" uuid;
ALTER TABLE "notifications" ADD COLUMN "category" varchar(40);
--> statement-breakpoint
UPDATE "notifications" n SET "property_id" = i."property_id"::uuid
FROM "inbox_items" i
WHERE n."resource_type" = 'inbox_item' AND n."resource_id" = i."id"::text
  AND n."organization_id" = i."organization_id";
UPDATE "notifications" n SET "property_id" = g."property_id"
FROM "goals" g
WHERE n."property_id" IS NULL AND n."resource_type" = 'goal'
  AND n."resource_id" = g."id"::text AND n."organization_id" = g."organization_id";
UPDATE "notifications" n SET "property_id" = r."property_id"
FROM "replies" p JOIN "reviews" r ON r."id" = p."review_id"
WHERE n."property_id" IS NULL AND n."resource_type" = 'reply'
  AND n."resource_id" = p."id"::text AND n."organization_id" = p."organization_id";
UPDATE "notifications" SET "category" = CASE
  WHEN "type" IN ('reply.pending_approval','reply.publish_failed','inbox.escalated') THEN 'urgent_operational'
  WHEN "type" = 'goal.completed' THEN 'digest_summary'
  WHEN "type" = 'badge.awarded' THEN 'recognition'
  ELSE 'workflow_collaboration' END;
--> statement-breakpoint
INSERT INTO "notification_governance_quarantine" ("notification_id","organization_id","reason")
SELECT n."id",n."organization_id",
  CASE WHEN n."property_id" IS NULL THEN 'property_unresolved' ELSE 'property_tenant_mismatch' END
FROM "notifications" n
WHERE n."property_id" IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM "properties" p
    WHERE p."organization_id" = n."organization_id" AND p."id" = n."property_id"
  );
DELETE FROM "notification_email_queue"
WHERE "notification_id" IN (SELECT "notification_id" FROM "notification_governance_quarantine");
DELETE FROM "notifications"
WHERE "id" IN (SELECT "notification_id" FROM "notification_governance_quarantine");
ALTER TABLE "notifications" ALTER COLUMN "property_id" SET NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "category" SET NOT NULL;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_property_tenant_fk"
  FOREIGN KEY ("organization_id","property_id") REFERENCES "properties" ("organization_id","id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "notification_email_queue" ADD COLUMN "property_id" uuid;
ALTER TABLE "notification_email_queue" ADD COLUMN "category" varchar(40);
ALTER TABLE "notification_email_queue" ADD COLUMN "cadence" varchar(16);
ALTER TABLE "notification_email_queue" ADD COLUMN "idempotency_key" varchar(255);
ALTER TABLE "notification_email_queue" ADD COLUMN "provider_message_id" varchar(255);
ALTER TABLE "notification_email_queue" ADD COLUMN "provider_state" varchar(24);
ALTER TABLE "notification_email_queue" ADD COLUMN "last_error_class" varchar(24);
ALTER TABLE "notification_email_queue" ADD COLUMN "suppression_reason" varchar(255);
ALTER TABLE "notification_email_queue" ADD COLUMN "not_before" timestamptz;
ALTER TABLE "notification_email_queue" ADD COLUMN "next_attempt_at" timestamptz;
ALTER TABLE "notification_email_queue" ADD COLUMN "attempted_at" timestamptz;
ALTER TABLE "notification_email_queue" ADD COLUMN "accepted_at" timestamptz;
ALTER TABLE "notification_email_queue" ADD COLUMN "delivered_at" timestamptz;
ALTER TABLE "notification_email_queue" ADD COLUMN "bounced_at" timestamptz;
--> statement-breakpoint
UPDATE "notification_email_queue" q SET
  "property_id" = n."property_id", "category" = n."category",
  "cadence" = CASE WHEN q."priority" = 'urgent' THEN 'immediate' ELSE 'daily' END,
  "idempotency_key" = q."notification_id"::text || ':email',
  "accepted_at" = q."sent_at",
  "provider_state" = CASE WHEN q."status" = 'sent' THEN 'accepted' END,
  "status" = CASE q."status" WHEN 'sent' THEN 'accepted' WHEN 'skipped' THEN 'cancelled' ELSE q."status" END
FROM "notifications" n WHERE q."notification_id" = n."id";
DELETE FROM "notification_email_queue" WHERE "property_id" IS NULL;
ALTER TABLE "notification_email_queue" ALTER COLUMN "property_id" SET NOT NULL;
ALTER TABLE "notification_email_queue" ALTER COLUMN "category" SET NOT NULL;
ALTER TABLE "notification_email_queue" ALTER COLUMN "cadence" SET DEFAULT 'daily';
ALTER TABLE "notification_email_queue" ALTER COLUMN "cadence" SET NOT NULL;
ALTER TABLE "notification_email_queue" ALTER COLUMN "idempotency_key" SET NOT NULL;
ALTER TABLE "notification_email_queue" ADD CONSTRAINT "notification_email_queue_property_tenant_fk"
  FOREIGN KEY ("organization_id","property_id") REFERENCES "properties" ("organization_id","id") ON DELETE CASCADE;
DROP INDEX "email_queue_status_priority_idx";
DROP INDEX "email_queue_urgent_idx";
CREATE INDEX "email_queue_due_idx" ON "notification_email_queue" ("status","cadence","not_before","next_attempt_at");
CREATE INDEX "email_queue_property_digest_idx" ON "notification_email_queue" ("organization_id","property_id","status","cadence");
CREATE UNIQUE INDEX "email_queue_idempotency_unique" ON "notification_email_queue" ("organization_id","property_id","idempotency_key");
--> statement-breakpoint
ALTER TABLE "notification_preferences" RENAME TO "notification_preferences_legacy";
CREATE TABLE "notification_preference_governance_quarantine" (
  "legacy_preference_id" uuid PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL,
  "reason" varchar(64) NOT NULL,
  "quarantined_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "category" varchar(40) NOT NULL,
  "channel" varchar(16) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "cadence" varchar(16) DEFAULT 'daily' NOT NULL,
  "urgent_bypass_enabled" boolean DEFAULT false NOT NULL,
  "quiet_hours_start" time,
  "quiet_hours_end" time,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "notification_preferences_channel_valid" CHECK ("channel" IN ('in_app','email')),
  CONSTRAINT "notification_preferences_cadence_valid" CHECK ("cadence" IN ('immediate','daily')),
  CONSTRAINT "notification_preferences_quiet_pair" CHECK (("quiet_hours_start" IS NULL) = ("quiet_hours_end" IS NULL)),
  CONSTRAINT "notification_preferences_property_tenant_fk" FOREIGN KEY ("organization_id","property_id")
    REFERENCES "properties" ("organization_id","id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "notification_prefs_scope_unique" ON "notification_preferences" ("user_id","organization_id","property_id","category","channel");
INSERT INTO "notification_preference_governance_quarantine"
  ("legacy_preference_id","organization_id","reason")
SELECT "id","organization_id",'property_scope_ambiguous'
FROM "notification_preferences_legacy";
DROP TABLE "notification_preferences_legacy";
--> statement-breakpoint
CREATE TABLE "notification_user_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "locale" varchar(35) DEFAULT 'en' NOT NULL,
  "timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "notification_user_settings_scope_unique" ON "notification_user_settings" ("user_id","organization_id");
