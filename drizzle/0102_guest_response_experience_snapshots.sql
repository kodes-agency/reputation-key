-- Capture the exact server-resolved Portal experience that governed each new
-- private rating. Existing responses remain without a snapshot: backfilling
-- today's Portal state would invent historical evidence.

CREATE TABLE "guest_response_experience_snapshots" (
  "response_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "portal_id" uuid NOT NULL,
  "publication_state" varchar(20) NOT NULL,
  "configuration_digest" varchar(64) NOT NULL,
  "guest_locale" varchar(35) NOT NULL,
  "language_pack_version" varchar(100) NOT NULL,
  "private_feedback_threshold" integer NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  CONSTRAINT "guest_response_experience_snapshots_publication_state_valid"
    CHECK ("publication_state" = 'published'),
  CONSTRAINT "guest_response_experience_snapshots_configuration_digest_valid"
    CHECK ("configuration_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "guest_response_experience_snapshots_guest_locale_valid"
    CHECK ("guest_locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CONSTRAINT "guest_response_experience_snapshots_threshold_valid"
    CHECK ("private_feedback_threshold" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "guest_response_experience_snapshots_org_key"
  ON "guest_response_experience_snapshots" ("organization_id", "response_id");

ALTER TABLE "guest_response_experience_snapshots"
  ADD CONSTRAINT "guest_response_experience_snapshots_response_scope_fk"
  FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id")
  REFERENCES "public"."guest_responses"(
    "organization_id", "property_id", "portal_id", "id"
  ) ON DELETE CASCADE;
