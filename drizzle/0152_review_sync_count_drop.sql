-- Two nullable stamps on review_sync_state, one row per Property. Purely
-- additive: a nullable column without a default rewrites nothing and holds its
-- lock only for the catalogue change.
--
-- `count_drop_seen_at` is when a head check first saw Google's review total
-- fall below the Property's stored live count (a review deleted on Google that
-- RepKey still shows); `count_drop_checked_at` is the latest head check that
-- still saw it. A head check at least 15 minutes after the first sighting that
-- still sees the drop asks the discovery sweep for a full read; a check at or
-- above the stored count, or a completed listing that leaves the stored count
-- no higher than Google's total, clears both; after 72 hours the checks stop
-- asking, and the drop is alerted on while checks keep seeing it. Older
-- processes neither read nor write the columns.
ALTER TABLE "review_sync_state" ADD COLUMN "count_drop_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_sync_state" ADD COLUMN "count_drop_checked_at" timestamp with time zone;
