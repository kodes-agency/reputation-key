-- Two nullable stamps on review_sync_state, one row per Property. Purely
-- additive: a nullable column without a default rewrites nothing and holds its
-- lock only for the catalogue change.
--
-- `head_covered_at` is when a persisting head check last stored all of
-- Google's newest page for the Property. With a reconciliation window above a
-- day, the discovery sweep skips the full listing only while this is recent.
-- `full_read_requested_at` is when something asked for a full listing ahead of
-- the window (the content refresh, or a head check that found a whole page
-- changed); the sweep honours it once the last listing is six hours old.
-- Older processes neither read nor write either column.
ALTER TABLE "review_sync_state" ADD COLUMN "head_covered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_sync_state" ADD COLUMN "full_read_requested_at" timestamp with time zone;
