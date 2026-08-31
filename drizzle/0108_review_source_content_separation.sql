CREATE TABLE "review_source_contents" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"platform" "review_platform" NOT NULL,
	"external_id" varchar(500) NOT NULL,
	"external_location_id" varchar(500) NOT NULL,
	"google_connection_id" uuid,
	"reviewer_name" varchar(255),
	"reviewer_profile_photo_url" varchar(1000),
	"rating" integer NOT NULL,
	"text" text,
	"translated_text" text,
	"language_code" varchar(10),
	"reviewed_at" timestamp with time zone NOT NULL,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"first_fetched_at" timestamp with time zone,
	"last_fetched_at" timestamp with time zone NOT NULL,
	"content_expires_at" timestamp with time zone NOT NULL,
	"content_hash" text,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"ai_source_byte_length" integer NOT NULL,
	"ai_source_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_source_contents_rating_valid" CHECK ("review_source_contents"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "review_source_contents_epoch_revision_safe" CHECK ("review_source_contents"."source_epoch" BETWEEN 0 AND 2147483647
        AND "review_source_contents"."source_revision" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "review_source_contents_ai_source_valid" CHECK ("review_source_contents"."ai_source_byte_length" BETWEEN 1 AND '4294967295'::bigint
        AND "review_source_contents"."ai_source_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "replies" DROP CONSTRAINT "replies_review_id_reviews_id_fk";
--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "external_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "external_location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "reviewed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "ai_source_byte_length" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "ai_source_digest" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "source_content_state" varchar(24) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "source_content_erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_source_contents" ADD CONSTRAINT "review_source_contents_google_connection_id_google_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_source_contents" ADD CONSTRAINT "review_source_contents_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_source_contents_provider_identity_unique" ON "review_source_contents" USING btree ("platform","external_id","organization_id");--> statement-breakpoint
CREATE INDEX "review_source_contents_expiry_idx" ON "review_source_contents" USING btree ("content_expires_at","review_id");--> statement-breakpoint
CREATE INDEX "review_source_contents_connection_idx" ON "review_source_contents" USING btree ("google_connection_id");--> statement-breakpoint
-- Expand/backfill only. Existing Review readers continue to use the nullable
-- compatibility columns until shadow parity is sealed. Rows that predate the
-- fetch-based lifecycle contract are deliberately not guessed into the new
-- cache; the cutover audit below reports them for governed reconciliation.
INSERT INTO "review_source_contents" (
  "review_id",
  "organization_id",
  "property_id",
  "platform",
  "external_id",
  "external_location_id",
  "google_connection_id",
  "reviewer_name",
  "reviewer_profile_photo_url",
  "rating",
  "text",
  "translated_text",
  "language_code",
  "reviewed_at",
  "source_created_at",
  "source_updated_at",
  "first_fetched_at",
  "last_fetched_at",
  "content_expires_at",
  "content_hash",
  "source_epoch",
  "source_revision",
  "ai_source_byte_length",
  "ai_source_digest",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "organization_id",
  "property_id",
  "platform",
  "external_id",
  "external_location_id",
  "google_connection_id",
  "reviewer_name",
  "reviewer_profile_photo_url",
  "rating",
  "text",
  "translated_text",
  "language_code",
  "reviewed_at",
  "source_created_at",
  "source_updated_at",
  "first_fetched_at",
  "last_fetched_at",
  "content_expires_at",
  "content_hash",
  "source_epoch",
  "source_revision",
  "ai_source_byte_length",
  "ai_source_digest",
  "created_at",
  "updated_at"
FROM "reviews"
WHERE "external_id" IS NOT NULL
  AND "external_location_id" IS NOT NULL
  AND "rating" IS NOT NULL
  AND "reviewed_at" IS NOT NULL
  AND "last_fetched_at" IS NOT NULL
  AND "content_expires_at" IS NOT NULL
  AND "ai_source_byte_length" IS NOT NULL
  AND "ai_source_digest" IS NOT NULL
ON CONFLICT ("review_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_source_content_state_valid" CHECK ((
        "reviews"."source_content_state" = 'active'
        AND "reviews"."source_content_erased_at" IS NULL
      ) OR (
        "reviews"."source_content_state" IN ('source_expired', 'provider_deleted')
        AND "reviews"."source_content_erased_at" IS NOT NULL
        AND "reviews"."external_id" IS NULL
        AND "reviews"."external_location_id" IS NULL
        AND "reviews"."google_connection_id" IS NULL
        AND "reviews"."reviewer_name" IS NULL
        AND "reviews"."reviewer_profile_photo_url" IS NULL
        AND "reviews"."rating" IS NULL
        AND "reviews"."text" IS NULL
        AND "reviews"."translated_text" IS NULL
        AND "reviews"."language_code" IS NULL
        AND "reviews"."reviewed_at" IS NULL
        AND "reviews"."source_created_at" IS NULL
        AND "reviews"."source_updated_at" IS NULL
        AND "reviews"."content_hash" IS NULL
        AND "reviews"."ai_source_byte_length" IS NULL
        AND "reviews"."ai_source_digest" IS NULL
      ));
