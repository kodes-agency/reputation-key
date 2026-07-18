// BQC-4.5 — region move workflow state machine (ADR 0048, phase BQC-4 §4.5).
//
// Models an operator-driven cross-cell property move as a durable machine:
//
//   requested → writes_paused → queues_drained → data_copied → verified →
//   target_activated → source_erased → completed
//                        ↘ failed → rolling_back → rolled_back
//
// Key invariants:
// - Exactly ONE authoritative cell at every state — never both, never neither
//   (authoritativeCellFor is the authority rule).
// - The source cell stays authoritative until target_activated commits the
//   source-of-truth swap (ONE guarded UPDATE on properties); at/after
//   target_activated the target is authoritative.
// - failed → rolling_back → rolled_back restores the source as the single
//   authority. Rollback after source_erasure is IMPOSSIBLE: source_erased is
//   the point of no return, so the table allows failed only BEFORE
//   source_erased — after it the only legal path is completed.
// - A failure/rollback never duplicates external effects: queues were paused
//   (jobs preserved, not dropped — BQC-0.4), rollback resumes them.
//
// Pure domain — no drizzle, no BullMQ. The persisted row (region_moves,
// migration 0016) carries the state; the application-layer stepper
// (advance-region-move) executes the per-state effects.
//
// Beta reality: 'us' is the ONLY approved cell, so every real move request
// resolves to a typed denial (request-region-move). The full lifecycle below
// is proven against a simulated approved target in the rehearsal test.

import { propertyError } from './errors'

/**
 * Region identifiers that can name a move target. 'unresolved' is the absence
 * of a region — never a target. Approval is a SEPARATE question (ADR 0048:
 * 'us' only for beta); a known-but-denied identifier denies
 * target_cell_not_approved, an unknown one denies region_unresolved.
 */
export const KNOWN_REGION_IDENTIFIERS: ReadonlySet<string> = new Set([
  'us',
  'europe',
  'global',
])

export type RegionMoveState =
  | 'requested' // operator request accepted — nothing paused yet
  | 'writes_paused' // property-scoped queues paused (jobs preserved)
  | 'queues_drained' // queue depths verified at zero
  | 'data_copied' // policy gate (real copy lands with the second cell — BQC-7)
  | 'verified' // policy gate (real verification lands with the second cell)
  | 'target_activated' // properties.processing_region swapped — target authoritative
  | 'source_erased' // point of no return (record-only while there is one cell)
  | 'completed' // terminal — the move finished
  | 'failed' // operator-recorded failure (before erasure only)
  | 'rolling_back' // queues resumed + source restored if activation had committed
  | 'rolled_back' // terminal — source is again the single authority

/**
 * Valid transitions. failed is reachable from every pre-erasure state and
 * deliberately NOT from source_erased: once the source copy is erased a
 * rollback could not restore a single authoritative cell.
 */
export const MOVE_TRANSITIONS: Readonly<
  Record<RegionMoveState, readonly RegionMoveState[]>
> = {
  requested: ['writes_paused', 'failed'],
  writes_paused: ['queues_drained', 'failed'],
  queues_drained: ['data_copied', 'failed'],
  data_copied: ['verified', 'failed'],
  verified: ['target_activated', 'failed'],
  target_activated: ['source_erased', 'failed'],
  // Point of no return — no failed after source_erased.
  source_erased: ['completed'],
  completed: [], // terminal
  failed: ['rolling_back'],
  rolling_back: ['rolled_back'],
  rolled_back: [], // terminal
}

const TERMINAL_MOVE_STATES: ReadonlySet<RegionMoveState> = new Set([
  'completed',
  'rolled_back',
])

/** Terminal states — no further transitions. */
export function isTerminalMoveState(state: RegionMoveState): boolean {
  return TERMINAL_MOVE_STATES.has(state)
}

/** Check if a transition is valid. Same-state is NOT a transition (the
 * stepper treats an already-there request as an idempotent no-op). */
export function isValidMoveTransition(
  from: RegionMoveState,
  to: RegionMoveState,
): boolean {
  return MOVE_TRANSITIONS[from].includes(to)
}

/**
 * Assert that a transition is valid.
 * Throws a tagged PropertyError — never an untagged { code } object.
 */
export function assertValidMoveTransition(
  from: RegionMoveState,
  to: RegionMoveState,
): void {
  if (!isValidMoveTransition(from, to)) {
    throw propertyError(
      'invalid_transition',
      `Invalid region move transition from "${from}" to "${to}"`,
      { from, to },
    )
  }
}

/**
 * The ONE authoritative cell for a state (ADR 0048 — a move must never leave
 * both or neither cell authoritative):
 *
 * - Before target_activated the SOURCE is authoritative: every read/write
 *   keeps executing against the source cell while the move prepares.
 * - At/after target_activated (incl. source_erased and completed) the TARGET
 *   is authoritative: the guarded properties UPDATE committed the swap.
 * - failed/rolling_back/rolled_back name the SOURCE as authoritative: the
 *   rollback path restores the source as the single authority. When a move
 *   fails AFTER target_activated, the properties row temporarily disagrees —
 *   rolling_back re-swaps it (guarded, idempotent) so rolled_back re-joins
 *   the declared authority.
 */
export function authoritativeCellFor(
  state: RegionMoveState,
  fromRegion: string,
  toRegion: string,
): string {
  switch (state) {
    case 'target_activated':
    case 'source_erased':
    case 'completed':
      return toRegion
    default:
      return fromRegion
  }
}

/**
 * One region move (the region_moves row, migration 0016). state_changed_at +
 * requested_by advance on EVERY step (the operator confirming the step is
 * recorded); requested_at is the immutable request timestamp. error holds a
 * content-free first line only; denial_reason holds the typed denial when a
 * denied request is ever persisted (today denials are audit-only, no row).
 */
export type RegionMoveRecord = Readonly<{
  id: string
  propertyId: string
  organizationId: string
  fromRegion: string
  toRegion: string
  state: RegionMoveState
  denialReason: string | null
  requestedBy: string
  requestedAt: Date
  stateChangedAt: Date
  completedAt: Date | null
  error: string | null
}>
