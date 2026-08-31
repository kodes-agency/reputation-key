DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "guest_contact_requests" LIMIT 1) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = '0121 cannot invent Contact Request notice evidence for pre-existing rows';
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "guest_contact_request_reveal_audits" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD COLUMN "publication_snapshot_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD COLUMN "publication_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD COLUMN "publication_digest" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD COLUMN "contact_request_enabled" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD COLUMN "notice_id" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD COLUMN "notice_version" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD COLUMN "notice_digest" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD COLUMN "notice_locale" varchar(35) NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD COLUMN "retention_policy_version" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "contact_request_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "contact_notice_id" varchar(100);--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "contact_notice_version" varchar(100);--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "contact_notice_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "contact_notice_locale" varchar(35);--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "contact_request_purpose" varchar(50) DEFAULT 'manager_follow_up' NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD COLUMN "contact_retention_policy_version" varchar(100) DEFAULT 'guest-contact-retention-30d-v1' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_snapshots_contact_evidence_binding_key" ON "portal_publication_snapshots" USING btree ("organization_id","property_id","portal_id","id","version","configuration_digest","contact_request_enabled","contact_notice_id","contact_notice_version","contact_notice_digest","contact_notice_locale","contact_request_purpose","contact_retention_policy_version");--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD CONSTRAINT "guest_contact_requests_publication_evidence_fk" FOREIGN KEY ("organization_id","property_id","portal_id","publication_snapshot_id","publication_version","publication_digest","contact_request_enabled","notice_id","notice_version","notice_digest","notice_locale","purpose","retention_policy_version") REFERENCES "public"."portal_publication_snapshots"("organization_id","property_id","portal_id","id","version","configuration_digest","contact_request_enabled","contact_notice_id","contact_notice_version","contact_notice_digest","contact_notice_locale","contact_request_purpose","contact_retention_policy_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD CONSTRAINT "guest_contact_requests_publication_evidence_valid" CHECK ("guest_contact_requests"."publication_version" >= 1
        AND "guest_contact_requests"."publication_digest" ~ '^[0-9a-f]{64}$'
        AND "guest_contact_requests"."contact_request_enabled" = true
        AND char_length("guest_contact_requests"."notice_id") BETWEEN 1 AND 100
        AND char_length("guest_contact_requests"."notice_version") BETWEEN 1 AND 100
        AND "guest_contact_requests"."notice_digest" ~ '^[0-9a-f]{64}$'
        AND "guest_contact_requests"."notice_locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
        AND "guest_contact_requests"."retention_policy_version" = 'guest-contact-retention-30d-v1');--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_contact_evidence_valid" CHECK ("portal_publication_snapshots"."contact_request_enabled" = false OR (
        "portal_publication_snapshots"."contact_notice_id" IS NOT NULL
        AND char_length("portal_publication_snapshots"."contact_notice_id") BETWEEN 1 AND 100
        AND "portal_publication_snapshots"."contact_notice_version" IS NOT NULL
        AND char_length("portal_publication_snapshots"."contact_notice_version") BETWEEN 1 AND 100
        AND "portal_publication_snapshots"."contact_notice_digest" ~ '^[0-9a-f]{64}$'
        AND "portal_publication_snapshots"."contact_notice_locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
      ));--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_contact_purpose_valid" CHECK ("portal_publication_snapshots"."contact_request_purpose" = 'manager_follow_up');--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_contact_retention_valid" CHECK ("portal_publication_snapshots"."contact_retention_policy_version" = 'guest-contact-retention-30d-v1');--> statement-breakpoint
DROP TRIGGER IF EXISTS "guest_responses_retire_contact_request" ON "guest_responses";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "retire_guest_contact_on_response_terminal_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  retired_at timestamp with time zone := COALESCE(
    NEW."feedback_withdrawn_at",
    NEW."deleted_at",
    NEW."updated_at",
    CURRENT_TIMESTAMP
  );
BEGIN
  IF NEW."status" = 'expired' THEN
    UPDATE "guest_contact_requests"
    SET "status" = 'expired',
        "consent_granted" = false,
        "encrypted_contact" = NULL,
        "withdrawn_at" = NULL,
        "purged_at" = retired_at,
        "updated_at" = retired_at
    WHERE "organization_id" = NEW."organization_id"
      AND "property_id" = NEW."property_id"
      AND "portal_id" = NEW."portal_id"
      AND "response_id" = NEW."id"
      AND "status" = 'active';
  ELSIF NEW."status" = 'deleted'
    OR NEW."deleted_at" IS NOT NULL
    OR (
      OLD."feedback_withdrawn_at" IS NULL
      AND NEW."feedback_withdrawn_at" IS NOT NULL
    ) THEN
    UPDATE "guest_contact_requests"
    SET "status" = 'withdrawn',
        "consent_granted" = false,
        "encrypted_contact" = NULL,
        "withdrawn_at" = retired_at,
        "purged_at" = NULL,
        "updated_at" = retired_at
    WHERE "organization_id" = NEW."organization_id"
      AND "property_id" = NEW."property_id"
      AND "portal_id" = NEW."portal_id"
      AND "response_id" = NEW."id"
      AND "status" = 'active';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "guest_responses_retire_contact_request"
AFTER UPDATE OF "status", "deleted_at", "feedback_withdrawn_at" ON "guest_responses"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
  OR OLD."feedback_withdrawn_at" IS DISTINCT FROM NEW."feedback_withdrawn_at"
)
EXECUTE FUNCTION "retire_guest_contact_on_response_terminal_v1"();
