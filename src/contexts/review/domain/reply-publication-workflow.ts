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

/** Valid transitions. Exported (read-only) as the declared oracle for the BQC-6.9 property tests. */
export const VALID_PUBLICATION_TRANSITIONS: Readonly<
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
 * Format: reply-{replyId}-v{publicationCycle}. BullMQ custom IDs avoid `:`;
 * that separator is reserved by the queue's key format.
 * Each manager authorization, edit-and-republish, or explicit retry advances
 * the durable cycle even when the reply text is unchanged.
 */
export function buildIdempotencyKey(replyId: string, publicationCycle: number): string {
  return `reply-${replyId}-v${publicationCycle}`
}

/** Advance one durable publication authorization generation. */
export function nextPublicationCycle(current: number): number {
  if (
    !Number.isSafeInteger(current) ||
    current < 0 ||
    current >= Number.MAX_SAFE_INTEGER
  ) {
    throw reviewError('invalid_transition', 'Reply publication cycle is invalid', {
      current,
    })
  }
  return current + 1
}

// ── BQC-3.3: provider outcome classification ─────────────────────────
//
// The publish job sends at most one PUT per attempt. What happened on Google
// after a failure determines whether retrying is safe, pointless, or dangerous:
//
//   terminal_rejection — Google answered 4xx (not 429), the connection or
//                        authorization is gone, or RepKey itself refused the
//                        request before sending it (invalid input, or the
//                        executor's compile step said `malformed_request`).
//                        Retrying cannot succeed: mark publish_failed without
//                        burning BullMQ attempts.
//   retryable          — a failure the provider plane recorded as `not_sent`
//                        (the gateway returned before `fetch`), token refresh,
//                        or a 429 rate-limit answer. The next attempt may send.
//   ambiguous          — `unknown` dispatch (fetch threw or aborted), 5xx,
//                        timeout/abort, or no dispatch evidence at all. The
//                        reply may exist on Google; preserve `sending` so the
//                        next attempt performs a targeted read before any
//                        repeat write.
//
// Order (D2): abort → pre-request codes → `not_sent` → `answered` status →
// rate-limit code → ambiguous. Dispatch evidence comes from the gateway, never
// from the absence of a reply on a Google read.

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
//   pending_observation provider_outcome_pending Google accepted the write,
//                                                but no provider read has yet
//                                                proved the current live text
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
  | 'pending_observation'
  | 'published'
  | 'terminal'
  | 'ambiguous'
  | 'cancelled'

/** The current persisted state; NULL = no publication workflow active. */
export type PublicationStateInput = PersistedPublicationState | null

/** Events that drive persisted-state transitions (BQC-3.8). */
export type PublicationStateEvent =
  | 'authorize' // approval / retry re-authorization — a new publication cycle
  | 'claim' // a fresh authorization grants exactly one provider-write attempt
  | 'provider_accepted' // write response persisted; provider read still required
  | 'publish' // exact current provider observation confirmed
  | 'fail_terminal' // classified terminal_rejection
  | 'fail_ambiguous' // uncertain write/read outcome awaiting bounded reconciliation
  | 'requeue' // classified retryable — back to 'authorized' for the next attempt
  | 'cancel' // policy/disconnect cancellation

// Exported (read-only) as the declared oracle for the BQC-6.9 property tests.
export const PERSISTED_PUBLICATION_TRANSITIONS: Readonly<
  Record<
    PersistedPublicationState,
    Readonly<Partial<Record<PublicationStateEvent, PersistedPublicationState>>>
  >
