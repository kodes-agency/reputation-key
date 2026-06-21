-- Fix: goal_progress.organization_id was nullable but INSERT paths never set it.
-- All new INSERTs now include organizationId. Backfill existing NULL rows from
-- their parent goals before adding the NOT NULL constraint.

-- 1. Backfill NULL organizationId from parent goals table
UPDATE goal_progress gp
SET organization_id = g.organization_id
FROM goals g
WHERE gp.goal_id = g.id
  AND gp.organization_id IS NULL;

-- 2. Delete any orphaned progress rows (no parent goal) with NULL org
DELETE FROM goal_progress
WHERE organization_id IS NULL
  AND goal_id NOT IN (SELECT id FROM goals);

-- 3. Add NOT NULL constraint
ALTER TABLE goal_progress ALTER COLUMN organization_id SET NOT NULL;
