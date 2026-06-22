-- GOAL-06: Unique partial index to prevent duplicate recurring instances
-- for the same template + period.
-- The spawn-recurring-instances job uses ON CONFLICT DO NOTHING on this index
-- to handle race conditions when two job runs attempt to spawn the same period.
-- Only applies to instances (parent_goal_id IS NOT NULL); templates are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS goals_parent_period_uniq
  ON goals (parent_goal_id, period_start)
  WHERE parent_goal_id IS NOT NULL;