> = {
  requested: {
    authorize: 'authorized',
    fail_terminal: 'terminal',
    cancel: 'cancelled',
  },
  authorized: { claim: 'sending', fail_terminal: 'terminal', cancel: 'cancelled' },
  sending: {
    provider_accepted: 'pending_observation',
    fail_terminal: 'terminal',
    fail_ambiguous: 'ambiguous',
    requeue: 'authorized',
    cancel: 'cancelled',
  },
  pending_observation: {
    publish: 'published',
    fail_ambiguous: 'ambiguous',
    cancel: 'cancelled',
  },
  published: {},
  // publish from terminal/ambiguous is the reconciliation heal: the provider
  // shows the reply, so the honest local state is published (never a new send).
  terminal: { authorize: 'authorized', publish: 'published' },
  ambiguous: { authorize: 'authorized', publish: 'published', fail_terminal: 'terminal' },
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
 * Default delay before an ambiguous publication becomes reconcile-due
 * (BQC-3.8), used by markPublicationAmbiguous when the caller passes no
 * ladder time. Measured from now, it is never earlier than the ladder's first
 * rung (fifteen minutes from an attempt start that is at or before now).
 */
export const AMBIGUOUS_RECONCILE_DELAY_MS = 15 * 60 * 1000

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/**
 * D3: a send whose outcome is unknown (no success response was persisted and
 * no dispatch evidence says it stayed local) gets the same fifteen-minute
 * propagation window as an accepted write before RepKey calls it ambiguous.
 * Incident b129e390 was declared ambiguous 30 s after approval on ONE absent
 * read, well inside the window in which Google may not echo a reply yet.
 */
export const UNCERTAIN_SEND_PROPAGATION_GRACE_MS = 15 * MINUTE_MS

/** Earliest next read while an uncertain send waits, and the floor for every
 * ladder rung, so a check landing just before a rung never re-reads at once. */
export const UNCERTAIN_SEND_RECHECK_DELAY_MS = MINUTE_MS

/**
 * D3: when an ambiguous publication is read again, as offsets from the
 * attempt's durable start (reply_publication_attempts.created_at). Every read
 * is read-only toward Google. Past the last rung automatic checks stop and the
 * row becomes terminal ambiguity; one absent read never ends the ladder.
 */
export const AMBIGUOUS_RECONCILE_LADDER_MS: readonly number[] = Object.freeze([
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  2 * HOUR_MS,
  4 * HOUR_MS,
  8 * HOUR_MS,
  24 * HOUR_MS,
  48 * HOUR_MS,
  72 * HOUR_MS,
])

type AttemptClock = Readonly<{ attemptStartedAt: Date; now: Date }>

/**
 * True while an uncertain send is inside the propagation grace. A start after
 * now, or an unreadable time, fails closed to the ambiguity path, as
 * canDeferPendingProviderObservation does.
 */
export function canDeferUncertainSend(input: AttemptClock): boolean {
  const ageMs = input.now.getTime() - input.attemptStartedAt.getTime()
  return (
    Number.isFinite(ageMs) && ageMs >= 0 && ageMs < UNCERTAIN_SEND_PROPAGATION_GRACE_MS
  )
}

/**
 * The next ladder read for an ambiguous publication: the first rung strictly
 * after the attempt's current age, never sooner than now + one minute. Null
 * once the attempt is 72 hours old (or its times are unreadable), which is the
 * only way the ladder ends. A start after now anchors the ladder at now, so
 * clock disagreement can only bring a read closer, never push it past 72 hours.
 */
export function nextAmbiguousReconcileDueAt(input: AttemptClock): Date | null {
  const nowMs = input.now.getTime()
  const startMs = Math.min(input.attemptStartedAt.getTime(), nowMs)
  if (!Number.isFinite(nowMs) || !Number.isFinite(startMs)) return null
  const ageMs = nowMs - startMs
  const rung = AMBIGUOUS_RECONCILE_LADDER_MS.find((offsetMs) => offsetMs > ageMs)
  if (rung === undefined) return null
  return new Date(Math.max(startMs + rung, nowMs + UNCERTAIN_SEND_RECHECK_DELAY_MS))
}

/** A successful write response still needs a provider read after a short
 * convergence window before it can become published. */
export const PROVIDER_OBSERVATION_RECONCILE_DELAY_MS = 60 * 1000

/** Google can accept a reply several minutes before getReview exposes it.
 * Fifteen minutes gives the measured sub-ten-minute propagation lag one full
 * five-minute sweep interval of margin. */
export const PROVIDER_OBSERVATION_PROPAGATION_GRACE_MS = 15 * 60 * 1000

/** At the registered five-minute sweep cadence, three absent observations can
 * be re-deferred inside the propagation window. The fourth takes the existing
 * ambiguity path even if wall-clock age is still inside the window. */
export const PROVIDER_OBSERVATION_PROPAGATION_GRACE_MAX_READS = 3

/** Fail closed to ambiguity unless both independent propagation bounds hold. */
export function canDeferPendingProviderObservation(
  input: Readonly<{
    attemptStartedAt: Date
    now: Date
    absentObservationCount: number
  }>,
): boolean {
  const ageMs = input.now.getTime() - input.attemptStartedAt.getTime()
  return (
    Number.isFinite(ageMs) &&
    ageMs >= 0 &&
    ageMs < PROVIDER_OBSERVATION_PROPAGATION_GRACE_MS &&
    Number.isSafeInteger(input.absentObservationCount) &&
    input.absentObservationCount >= 1 &&
    input.absentObservationCount <= PROVIDER_OBSERVATION_PROPAGATION_GRACE_MAX_READS
  )
}

/**
 * D6: Google acknowledged the write but echoes a reply RepKey cannot read (a
 * translation-only envelope, or the text with only whitespace reformatted). The
 * read records no observation, so the absent-read cap above cannot count it;
 * the propagation window alone bounds the wait. Without this the first such
 * read ended the grace, where the same echo read as absent before D6 did not.
 */
export function canDeferUnreadablePendingObservation(input: AttemptClock): boolean {
  const ageMs = input.now.getTime() - input.attemptStartedAt.getTime()
  return (
    Number.isFinite(ageMs) &&
    ageMs >= 0 &&
    ageMs < PROVIDER_OBSERVATION_PROPAGATION_GRACE_MS
  )
}

/** Backstop for a publication whose queue/worker owner disappears. The five
 * 120-second publish attempts plus the catalogue's 30/60/120/240-second
 * backoffs fit inside 17.5 minutes; 20 minutes keeps healthy work ahead of the
 * recurring five-minute reconciliation sweep while bounding abandoned rows. */
export const PUBLICATION_RECOVERY_RECONCILE_DELAY_MS = 20 * 60 * 1000

/** Integration context codes that always fail BEFORE the reply PUT. */
const PRE_REQUEST_TERMINAL_CODES: ReadonlySet<string> = new Set([
  'connection_not_found',
  'connection_inactive',
  'connection_disconnected',
  // A provider or admission REFUSAL (401/403, revoked grant, changed approval
  // binding). Retrying cannot turn a refusal into an acceptance, and treating
  // it as an unknown outcome left the reply 'sending' until every attempt was
  // spent instead of reporting the permission problem.
  'authorization_changed',
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

/** Structural check for the Review provider port's own error shape. It carries
 * a closed code and was previously invisible to this classifier, so every
 * refusal and every rate limit raised through the port read as ambiguous. */
function isReviewApiErrorShape(err: unknown): err is Readonly<{ code: string }> {
  return (
    typeof err === 'object' &&
    err !== null &&
    '_tag' in err &&
    (err as { _tag?: unknown })._tag === 'GoogleReviewApiError' &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
  )
}

type GbpApiErrorShape = Readonly<{
  kind:
    | 'auth_failed'
    | 'rate_limited'
    | 'permission_denied'
    | 'upstream_error'
    | 'parse_error'
}>

/** Structural check — the review domain must not import the integration context. */
function isGbpApiErrorShape(err: unknown): err is GbpApiErrorShape {
  if (
    typeof err !== 'object' ||
    err === null ||
    !('_tag' in err) ||
    (err as { _tag?: unknown })._tag !== 'GbpApiError' ||
    !('kind' in err)
  ) {
    return false
  }
  const kind = (err as { kind?: unknown }).kind
  return (
    kind === 'auth_failed' ||
    kind === 'rate_limited' ||
    kind === 'permission_denied' ||
    kind === 'upstream_error' ||
    kind === 'parse_error'
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
  if (status >= 500) return 'ambiguous'
  return 'ambiguous'
}

/** Mirrors the gateway's `GoogleProviderDispatch`; the domain may not import it. */
export type PublicationFailureDispatch = 'not_sent' | 'answered' | 'unknown'

/**
 * What the provider plane recorded about one failed attempt. Codes and a
 * status only, so the publish job can log it and BullMQ can keep it.
 */
export type PublicationFailureEvidence = Readonly<{
  executionCode: string | null
  dispatch: PublicationFailureDispatch
  providerStatus: number | null
}>

const NO_EVIDENCE: PublicationFailureEvidence = Object.freeze({
  executionCode: null,
  dispatch: 'unknown',
  providerStatus: null,
})

function readDispatch(value: unknown): PublicationFailureDispatch {
  return value === 'not_sent' || value === 'answered' ? value : 'unknown'
}

function readCode(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined
}

/**
 * Structural read of the dispatch evidence on either provider error shape: the
 * review port's `failure` record, or the gateway GbpApiError's own fields
 * (where the admission code is the more specific of its two codes).
 */
export function publicationFailureEvidence(err: unknown): PublicationFailureEvidence {
  if (isReviewApiErrorShape(err)) {
    const failure = fieldOf(err, 'failure')
    if (typeof failure !== 'object' || failure === null) return NO_EVIDENCE
    return {
      executionCode: readCode(fieldOf(failure, 'executionCode')),
      dispatch: readDispatch(fieldOf(failure, 'dispatch')),
      providerStatus: readStatus(fieldOf(failure, 'providerStatus')),
    }
  }
  if (isGbpApiErrorShape(err)) {
    return {
      executionCode:
        readCode(fieldOf(err, 'executionAdmissionCode')) ??
        readCode(fieldOf(err, 'executionCode')),
      dispatch: readDispatch(fieldOf(err, 'dispatch')),
      providerStatus: readStatus(fieldOf(err, 'providerStatus')),
    }
  }
  return NO_EVIDENCE
}

/**
 * D2 rules 3-4. Null means the evidence decides nothing and the caller's
 * code-based rules apply. Only `not_sent` (the gateway returned before
 * `fetch`) may make a failure retryable; absence on a Google read never can.
 */
function classifyByDispatch(
  evidence: PublicationFailureEvidence,
): PublicationFailureClass | null {
  if (evidence.dispatch === 'not_sent') {
    // A compile refusal is a pure function of the reply: resending the same
    // descriptor is refused the same way, so retries would only burn attempts.
    return evidence.executionCode === 'malformed_request'
      ? 'terminal_rejection'
      : 'retryable'
  }
  if (evidence.dispatch === 'answered') {
    const status = evidence.providerStatus
    if (status === 429) return 'retryable'
    if (status !== null && status >= 400 && status < 500) return 'terminal_rejection'
    return 'ambiguous'
  }
  return null
}

function classifyGatewayError(err: GbpApiErrorShape): PublicationFailureClass {
  // A refusal stays terminal before the dispatch rules, as
  // `authorization_changed` does for the review port (rule 2): retrying a
  // permission decision cannot turn it into an acceptance.
  if (err.kind === 'auth_failed' || err.kind === 'permission_denied') {
    return 'terminal_rejection'
  }
  const byDispatch = classifyByDispatch(publicationFailureEvidence(err))
  if (byDispatch) return byDispatch
  if (err.kind === 'rate_limited') return 'retryable'
  return 'ambiguous'
}

function classifyReviewApiError(
  err: Readonly<{ code: string }>,
): PublicationFailureClass {
  if (PRE_REQUEST_TERMINAL_CODES.has(err.code) || err.code === 'invalid_request') {
    return 'terminal_rejection'
  }
  const byDispatch = classifyByDispatch(publicationFailureEvidence(err))
  if (byDispatch) return byDispatch
  if (err.code === 'provider_rate_limited') return 'retryable'
  return 'ambiguous'
}

/**
 * Classify a provider failure from the publish attempt. See the table above.
 * Structural inspection only — no integration-context imports.
 */
export function classifyPublicationFailure(err: unknown): PublicationFailureClass {
  // Timeout/abort: the PUT may have landed — outcome is honestly unknown.
  if (isAbortError(err)) return 'ambiguous'
  if (isGbpApiErrorShape(err)) return classifyGatewayError(err)
  if (isReviewApiErrorShape(err)) return classifyReviewApiError(err)
  if (!isIntegrationErrorShape(err)) {
    // A transport rejection provides no evidence that the provider did not
    // accept the PUT. Conservatively preserve the uncertain in-flight state.
    return 'ambiguous'
  }
  if (err.code === 'gbp_api_rate_limited') return 'retryable'
  if (err.code === 'gbp_api_error') return classifyGbpApiError(err.context)
  // Token refresh failure happens before the PUT and is transient.
  if (err.code === 'token_refresh_failed') return 'retryable'
  if (PRE_REQUEST_TERMINAL_CODES.has(err.code)) return 'terminal_rejection'
  return 'ambiguous'
}
