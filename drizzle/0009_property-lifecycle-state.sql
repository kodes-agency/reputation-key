-- Migration 0009: Property lifecycle state machine (BETA-1 B1.5)
--
-- Replaces the misleading soft-delete cascade with an explicit state machine:
--   active -> suspended -> archived -> disconnecting -> purge_pending -> purging -> purged
--
-- The existing deleted_at column is preserved for backward compatibility but
-- the new lifecycle_state column is the authoritative state. Properties with
-- deleted_at != NULL will be backfilled to 'archived' lifecycle_state.

-- Lifecycle state column
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lifecycle_state varchar(20) NOT NULL DEFAULT 'active';

-- Reason for the current state (e.g. 'operator_initiated', 'payment_failure', 'policy_violation')
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lifecycle_reason text;

-- When the current lifecycle state was entered
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lifecycle_state_changed_at timestamptz DEFAULT now();

-- Purge grace period deadline (set when entering purge_pending)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS purge_scheduled_for timestamptz;

-- Who initiated the current lifecycle transition
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lifecycle_initiated_by varchar(255);

-- Index for filtering active properties in queries and jobs
CREATE INDEX IF NOT EXISTS properties_lifecycle_state_idx
  ON properties (lifecycle_state)
  WHERE lifecycle_state != 'purged';

-- Backfill: existing soft-deleted properties get 'archived' state
UPDATE properties SET lifecycle_state = 'archived' WHERE deleted_at IS NOT NULL AND lifecycle_state = 'active';

-- Constraint: lifecycle_state must be a valid state value
ALTER TABLE properties ADD CONSTRAINT properties_lifecycle_state_valid
  CHECK (lifecycle_state IN ('active', 'suspended', 'archived', 'disconnecting', 'purge_pending', 'purging', 'purged'));
