// BETA-1 B1.6: Google connection lifecycle state machine.
//
// Models connection health and lifecycle transitions:
//
//   pending → active → degraded → reauth_required → disconnecting → disconnected
//                    ↘ failed (permanent error)
//   active → disconnecting → disconnected
//   reauth_required → active (after successful re-auth)
//
// States:
// - pending:           OAuth flow started, account/location not yet verified
// - active:            Healthy, syncing reviews
// - degraded:          Token works but rate-limited, partially failing, or slow
// - reauth_required:   Token revoked or refresh failed; user must re-authenticate
// - disconnecting:     Disconnect workflow in progress (revoking tokens, stopping sync)
// - disconnected:      Terminal — tokens revoked, sync stopped, connection inert
// - failed:            Terminal — connection failed permanently (wrong account, scope mismatch)

export type ConnectionState =
  | 'pending'
  | 'active'
  | 'degraded'
  | 'reauth_required'
  | 'disconnecting'
  | 'disconnected'
  | 'failed'

/** Valid forward transitions. */
const VALID_TRANSITIONS: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  pending: ['active', 'failed'],
  active: ['degraded', 'reauth_required', 'disconnecting', 'failed'],
  degraded: ['active', 'reauth_required', 'disconnecting'],
  reauth_required: ['active', 'disconnecting', 'failed'],
  disconnecting: ['disconnected', 'failed'],
  disconnected: [], // terminal
  failed: [], // terminal
}

/** States that allow review sync and reply publish. */
export const SYNC_CAPABLE_STATES: ReadonlySet<ConnectionState> = new Set([
  'active',
  'degraded',
])

/** States that are terminal (no recovery possible). */
export const TERMINAL_STATES: ReadonlySet<ConnectionState> = new Set([
  'disconnected',
  'failed',
])

/** States that require user action (re-auth or operator intervention). */
export const ACTION_REQUIRED_STATES: ReadonlySet<ConnectionState> = new Set([
  'reauth_required',
  'failed',
])

export type ConnectionTransitionError = {
  code: 'invalid_transition'
  from: ConnectionState
  to: ConnectionState
}

/**
 * Check if a transition is valid.
 */
export function isValidConnectionTransition(
  from: ConnectionState,
  to: ConnectionState,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Assert that a transition is valid.
 */
export function assertValidConnectionTransition(
  from: ConnectionState,
  to: ConnectionState,
): void {
  if (!isValidConnectionTransition(from, to)) {
    throw { code: 'invalid_transition', from, to } as const
  }
}

/**
 * Check if the connection can sync reviews in its current state.
 */
export function canSync(state: ConnectionState): boolean {
  return SYNC_CAPABLE_STATES.has(state)
}

/**
 * Check if the connection is terminal (disconnected or failed).
 */
export function isConnectionTerminal(state: ConnectionState): boolean {
  return TERMINAL_STATES.has(state)
}

/**
 * Check if user action is required (re-authentication or operator intervention).
 */
export function isActionRequired(state: ConnectionState): boolean {
  return ACTION_REQUIRED_STATES.has(state)
}
