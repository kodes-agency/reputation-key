-- Migration 0016: Region move workflow (BQC-4.5 / ADR 0048)
-- Durable state machine for operator-driven cross-cell property moves:
--   requested → writes_paused → queues_drained → data_copied → verified →
--   target_activated → source_erased → completed
-- Failure/rollback: failed → rolling_back → rolled_back. The source cell stays
-- authoritative until target_activated commits; source_erased is the point of
-- no return (no failed after it). One row per move — state history is the row
-- itself (state + state_changed_at + requested_by per step).
--
-- property_id FK is ON DELETE RESTRICT: move history is evidence and must
-- survive — a property with move rows cannot be hard-deleted.
-- denial_reason holds the content-free typed denial
-- (target_cell_not_approved | already_in_cell | property_missing |
-- region_unresolved); today denials are audited WITHOUT a machine row — the
-- column exists for denied rows written by future tooling.
-- error holds a content-free first line only (no stack, no payload).

CREATE TABLE IF NOT EXISTS "region_moves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "property_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "from_region" text NOT NULL,
  "to_region" text NOT NULL,
  "state" text NOT NULL,
  "denial_reason" text,
  "requested_by" varchar(255) NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "state_changed_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "error" text,
  CONSTRAINT "region_moves_property_fk"
    FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT,
  CONSTRAINT "region_moves_state_check"
    CHECK ("state" IN (
      'requested', 'writes_paused', 'queues_drained', 'data_copied', 'verified',
      'target_activated', 'source_erased', 'completed',
      'failed', 'rolling_back', 'rolled_back'
    ))
);

-- Active-move lookup per property (one in-flight move at a time) and the
-- operator move history per organization (newest first).
CREATE INDEX IF NOT EXISTS "region_moves_property_state_idx"
  ON "region_moves" ("property_id", "state");
CREATE INDEX IF NOT EXISTS "region_moves_org_requested_idx"
  ON "region_moves" ("organization_id", "requested_at" DESC);
