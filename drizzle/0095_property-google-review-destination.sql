ALTER TABLE "properties"
  ADD COLUMN "google_review_uri" varchar(2048),
  ADD COLUMN "google_review_destination_state" varchar(32) DEFAULT 'unavailable' NOT NULL,
  ADD COLUMN "google_review_destination_retrieved_at" timestamp with time zone,
  ADD COLUMN "google_review_destination_source_epoch" integer,
  ADD COLUMN "google_review_destination_profile_version" integer;

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_google_review_destination_valid" CHECK (
    (
      "google_review_destination_state" IN ('verified', 'awaiting_refresh')
      AND "google_review_uri" IS NOT NULL
      AND "google_review_uri" ~ '^https://'
      AND "google_review_destination_retrieved_at" IS NOT NULL
      AND "google_review_destination_source_epoch" >= 0
      AND "google_review_destination_profile_version" >= 1
    )
    OR (
      "google_review_destination_state" = 'unavailable'
      AND "google_review_uri" IS NULL
      AND "google_review_destination_retrieved_at" IS NULL
      AND "google_review_destination_source_epoch" IS NULL
      AND "google_review_destination_profile_version" IS NULL
    )
  );

ALTER TABLE "gbp_import_request_items"
  ADD COLUMN "google_review_uri" varchar(2048);

ALTER TABLE "gbp_import_request_items"
  ADD CONSTRAINT "gbp_import_request_items_google_review_uri_valid"
  CHECK ("google_review_uri" IS NULL OR "google_review_uri" ~ '^https://');
