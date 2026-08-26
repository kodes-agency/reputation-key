-- REV-01 expand: stable Review identity now owns explicit provider observations
-- and numbered material revisions. This migration deliberately does not enable
-- the recurring lifecycle apply path; deployed shadow/parity evidence remains
-- a later rollout gate.

ALTER TABLE "reviews" ADD COLUMN "source_observation_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "material_normalization_version" varchar(64);--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "material_source_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "material_normalized_digest" varchar(64);--> statement-breakpoint

CREATE TABLE "material_review_revisions" (
	"review_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"normalization_version" varchar(64) NOT NULL,
	"source_digest" varchar(64),
	"normalized_digest" varchar(64),
	"rating" integer,
	"normalized_text" text,
	"content_state" varchar(24) DEFAULT 'active' NOT NULL,
	"content_erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_review_revisions_pk" PRIMARY KEY("review_id","revision"),
	CONSTRAINT "material_review_revisions_controls_safe" CHECK ("material_review_revisions"."source_epoch" BETWEEN 0 AND 2147483647
        AND "material_review_revisions"."revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "material_review_revisions_comparison_valid" CHECK ((
        "material_review_revisions"."normalization_version" = 'legacy-unverified-v0'
        AND "material_review_revisions"."source_digest" IS NULL
        AND "material_review_revisions"."normalized_digest" IS NULL
      ) OR (
        "material_review_revisions"."normalization_version" = 'review-material-v1'
        AND "material_review_revisions"."source_digest" IS NOT NULL
        AND "material_review_revisions"."source_digest" ~ '^[0-9a-f]{64}$'
        AND "material_review_revisions"."normalized_digest" IS NOT NULL
        AND "material_review_revisions"."normalized_digest" ~ '^[0-9a-f]{64}$'
      )),
	CONSTRAINT "material_review_revisions_content_state_valid" CHECK ((
        "material_review_revisions"."content_state" = 'active'
        AND "material_review_revisions"."content_erased_at" IS NULL
        AND "material_review_revisions"."rating" IS NOT NULL
        AND "material_review_revisions"."rating" BETWEEN 1 AND 5
      ) OR (
        "material_review_revisions"."content_state" IN ('source_expired', 'provider_deleted')
        AND "material_review_revisions"."content_erased_at" IS NOT NULL
        AND "material_review_revisions"."rating" IS NULL
        AND "material_review_revisions"."normalized_text" IS NULL
      ))
);--> statement-breakpoint

