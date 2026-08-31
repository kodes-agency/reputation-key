CREATE TABLE "guest_contact_request_purge_checkpoints" (
	"authority" varchar(64) PRIMARY KEY NOT NULL,
	"cursor_expires_at" timestamp with time zone,
	"cursor_id" uuid,
	"completed_through" timestamp with time zone,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_contact_purge_checkpoint_authority_valid" CHECK ("guest_contact_request_purge_checkpoints"."authority" = 'guest-contact-30d-v1'),
	CONSTRAINT "guest_contact_purge_checkpoint_cursor_pair" CHECK (("guest_contact_request_purge_checkpoints"."cursor_expires_at" IS NULL) = ("guest_contact_request_purge_checkpoints"."cursor_id" IS NULL)),
	CONSTRAINT "guest_contact_purge_checkpoint_count_valid" CHECK ("guest_contact_request_purge_checkpoints"."processed_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guest_contact_request_reveal_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_request_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"access_purpose" varchar(50) NOT NULL,
	"authority_basis" varchar(32) NOT NULL,
	"revealed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_contact_reveal_audits_purpose_valid" CHECK ("guest_contact_request_reveal_audits"."access_purpose" = 'respond_to_contact_request'),
	CONSTRAINT "guest_contact_reveal_audits_authority_valid" CHECK ("guest_contact_request_reveal_audits"."authority_basis" IN ('account_admin', 'portal_creator', 'responsible_manager'))
);
--> statement-breakpoint
CREATE TABLE "guest_contact_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"purpose" varchar(50) NOT NULL,
	"consent_granted" boolean DEFAULT false NOT NULL,
	"encrypted_contact" text,
	"encryption_key_id" varchar(50),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_contact_requests_purpose_valid" CHECK ("guest_contact_requests"."purpose" = 'manager_follow_up'),
	CONSTRAINT "guest_contact_requests_key_id_valid" CHECK ("guest_contact_requests"."encryption_key_id" IS NULL OR "guest_contact_requests"."encryption_key_id" ~ '^[a-z0-9][a-z0-9._-]{0,49}$'),
	CONSTRAINT "guest_contact_requests_retention_exact" CHECK ("guest_contact_requests"."expires_at" = "guest_contact_requests"."submitted_at" + INTERVAL '720:00:00'),
	CONSTRAINT "guest_contact_requests_lifecycle_valid" CHECK ((
        "guest_contact_requests"."status" = 'active'
        AND "guest_contact_requests"."consent_granted" = true
        AND "guest_contact_requests"."encrypted_contact" IS NOT NULL
        AND "guest_contact_requests"."encryption_key_id" IS NOT NULL
        AND "guest_contact_requests"."withdrawn_at" IS NULL
        AND "guest_contact_requests"."purged_at" IS NULL
      ) OR (
        "guest_contact_requests"."status" = 'withdrawn'
        AND "guest_contact_requests"."consent_granted" = false
        AND "guest_contact_requests"."encrypted_contact" IS NULL
        AND "guest_contact_requests"."withdrawn_at" IS NOT NULL
        AND "guest_contact_requests"."purged_at" IS NULL
      ) OR (
        "guest_contact_requests"."status" = 'expired'
        AND "guest_contact_requests"."consent_granted" = false
        AND "guest_contact_requests"."encrypted_contact" IS NULL
        AND "guest_contact_requests"."withdrawn_at" IS NULL
        AND "guest_contact_requests"."purged_at" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_contact_requests_org_id_key" ON "guest_contact_requests" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_contact_requests_scope_id_key" ON "guest_contact_requests" USING btree ("organization_id","property_id","portal_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_contact_requests_response_key" ON "guest_contact_requests" USING btree ("organization_id","response_id");--> statement-breakpoint
CREATE INDEX "guest_contact_requests_expiry_idx" ON "guest_contact_requests" USING btree ("status","expires_at","id");--> statement-breakpoint
ALTER TABLE "guest_contact_request_reveal_audits" ADD CONSTRAINT "guest_contact_reveal_audits_request_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","contact_request_id") REFERENCES "public"."guest_contact_requests"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD CONSTRAINT "guest_contact_requests_response_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","response_id") REFERENCES "public"."guest_responses"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD CONSTRAINT "guest_contact_requests_portal_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_contact_reveal_audits_request_idx" ON "guest_contact_request_reveal_audits" USING btree ("organization_id","contact_request_id","revealed_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "retire_guest_contact_on_response_terminal_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  retired_at timestamp with time zone := COALESCE(NEW."deleted_at", NEW."updated_at", CURRENT_TIMESTAMP);
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
  ELSIF NEW."status" = 'deleted' OR NEW."deleted_at" IS NOT NULL THEN
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
AFTER UPDATE OF "status", "deleted_at" ON "guest_responses"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
)
EXECUTE FUNCTION "retire_guest_contact_on_response_terminal_v1"();
