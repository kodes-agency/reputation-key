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

// ── BQC-3.8: persisted publication state machine ─────────────────────
//
// Migration 0015 persists the external-interaction overlay on replies
// (replies.publication_state). The persisted states map onto the saga
// states above:
//
//   persisted    saga                            meaning
//   requested    publish_requested               intent recorded (reserved —
//                                                approval writes 'authorized'
//                                                directly in the same tx)
//   authorized   publish_requested               manager authorized; a
//                                                publish job may claim the row
//   sending      publishing                      a worker claimed the row; the
//                                                Google call is in flight
//   published    published                       provider confirmed (terminal)
//   terminal     rejected_terminal /             provider rejected permanently
//                manual_review                   (terminal)
//   ambiguous    outcome_unknown                 the request may have landed;
//                                                reconcile before any new publish
//   cancelled    (none — BQC-3.8 addition)       cancelled by policy/disconnect
//                                                (terminal)
//
// The reply status (draft/approved/published/publish_failed) still tracks the
// local lifecycle; publication_state tracks the external interaction. Rows
// with no active workflow carry NULL (drafts, pre-0015 legacy rows).

export type PersistedPublicationState =
  | 'requested'
  | 'authorized'
  | 'sending'
  | 'published'
  | 'terminal'
  | 'ambiguous'
  | 'cancelled'

/** The current persisted state; NULL = no publication workflow active. */
export type PublicationStateInput = PersistedPublicationState | null

/** Events that drive persisted-state transitions (BQC-3.8). */
export type PublicationStateEvent =
  | 'authorize' // approval / retry re-authorization — a new publication cycle
  | 'claim' // publish job claims a row ('sending' → 'sending' = the SAME BullMQ
  //   job re-claiming its in-flight workflow after an ambiguous attempt;
  //   jobId idempotency serializes attempts, so no second worker can race this)
  | 'publish' // provider confirmed — local ack or reconciliation heal
  | 'fail_terminal' // classified terminal_rejection
  | 'fail_ambiguous' // classified ambiguous on the final attempt
  | 'requeue' // classified retryable — back to 'authorized' for the next attempt
  | 'cancel' // policy/disconnect cancellation

const PERSISTED_PUBLICATION_TRANSITIONS: Readonly<
  Record<
    PersistedPublicationState,
    Readonly<Partial<Record<PublicationStateEvent, PersistedPublicationState>>>
  >
> = {
  requested: { authorize: 'authorized', claim: 'sending', cancel: 'cancelled' },
  authorized: { claim: 'sending', cancel: 'cancelled' },
  sending: {
    claim: 'sending',
    publish: 'published',
    fail_terminal: 'terminal',
    fail_ambiguous: 'ambiguous',
    requeue: 'authorized',
    cancel: 'cancelled',
  },
  published: {},
  // publish from terminal/ambiguous is the reconciliation heal: the provider
  // shows the reply, so the honest local state is published (never a new send).
  terminal: { authorize: 'authorized', publish: 'published' },
  ambiguous: { authorize: 'authorized', publish: 'published' },
  // A cancelled reply returns to draft; a fresh approval cycle re-authorizes.
  cancelled: { authorize: 'authorized' },
}

/**
 * The single authority for persisted publication transitions (BQC-3.8).
 * Returns the next state, or null when the event does not apply to the
 * current state (the store treats null like a guard miss — no write, no fact).
 *
 * From NULL (no workflow): only 'authorize' (approval starts a cycle) and
 * 'publish' (legacy pre-0015 heal — provider confirmation is authoritative
 * from any state) are valid.
 */
export function nextPublicationState(
  current: PublicationStateInput,
  event: PublicationStateEvent,
): PersistedPublicationState | null {
  if (current === null) {
    if (event === 'authorize') return 'authorized'
    // Legacy rows (publication_state IS NULL) healed by reconciliation.
    if (event === 'publish') return 'published'
    return null
  }
  return PERSISTED_PUBLICATION_TRANSITIONS[current][event] ?? null
}

/**
 * Delay before an ambiguous publication becomes reconcile-due (BQC-3.8).
 * markPublicationAmbiguous sets reconcile_due_at = now + this delay; the
 * reconcile-ambiguous-publications sweep processes due rows. 15 minutes
 * gives the provider read path time to converge after an ambiguous send.
 */
export const AMBIGUOUS_RECONCILE_DELAY_MS = 15 * 60 * 1000

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
