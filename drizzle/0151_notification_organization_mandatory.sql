-- NTF-01: Organization-scoped mandatory service/security/account notices.
--
-- Preferences stay Property-scoped and are never authoritative for the
-- mandatory category. Notification and email rows may omit property_id only
-- for mandatory Organization facts; all existing Property families remain
-- constrained to a concrete Property.

DELETE FROM "notification_preferences" WHERE "category" = 'mandatory';

ALTER TABLE "notifications" ALTER COLUMN "property_id" DROP NOT NULL;
ALTER TABLE "notification_email_queue" ALTER COLUMN "property_id" DROP NOT NULL;

DROP INDEX "email_queue_idempotency_unique";
CREATE UNIQUE INDEX "email_queue_property_idempotency_unique"
  ON "notification_email_queue" ("organization_id", "property_id", "idempotency_key")
  WHERE "property_id" IS NOT NULL;
CREATE UNIQUE INDEX "email_queue_organization_idempotency_unique"
  ON "notification_email_queue" ("organization_id", "idempotency_key")
  WHERE "property_id" IS NULL;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_mandatory_scope_check"
  CHECK (
    (
      "category" = 'mandatory'
      AND "property_id" IS NULL
      AND "resource_type" = 'organization'
    ) OR (
      "category" <> 'mandatory'
      AND "property_id" IS NOT NULL
      AND "resource_type" <> 'organization'
    )
  ) NOT VALID;
ALTER TABLE "notifications"
  VALIDATE CONSTRAINT "notifications_mandatory_scope_check";

ALTER TABLE "notification_email_queue"
  ADD CONSTRAINT "notification_email_queue_mandatory_scope_check"
  CHECK (
    (
      "category" = 'mandatory'
      AND "property_id" IS NULL
      AND "cadence" = 'immediate'
    ) OR (
      "category" <> 'mandatory'
      AND "property_id" IS NOT NULL
    )
  ) NOT VALID;
ALTER TABLE "notification_email_queue"
  VALIDATE CONSTRAINT "notification_email_queue_mandatory_scope_check";

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_configurable_category_check"
  CHECK ("category" <> 'mandatory') NOT VALID;
ALTER TABLE "notification_preferences"
  VALIDATE CONSTRAINT "notification_preferences_configurable_category_check";
