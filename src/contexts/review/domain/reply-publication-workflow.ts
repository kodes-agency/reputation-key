// BETA-1 B1.10: Reply publication saga state machine.
//
// Models the external Google reply publication as a durable workflow:
//
//   draft → publish_requested → publishing → published
//                                         ↘ rejected_terminal
//                                         ↘ outcome_unknown → reconciling → published | retryable | manual_review
//
// Key invariants:
// - Only ONE active publication workflow per review at any time
// - The saga separates local draft state from provider-published state
// - Crash at any boundary yields at most ONE Google-visible reply
// - "outcome_unknown" is the dangerous state: API call may or may not have
//   succeeded. Reconciliation (re-checking Google) is required before retry.
// - "manual_review" is terminal — requires operator intervention
//
// This type models the publication workflow overlay. The reply's own status
// (draft/approved/published) tracks the local lifecycle. This type tracks
// the external interaction.

export type ReplyPublicationState =
  | 'idle' // no publication workflow active
  | 'publish_requested' // manager approved, outbox intent recorded
  | 'publishing' // Google API call in flight
  | 'published' // terminal — Google confirmed success
  | 'rejected_terminal' // terminal — Google returned a permanent error (e.g., 403)
  | 'outcome_unknown' // crash/timeout — API result unclear
  | 'reconciling' // checking Google to determine actual outcome
  | 'retryable' // transient failure (e.g., 429, 5xx) — safe to retry
  | 'manual_review' // terminal — operator must intervene

/** Terminal states — no further automatic transitions. */
export const TERMINAL_PUBLICATION_STATES: ReadonlySet<ReplyPublicationState> = new Set([
  'published',
  'rejected_terminal',
  'manual_review',
])

/** Active states — one publication workflow is in progress. */
export const ACTIVE_PUBLICATION_STATES: ReadonlySet<ReplyPublicationState> = new Set([
  'publish_requested',
  'publishing',
  'outcome_unknown',
  'reconciling',
  'retryable',
])

/** Valid transitions. */
const VALID_PUBLICATION_TRANSITIONS: Readonly<
  Record<ReplyPublicationState, readonly ReplyPublicationState[]>
> = {
  idle: ['publish_requested'],
  publish_requested: ['publishing', 'rejected_terminal'],
  publishing: ['published', 'rejected_terminal', 'outcome_unknown'],
  outcome_unknown: ['reconciling'],
  reconciling: ['published', 'retryable', 'manual_review'],
  retryable: ['publishing', 'manual_review'],
  published: [], // terminal
  rejected_terminal: [], // terminal
  manual_review: [], // terminal
}

/**
 * Check if a transition is valid.
 */
export function isValidPublicationTransition(
  from: ReplyPublicationState,
  to: ReplyPublicationState,
): boolean {
  return VALID_PUBLICATION_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Assert that a transition is valid.
 */
export function assertValidPublicationTransition(
  from: ReplyPublicationState,
  to: ReplyPublicationState,
): void {
  if (!isValidPublicationTransition(from, to)) {
    throw { code: 'invalid_publication_transition', from, to } as const
  }
}

/**
 * Check if the publication workflow is active (in progress).
 */
export function isPublicationActive(state: ReplyPublicationState): boolean {
  return ACTIVE_PUBLICATION_STATES.has(state)
}

/**
 * Check if the publication workflow is terminal.
 */
export function isPublicationTerminal(state: ReplyPublicationState): boolean {
  return TERMINAL_PUBLICATION_STATES.has(state)
}

/**
 * Check if the publication succeeded (Google confirmed).
 */
export function isPublished(state: ReplyPublicationState): boolean {
  return state === 'published'
}

/**
 * Check if operator intervention is required.
 */
export function requiresManualReview(state: ReplyPublicationState): boolean {
  return state === 'manual_review' || state === 'outcome_unknown'
}

/**
 * Get the idempotency key for a reply publication.
 * This key ensures that retrying a crashed publication doesn't create
 * a duplicate reply on Google.
 *
 * Format: reply:{replyId}:{sourceVersion}
 * The sourceVersion changes if the reply text is edited, starting a new
 * publication workflow.
 */
export function buildIdempotencyKey(replyId: string, sourceVersion: number): string {
  return `reply:${replyId}:v${sourceVersion}`
}
