-- Add organizationId column to goal_progress for defense-in-depth tenant isolation
ALTER TABLE goal_progress ADD COLUMN IF NOT EXISTS organization_id VARCHAR(255);

-- Backfill from parent goal
UPDATE goal_progress gp SET organization_id = (
  SELECT organization_id FROM goals WHERE goals.id = gp.goal_id
) WHERE organization_id IS NULL;

-- Index for org-scoped lookups
CREATE INDEX IF NOT EXISTS goal_progress_org_idx ON goal_progress(organization_id);