CREATE TABLE "review_source_observations" (
	"review_id" uuid NOT NULL,
	"observation_sequence" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"observation_key" varchar(64) NOT NULL,
	"observation_digest" varchar(64) NOT NULL,
	"material_revision" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"content_expires_at" timestamp with time zone NOT NULL,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"source_digest" varchar(64),
	"normalization_version" varchar(64) NOT NULL,
	"normalized_digest" varchar(64),
	"comparison_result" varchar(40) NOT NULL,
	"rating" integer,
	"original_text" text,
	"translated_text" text,
	"language_code" varchar(10),
	"reviewer_name" varchar(255),
	"reviewer_profile_photo_url" varchar(1000),
	"reviewed_at" timestamp with time zone,
	"content_state" varchar(24) DEFAULT 'active' NOT NULL,
	"content_erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_source_observations_pk" PRIMARY KEY("review_id","observation_sequence"),
	CONSTRAINT "review_source_observations_controls_safe" CHECK ("review_source_observations"."source_epoch" BETWEEN 0 AND 2147483647
        AND "review_source_observations"."observation_sequence" BETWEEN 1 AND '9007199254740991'::bigint
        AND "review_source_observations"."material_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "review_source_observations_digest_valid" CHECK ("review_source_observations"."observation_key" ~ '^[0-9a-f]{64}$'
        AND "review_source_observations"."observation_digest" ~ '^[0-9a-f]{64}$'
        AND ((
          "review_source_observations"."normalization_version" = 'legacy-unverified-v0'
          AND "review_source_observations"."source_digest" IS NULL
          AND "review_source_observations"."normalized_digest" IS NULL
        ) OR (
          "review_source_observations"."normalization_version" = 'review-material-v1'
          AND "review_source_observations"."source_digest" IS NOT NULL
          AND "review_source_observations"."source_digest" ~ '^[0-9a-f]{64}$'
          AND "review_source_observations"."normalized_digest" IS NOT NULL
          AND "review_source_observations"."normalized_digest" ~ '^[0-9a-f]{64}$'
        ))),
	CONSTRAINT "review_source_observations_comparison_valid" CHECK ("review_source_observations"."comparison_result" IN (
        'backfilled_unverified',
        'initial_material_revision',
        'unchanged',
        'material_change',
        'normalization_shadow_match',
        'baseline_unavailable',
        'out_of_order_ignored'
      )),
	CONSTRAINT "review_source_observations_content_state_valid" CHECK ((
        "review_source_observations"."content_state" = 'active'
        AND "review_source_observations"."content_erased_at" IS NULL
        AND "review_source_observations"."rating" IS NOT NULL
        AND "review_source_observations"."rating" BETWEEN 1 AND 5
        AND "review_source_observations"."reviewed_at" IS NOT NULL
      ) OR (
        "review_source_observations"."content_state" IN ('source_expired', 'provider_deleted')
        AND "review_source_observations"."content_erased_at" IS NOT NULL
        AND "review_source_observations"."rating" IS NULL
        AND "review_source_observations"."original_text" IS NULL
        AND "review_source_observations"."translated_text" IS NULL
        AND "review_source_observations"."language_code" IS NULL
        AND "review_source_observations"."reviewer_name" IS NULL
        AND "review_source_observations"."reviewer_profile_photo_url" IS NULL
        AND "review_source_observations"."reviewed_at" IS NULL
        AND "review_source_observations"."source_created_at" IS NULL
        AND "review_source_observations"."source_updated_at" IS NULL
      ))
);--> statement-breakpoint

