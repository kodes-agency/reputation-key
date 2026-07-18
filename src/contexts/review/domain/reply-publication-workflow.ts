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

import { reviewError } from './errors'

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
const TERMINAL_PUBLICATION_STATES: ReadonlySet<ReplyPublicationState> = new Set([
  'published',
  'rejected_terminal',
  'manual_review',
])

/** Active states — one publication workflow is in progress. */
const ACTIVE_PUBLICATION_STATES: ReadonlySet<ReplyPublicationState> = new Set([
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
 * Throws a tagged ReviewError (BQR-1.2) — never an untagged { code } object.
 */
export function assertValidPublicationTransition(
  from: ReplyPublicationState,
  to: ReplyPublicationState,
): void {
  if (!isValidPublicationTransition(from, to)) {
    throw reviewError(
      'invalid_transition',
      `Invalid reply publication transition from "${from}" to "${to}"`,
      { from, to },
    )
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

// ── BQC-3.3: provider outcome classification ─────────────────────────
//
// The publish job sends one PUT per attempt. What happened on Google after a
// failure determines whether retrying is safe, pointless, or dangerous:
//
//   terminal_rejection — Google answered 4xx (or the connection is gone).
//                        Retrying cannot succeed: mark publish_failed without
//                        burning BullMQ attempts.
//   retryable          — 429/5xx, token-refresh, or a pre-response network
//                        failure. Safe to retry: the GBP reply PUT is an
//                        UPSERT (one reply per review), so a retry can never
//                        create a duplicate Google-visible reply.
//   ambiguous          — timeout/abort or unknown error AFTER the request
//                        may have landed. The reply may exist on Google.
//                        Retry is still upsert-safe, but when attempts run
//                        out the honest state is publish_failed + reconcile
//                        (reconcileReplyPublication) before any new publish.

export type PublicationFailureClass = 'terminal_rejection' | 'retryable' | 'ambiguous'

/** Integration context codes that always fail BEFORE the reply PUT. */
const PRE_REQUEST_TERMINAL_CODES: ReadonlySet<string> = new Set([
  'connection_not_found',
  'connection_inactive',
  'connection_disconnected',
])

type IntegrationErrorShape = Readonly<{
  code: string
  context?: Readonly<Record<string, unknown>>
}>

/** Structural check — the domain must not import the integration context. */
function isIntegrationErrorShape(err: unknown): err is IntegrationErrorShape {
  return (
    typeof err === 'object' &&
    err !== null &&
    '_tag' in err &&
    (err as { _tag?: unknown })._tag === 'IntegrationError' &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
  )
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  )
}

function classifyGbpApiError(context: unknown): PublicationFailureClass {
  const status =
    typeof context === 'object' && context !== null && 'status' in context
      ? (context as { status?: unknown }).status
      : undefined
  if (typeof status !== 'number') return 'ambiguous'
  if (status >= 400 && status < 500) return 'terminal_rejection'
  if (status >= 500) return 'retryable'
  return 'ambiguous'
}

/**
 * Classify a provider failure from the publish attempt. See the table above.
 * Structural inspection only — no integration-context imports.
 */
export function classifyPublicationFailure(err: unknown): PublicationFailureClass {
  // Timeout/abort: the PUT may have landed — outcome is honestly unknown.
  if (isAbortError(err)) return 'ambiguous'
  if (!isIntegrationErrorShape(err)) {
    // fetch network failures (TypeError) surface before a response arrives.
    return err instanceof TypeError ? 'retryable' : 'ambiguous'
  }
  if (err.code === 'gbp_api_rate_limited') return 'retryable'
  if (err.code === 'gbp_api_error') return classifyGbpApiError(err.context)
  // Token refresh failure happens before the PUT and is transient.
  if (err.code === 'token_refresh_failed') return 'retryable'
  if (PRE_REQUEST_TERMINAL_CODES.has(err.code)) return 'terminal_rejection'
  return 'ambiguous'
}
