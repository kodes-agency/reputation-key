// BETA-1 B1.5: Property lifecycle state machine.
//
// Replaces soft-delete with an explicit state machine:
//
//   active -> suspended -> archived -> disconnecting -> purge_pending -> purging -> purged
//                       \-> active (recovery, only before irreversible purge)
//
// Invariants:
// - Only 'active' properties can sync, publish replies, or accept new assignments.
// - 'suspended' blocks external effects but preserves data for recovery.
// - 'archived' blocks sync, publish, public surfaces, schedules, new jobs.
// - 'disconnecting' revokes Google access, stops reconciliation, resolves in-flight work.
// - 'purge_pending' is operator-confirmed; a grace period applies before purging.
// - 'purging' is the active deletion process; retryable by resource class.
// - 'purged' is terminal — no data remains; only evidence records.
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

/** All lifecycle states in order of progression. */
export const LIFECYCLE_STATES: readonly PropertyLifecycleState[] = [
  'active',
  'suspended',
  'archived',
  'disconnecting',
  'purge_pending',
  'purging',
  'purged',
] as const

/** Valid forward transitions. Recovery (backward) is allowed only before purge. */
const VALID_TRANSITIONS: Readonly<
  Record<PropertyLifecycleState, readonly PropertyLifecycleState[]>
> = {
  active: ['suspended'],
  suspended: ['active', 'archived'],
  archived: ['active', 'disconnecting'],
  disconnecting: ['archived', 'purge_pending'],
  purge_pending: ['archived', 'purging'], // recovery to archived during grace period
  purging: ['purged'], // irreversible — no backward
  purged: [], // terminal
}

/** States that allow external effects (sync, publish, notifications). */
export const ACTIVE_STATES: ReadonlySet<PropertyLifecycleState> = new Set(['active'])

/** States that preserve data (no external effects, but recovery is possible). */
export const RECOVERABLE_STATES: ReadonlySet<PropertyLifecycleState> = new Set([
  'suspended',
  'archived',
  'disconnecting',
  'purge_pending',
])

/** States where data has been or is being destroyed. */
export const IRREVERSIBLE_STATES: ReadonlySet<PropertyLifecycleState> = new Set([
  'purging',
  'purged',
])

/** States that block sync, publish, and external API calls. */
export const BLOCKED_STATES: ReadonlySet<PropertyLifecycleState> = new Set([
  'suspended',
  'archived',
  'disconnecting',
  'purge_pending',
  'purging',
  'purged',
])

export type LifecycleError =
  | {
      code: 'invalid_transition'
      from: PropertyLifecycleState
      to: PropertyLifecycleState
    }
  | { code: 'property_not_active'; state: PropertyLifecycleState }
  | { code: 'irreversible_state'; state: PropertyLifecycleState }

/**
 * Check if a transition is valid.
 * Recovery is allowed from suspended/archived/disconnecting/purge_pending back
 * to active (directly or through intermediate states). Purging and purged are
 * terminal — no backward transitions.
 */
export function isValidTransition(
  from: PropertyLifecycleState,
  to: PropertyLifecycleState,
): boolean {
  const allowed = VALID_TRANSITIONS[from]
  return allowed.includes(to)
}

/**
 * Assert that the property is in a state that allows external effects.
 * Throws on blocked states.
 */
export function assertCanPerformExternalEffect(state: PropertyLifecycleState): void {
  if (!ACTIVE_STATES.has(state)) {
    throw propertyError(
      'property_not_active',
      `Property cannot perform external effects in state "${state}"`,
      { state },
    )
  }
}

/**
 * Assert that a transition is valid.
 * Throws a tagged PropertyError on invalid transitions (BQR-1.2).
 */
export function assertValidTransition(
  from: PropertyLifecycleState,
  to: PropertyLifecycleState,
): void {
  if (!isValidTransition(from, to)) {
    throw propertyError(
      'invalid_transition',
      `Invalid property lifecycle transition from "${from}" to "${to}"`,
      { from, to },
    )
  }
}

/** Check if the property can be recovered (is not yet purged/purging). */
export function isRecoverable(state: PropertyLifecycleState): boolean {
  return RECOVERABLE_STATES.has(state)
}

/** Check if the property is terminal (purged). */
export function isTerminal(state: PropertyLifecycleState): boolean {
  return state === 'purged'
}

/**
 * Check if the property blocks external operations.
 * Suspended, archived, disconnecting, purge_pending, purging, and purged
 * all block sync, publish, notifications, and job creation.
 */
export function isBlocked(state: PropertyLifecycleState): boolean {
  return BLOCKED_STATES.has(state)
}

/**
 * Get the default state for a new property.
 */
export function initialState(): PropertyLifecycleState {
  return 'active'
}

/**
 * Get the severity weight for a lifecycle state.
 * Used for sorting and display priority.
 */
export function stateWeight(state: PropertyLifecycleState): number {
  return LIFECYCLE_STATES.indexOf(state)
}
