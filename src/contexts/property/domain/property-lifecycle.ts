// BETA-1 B1.5: Property lifecycle state machine.
//
// Replaces soft-delete with an explicit state machine:
//
//   active -> archived -> disconnecting -> purge_pending -> purging -> purged
//      |         \-> active (ordinary recovery inside the recovery window)
//      \-> suspended -> archived
//
// Invariants:
// - Only 'active' properties can sync, publish replies, or accept new assignments.
// - 'suspended' blocks external effects but preserves data for recovery.
// - 'archived' blocks sync, publish, public surfaces, schedules, new jobs.
// - 'disconnecting' revokes Google access, stops reconciliation, resolves in-flight work.
// - 'purge_pending' is operator-confirmed; a grace period applies before purging.
// - 'purging' is the active deletion process; retryable by resource class.
// - 'purged' is terminal. The Property row stays as a tombstone so that the
//   evidence records naming it resolve; what the erase scrubs from it, and what
//   it still keeps, is stated in property-property-erase.adapter.ts.
//
// The irreversible boundary is purge_pending → purging. Before that, recovery
// to 'active' is possible. After purging starts, there is no rollback.

import { propertyError } from './errors'

export type PropertyLifecycleState =
  | 'active'
  | 'suspended'
  | 'archived'
  | 'disconnecting'
  | 'purge_pending'
  | 'purging'
  | 'purged'

/** Valid forward transitions. Recovery (backward) is allowed only before purge. */
const VALID_TRANSITIONS: Readonly<
  Record<PropertyLifecycleState, readonly PropertyLifecycleState[]>
> = {
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: ['active', 'disconnecting'],
  disconnecting: ['archived', 'purge_pending'],
  purge_pending: ['archived', 'purging'], // recovery to archived during grace period
  purging: ['purged'], // irreversible — no backward
  purged: [], // terminal
}

/** Ordinary beta Archive remains self-service recoverable for 30 days. */
export const PROPERTY_ARCHIVE_RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000

export const archiveRecoveryDeadline = (archivedAt: Date): Date =>
  new Date(archivedAt.getTime() + PROPERTY_ARCHIVE_RECOVERY_WINDOW_MS)

/**
 * Assert that a transition is valid.
 * Throws a tagged PropertyError on invalid transitions (BQR-1.2).
 */
export function assertValidTransition(
  from: PropertyLifecycleState,
  to: PropertyLifecycleState,
): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw propertyError(
      'invalid_transition',
      `Invalid property lifecycle transition from "${from}" to "${to}"`,
      { from, to },
    )
  }
}
