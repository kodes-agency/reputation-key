CREATE TABLE "guest_destination_action_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "portal_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "destination_id" varchar(255) NOT NULL,
  "destination_kind" varchar(24) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guest_destination_action_receipts_portal_fk"
    FOREIGN KEY ("organization_id", "property_id", "portal_id")
    REFERENCES "public"."portals"("organization_id", "property_id", "id")
    ON DELETE RESTRICT,
  CONSTRAINT "guest_destination_action_receipts_kind_valid"
    CHECK ("destination_kind" IN ('google_review', 'secondary_link')),
  CONSTRAINT "guest_destination_action_receipts_live_window"
    CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "guest_destination_action_receipts_dedupe"
  ON "guest_destination_action_receipts" (
    "organization_id",
    "portal_id",
    "session_id",
    "destination_kind",
    "destination_id"
  );

CREATE INDEX "guest_destination_action_receipts_expiry_idx"
  ON "guest_destination_action_receipts" ("expires_at");
