-- Keep response integrity independent from moderation. Numeric ratings remain
-- retained while metric eligibility changes through append-only, reasoned
-- decisions. Existing included responses preserve their current metric
-- semantics and receive an explicit migration decision.

ALTER TABLE "guest_responses"
  ADD COLUMN "integrity_outcome" varchar(32) DEFAULT 'accepted' NOT NULL,
  ADD COLUMN "integrity_reason_code" varchar(100) DEFAULT 'legacy_included' NOT NULL,
  ADD COLUMN "integrity_revision" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "integrity_assessed_at" timestamp with time zone DEFAULT now() NOT NULL;

UPDATE "guest_responses"
SET "integrity_assessed_at" = COALESCE("submitted_at", "created_at"),
    "integrity_reason_code" = 'legacy_included';

ALTER TABLE "guest_responses"
  ADD CONSTRAINT "guest_responses_integrity_outcome_valid"
    CHECK ("integrity_outcome" IN ('accepted', 'filtered_automatically', 'under_review')),
  ADD CONSTRAINT "guest_responses_integrity_reason_valid"
    CHECK ("integrity_reason_code" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  ADD CONSTRAINT "guest_responses_integrity_revision_valid"
    CHECK ("integrity_revision" >= 1);

CREATE INDEX "guest_responses_portal_integrity_idx"
  ON "guest_responses" (
    "organization_id", "property_id", "portal_id", "integrity_outcome"
  );

CREATE TABLE "guest_response_integrity_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "response_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "portal_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "previous_outcome" varchar(32),
  "outcome" varchar(32) NOT NULL,
  "reason_code" varchar(100) NOT NULL,
  "source" varchar(20) NOT NULL,
  "actor_id" varchar(255) NOT NULL,
  "decided_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guest_response_integrity_decisions_revision_valid"
    CHECK ("revision" >= 1),
  CONSTRAINT "guest_response_integrity_decisions_initial_revision_valid"
    CHECK (("revision" = 1 AND "previous_outcome" IS NULL) OR ("revision" > 1 AND "previous_outcome" IS NOT NULL)),
  CONSTRAINT "guest_response_integrity_decisions_previous_outcome_valid"
    CHECK ("previous_outcome" IS NULL OR "previous_outcome" IN ('accepted', 'filtered_automatically', 'under_review')),
  CONSTRAINT "guest_response_integrity_decisions_outcome_valid"
    CHECK ("outcome" IN ('accepted', 'filtered_automatically', 'under_review')),
  CONSTRAINT "guest_response_integrity_decisions_reason_valid"
    CHECK ("reason_code" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  CONSTRAINT "guest_response_integrity_decisions_source_valid"
    CHECK ("source" IN ('system', 'automatic', 'reviewer', 'migration'))
);

CREATE UNIQUE INDEX "guest_response_integrity_decisions_response_revision_key"
  ON "guest_response_integrity_decisions" ("response_id", "revision");

CREATE INDEX "guest_response_integrity_decisions_scope_outcome_idx"
  ON "guest_response_integrity_decisions" (
    "organization_id", "property_id", "portal_id", "outcome", "decided_at"
  );

ALTER TABLE "guest_response_integrity_decisions"
  ADD CONSTRAINT "guest_response_integrity_decisions_response_scope_fk"
  FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id")
  REFERENCES "public"."guest_responses"(
    "organization_id", "property_id", "portal_id", "id"
  ) ON DELETE CASCADE;

INSERT INTO "guest_response_integrity_decisions" (
  "response_id",
  "organization_id",
  "property_id",
  "portal_id",
  "revision",
  "previous_outcome",
  "outcome",
  "reason_code",
  "source",
  "actor_id",
  "decided_at"
)
SELECT
  "id",
  "organization_id",
  "property_id",
  "portal_id",
  1,
  NULL,
  'accepted',
  'legacy_included',
  'migration',
  'migration:0103',
  "integrity_assessed_at"
FROM "guest_responses";
