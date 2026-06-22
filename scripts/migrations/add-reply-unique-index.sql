-- Enforce "one published reply per review" invariant (R2-003).
-- Documents a NOTE in review.schema.ts and CONTEXT.md §32 but was never
-- materialised as a DB constraint. This partial unique index prevents
-- duplicate published replies at the database level, closing the TOCTOU
-- gap between the use-case-level check and the insert.
--
-- Safe to re-run (IF NOT EXISTS).

CREATE UNIQUE INDEX IF NOT EXISTS replies_one_published_per_review
  ON replies (review_id, organization_id)
  WHERE status = 'published';
