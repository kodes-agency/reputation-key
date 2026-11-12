-- The unlisted-review hold counts down on the mapping, so it outlives the
-- snapshot run that began it. Nullable with no default: no table rewrite.
ALTER TABLE "review_provider_subjects" ADD COLUMN "unlisted_hold_runs_left" integer;
