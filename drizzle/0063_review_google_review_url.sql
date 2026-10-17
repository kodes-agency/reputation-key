-- "Open on Google" in the Inbox: each Review's own Business Profile page.
--
-- `google_review_url` holds Google's output-only `reviewReplyUrl` for the
-- review ("URL for replying to the review", GBP API v4.9), kept only in the
-- one shape Google sends for the review's own location
-- (src/shared/domain/google-review-links.ts) and otherwise NULL. It is provider
-- cache data under ADR 0031, like the content beside it: written with the
-- erasable source content (`review_source_contents`) and its REV-01
-- compatibility copy on `reviews` in the same transaction, compared by the
-- lifecycle shadow-parity inspection, and erased with them. It is in no
-- observation, material or normalized digest, in no `review_source_observations`
-- row, in no AI input and in no export, so adding it changes no stored digest
-- and makes no Review look changed.
--
-- No backfill. Every applied fetch writes the column, the unchanged-content
-- refresh that extends `content_expires_at` included, so a Review gets its link
-- on the next sync that sees it (the refresh sweep reaches every live Review
-- before its 30-day expiry). Until then it is NULL and the Inbox offers the
-- Property's public reviews page instead.
--
-- The tombstone arm of `reviews_source_content_state_valid` gains the column,
-- so the database itself keeps it off an erased Review, as it does every other
-- provider value. Every existing row is NULL there, so the constraint holds on
-- any data. A process older than this release never writes the column; one that
-- erases a Review a newer worker gave a link is refused by the constraint and
-- retried, rather than leaving a provider identifier on a tombstone. That can
-- happen only while an old and a new worker overlap in a deploy: brief CHECK
-- violations and job retries in the worker log then, none after.
--
-- The constraint is restated, not added `NOT VALID` and validated later as
-- ADR 0049 prefers for forward-only migrations, like 0043 and 0044. drizzle
-- applies every pending file in one transaction, so a NOT VALID/VALIDATE pair
-- here, or in a second file of the same deploy, would hold the same ACCESS
-- EXCLUSIVE lock across the same scan; only a later deploy would shorten it.
-- At beta size the scan is short, and migrate-deploy bounds the lock WAIT
-- (src/shared/db/migration-lock-timeout.ts).
--
-- Purely additive for old code otherwise: it names its columns in every
-- statement and never reads these. Roll forward, never back: the down step is
-- the constraint restated without `google_review_url`, both columns dropped,
-- and the 0063 row out of drizzle.__drizzle_migrations.
ALTER TABLE "reviews" ADD COLUMN "google_review_url" varchar(2048);
--> statement-breakpoint
ALTER TABLE "review_source_contents" ADD COLUMN "google_review_url" varchar(2048);
--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_source_content_state_valid";
--> statement-breakpoint
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
        AND "reviews"."google_review_url" IS NULL
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
