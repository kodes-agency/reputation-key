-- Denormalize reviewer_name onto inbox_items so it survives review deletion.
-- Previously reviewer_name was looked up dynamically from reviews; when reviews
-- were purged (expires_at passed), inbox items showed "Anonymous".
-- This matches the existing snippet column pattern (already denormalized).

-- 1. Add the column (nullable — legacy items may not have it).
ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS reviewer_name varchar(255);

-- 2. Backfill from reviews for inbox items whose reviews still exist.
UPDATE inbox_items
SET reviewer_name = r.reviewer_name
FROM reviews r
WHERE inbox_items.source_id = r.id
  AND inbox_items.source_type = 'review'
  AND inbox_items.reviewer_name IS NULL
  AND r.reviewer_name IS NOT NULL;

-- 3. Archive inbox items whose reviews have been purged (orphaned source_id).
--    These reference deleted reviews — the name is irrecoverable.
--    Archiving removes them from the active inbox view.
UPDATE inbox_items
SET status = 'archived',
    archived_at = now(),
    updated_at = now()
WHERE source_type = 'review'
  AND status != 'archived'
  AND source_id::text NOT IN (SELECT id::text FROM reviews);
