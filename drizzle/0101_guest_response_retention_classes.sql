-- Split Guest Response storage by retention class. The canonical response keeps
-- only content-free managerial facts/tombstones; recovery authority and private
-- feedback content expire independently.

CREATE TABLE "guest_response_session_bindings" (
  "response_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "portal_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guest_response_session_bindings_live_window"
    CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "guest_response_session_bindings_dedupe"
  ON "guest_response_session_bindings"
  ("organization_id", "portal_id", "session_id");
CREATE INDEX "guest_response_session_bindings_expiry_idx"
  ON "guest_response_session_bindings" ("expires_at");

ALTER TABLE "guest_response_session_bindings"
  ADD CONSTRAINT "guest_response_session_bindings_response_tenant_fk"
  FOREIGN KEY ("organization_id", "response_id")
  REFERENCES "public"."guest_responses"("organization_id", "id")
  ON DELETE CASCADE;
ALTER TABLE "guest_response_session_bindings"
  ADD CONSTRAINT "guest_response_session_bindings_response_scope_fk"
  FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id")
  REFERENCES "public"."guest_responses"(
    "organization_id", "property_id", "portal_id", "id"
  ) ON DELETE CASCADE;

CREATE TABLE "guest_response_private_feedback" (
  "response_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "portal_id" uuid NOT NULL,
  "body" text NOT NULL,
  "submitted_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guest_response_private_feedback_body_length"
    CHECK (char_length("body") BETWEEN 1 AND 2000),
  CONSTRAINT "guest_response_private_feedback_live_window"
    CHECK ("expires_at" > "submitted_at")
);

CREATE INDEX "guest_response_private_feedback_expiry_idx"
  ON "guest_response_private_feedback" ("expires_at");

ALTER TABLE "guest_response_private_feedback"
  ADD CONSTRAINT "guest_response_private_feedback_response_tenant_fk"
  FOREIGN KEY ("organization_id", "response_id")
  REFERENCES "public"."guest_responses"("organization_id", "id")
  ON DELETE CASCADE;
ALTER TABLE "guest_response_private_feedback"
  ADD CONSTRAINT "guest_response_private_feedback_response_scope_fk"
  FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id")
  REFERENCES "public"."guest_responses"(
    "organization_id", "property_id", "portal_id", "id"
  ) ON DELETE CASCADE;

-- Existing canonical sessions have no persisted cookie issuance timestamp.
-- Their response creation time is the narrowest safe recovery approximation;
-- new writes persist the signed cookie's exact expiry.
INSERT INTO "guest_response_session_bindings" (
  "response_id", "organization_id", "property_id", "portal_id",
  "session_id", "expires_at", "created_at"
)
SELECT
  "id", "organization_id", "property_id", "portal_id",
  "session_id", "created_at" + INTERVAL '24 hours', "created_at"
FROM "guest_responses";

INSERT INTO "guest_response_private_feedback" (
  "response_id", "organization_id", "property_id", "portal_id",
  "body", "submitted_at", "expires_at", "created_at"
)
SELECT
  "id", "organization_id", "property_id", "portal_id", "response_text",
  COALESCE("feedback_submitted_at", "updated_at", "submitted_at", "created_at"),
  COALESCE("feedback_submitted_at", "updated_at", "submitted_at", "created_at")
    + INTERVAL '90 days',
  COALESCE("feedback_submitted_at", "updated_at", "submitted_at", "created_at")
FROM "guest_responses"
WHERE "response_text" IS NOT NULL;

-- The canonical fact/tombstone now has the independent 24-month horizon.
UPDATE "guest_responses"
SET "retention_deadline" =
  COALESCE("submitted_at", "created_at") + INTERVAL '24 months';

ALTER TABLE "guest_responses"
  DROP CONSTRAINT "guest_responses_feedback_withdrawal_valid";
DROP INDEX "guest_responses_session_portal_unique";
ALTER TABLE "guest_responses" DROP COLUMN "session_id";
ALTER TABLE "guest_responses" DROP COLUMN "response_text";
ALTER TABLE "guest_responses"
  ADD CONSTRAINT "guest_responses_feedback_withdrawal_valid"
  CHECK (
    "feedback_withdrawn_at" IS NULL
    OR (
      "feedback_submitted_at" IS NOT NULL
      AND "text_consent" = false
      AND "feedback_source_event_id" IS NULL
    )
  );