ALTER TABLE "material_review_revisions" ADD CONSTRAINT "material_review_revisions_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_source_observations" ADD CONSTRAINT "review_source_observations_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_source_observations" ADD CONSTRAINT "review_source_observations_material_revision_fk" FOREIGN KEY ("review_id","material_revision") REFERENCES "public"."material_review_revisions"("review_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_review_revisions_scope_idx" ON "material_review_revisions" USING btree ("organization_id","property_id","review_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "review_source_observations_key_unique" ON "review_source_observations" USING btree ("review_id","source_epoch","observation_key");--> statement-breakpoint
CREATE INDEX "review_source_observations_digest_idx" ON "review_source_observations" USING btree ("review_id","source_epoch","observation_digest");--> statement-breakpoint
CREATE INDEX "review_source_observations_expiry_idx" ON "review_source_observations" USING btree ("content_state","content_expires_at","review_id","observation_sequence");--> statement-breakpoint

-- Existing mutable rows become one explicitly unverified revision. The first
-- post-expand observation evaluates the old rating/text under v1 in shadow and
-- adopts the baseline without incrementing the revision when it still matches.
INSERT INTO "material_review_revisions" (
  "review_id",
  "revision",
  "organization_id",
  "property_id",
  "source_epoch",
  "normalization_version",
  "source_digest",
  "normalized_digest",
  "rating",
  "normalized_text",
  "content_state",
  "content_erased_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  1,
  "organization_id",
  "property_id",
  "source_epoch",
  'legacy-unverified-v0',
  NULL,
  NULL,
  CASE WHEN "source_content_state" = 'active' THEN "rating" ELSE NULL END,
  CASE WHEN "source_content_state" = 'active' THEN "text" ELSE NULL END,
  "source_content_state",
  "source_content_erased_at",
  "created_at",
  "updated_at"
FROM "reviews"
ON CONFLICT ("review_id", "revision") DO NOTHING;--> statement-breakpoint

INSERT INTO "review_source_observations" (
  "review_id",
  "observation_sequence",
  "organization_id",
  "property_id",
  "source_epoch",
  "observation_key",
  "observation_digest",
  "material_revision",
  "observed_at",
  "content_expires_at",
  "source_created_at",
  "source_updated_at",
  "source_digest",
  "normalization_version",
  "normalized_digest",
  "comparison_result",
  "rating",
  "original_text",
  "translated_text",
  "language_code",
  "reviewer_name",
  "reviewer_profile_photo_url",
  "reviewed_at",
  "content_state",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  1,
  "organization_id",
  "property_id",
  "source_epoch",
  md5('review-observation-key-legacy-v0:' || "id"::text)
    || md5("id"::text || ':review-observation-key-legacy-v0'),
  md5('review-observation-legacy-v0:' || "id"::text)
    || md5("id"::text || ':review-observation-legacy-v0'),
  1,
  "last_fetched_at",
  "content_expires_at",
  "source_created_at",
  "source_updated_at",
  NULL,
  'legacy-unverified-v0',
  NULL,
  'backfilled_unverified',
  "rating",
  "text",
  "translated_text",
  "language_code",
  "reviewer_name",
  "reviewer_profile_photo_url",
  "reviewed_at",
  'active',
  "created_at",
  "updated_at"
FROM "reviews"
WHERE "source_content_state" = 'active'
  AND "rating" IS NOT NULL
  AND "reviewed_at" IS NOT NULL
  AND "last_fetched_at" IS NOT NULL
  AND "content_expires_at" IS NOT NULL
ON CONFLICT ("review_id", "source_epoch", "observation_key") DO NOTHING;--> statement-breakpoint

-- Legacy source_revision included AI/metadata changes, so it is not a valid
-- MaterialReviewRevision number. Expansion starts every stable Review at one;
-- analysis_sequence remains monotonic and existing derivatives fail their
-- source-revision fence until rebuilt.
UPDATE "reviews"
SET "source_revision" = 1,
    "source_observation_sequence" = CASE
      WHEN EXISTS (
        SELECT 1
        FROM "review_source_observations" AS observation
        WHERE observation."review_id" = "reviews"."id"
      ) THEN 1
      ELSE 0
    END,
    "material_normalization_version" = 'legacy-unverified-v0',
    "material_source_digest" = NULL,
    "material_normalized_digest" = NULL;--> statement-breakpoint

UPDATE "review_source_contents"
SET "source_revision" = 1,
    "updated_at" = transaction_timestamp();--> statement-breakpoint

UPDATE "review_provider_subjects"
SET "last_source_revision" = 1,
    "updated_at" = transaction_timestamp();--> statement-breakpoint

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_source_observation_sequence_safe" CHECK ("reviews"."source_observation_sequence" BETWEEN 0 AND '9007199254740991'::bigint);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_material_comparison_head_valid" CHECK ((
        "reviews"."material_normalization_version" IS NULL
        AND "reviews"."material_source_digest" IS NULL
        AND "reviews"."material_normalized_digest" IS NULL
      ) OR (
        "reviews"."material_normalization_version" = 'legacy-unverified-v0'
        AND "reviews"."material_source_digest" IS NULL
        AND "reviews"."material_normalized_digest" IS NULL
      ) OR (
        "reviews"."material_normalization_version" = 'review-material-v1'
        AND "reviews"."material_source_digest" IS NOT NULL
        AND "reviews"."material_source_digest" ~ '^[0-9a-f]{64}$'
        AND "reviews"."material_normalized_digest" IS NOT NULL
        AND "reviews"."material_normalized_digest" ~ '^[0-9a-f]{64}$'
      ));
