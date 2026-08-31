import { sha256Hex } from '#/shared/domain/sha256'
import {
  GOOGLE_REPLY_NORMALIZATION_VERSION,
  googleReplyTextDigest,
  normalizeGoogleReplyText,
} from '#/shared/domain/google-reply-text'
import type { ReplyId } from '#/shared/domain/ids'

export {
  GOOGLE_REPLY_NORMALIZATION_VERSION,
  googleReplyTextDigest,
  normalizeGoogleReplyText,
} from '#/shared/domain/google-reply-text'

/**
 * Frozen normalization used to compare manager-authorized text with the
 * provider's current reply. Changing these rules requires a new version; old
 * attempt and observation evidence must remain interpretable.
 */
export type GoogleReplyObservationInputIdentity = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  materialReviewRevision: number
  source: 'provider_snapshot' | 'targeted_reconciliation'
  observedText: string | null
  providerUpdatedAt: Date | null
  publicationTarget?: Readonly<{
    replyId: string
    publicationCycle: number
    attemptNumber: number
  }>
}>

/** Content-free replay binding for an observation command. Local receipt and
 * expiry clocks are intentionally excluded: replaying the same provider fact
 * may happen later, but changing its scope/content/provider timestamp may not
 * reuse the idempotency key. */
export function googleReplyObservationInputDigest(
  input: GoogleReplyObservationInputIdentity,
): string {
  return sha256Hex(
    [
      'google-reply-observation-input-v1',
      input.organizationId,
      input.propertyId,
      input.reviewId,
      String(input.sourceEpoch),
      String(input.materialReviewRevision),
      input.source,
      input.observedText === null
        ? 'absent'
        : `live:${googleReplyTextDigest(input.observedText)}`,
      input.providerUpdatedAt?.toISOString() ?? 'provider-time-absent',
      input.publicationTarget
        ? `target:${input.publicationTarget.replyId}:${String(input.publicationTarget.publicationCycle)}:${String(input.publicationTarget.attemptNumber)}`
        : 'target:none',
    ].join('\0'),
  )
}

export function compareObservedGoogleReply(desired: string, observed: string) {
  const desiredDigest = googleReplyTextDigest(desired)
  const observedDigest = googleReplyTextDigest(observed)
  return Object.freeze({
    matches: desiredDigest === observedDigest,
    normalizationVersion: GOOGLE_REPLY_NORMALIZATION_VERSION,
    desiredDigest,
    observedDigest,
  })
}

export type PreviousGoogleReplyObservation = Readonly<{
  state: 'live' | 'absent'
  normalizedDigest: string | null
  sourceEpoch: number
  materialReviewRevision: number
}>

export type GoogleReplyPublicationCandidate = Readonly<{
  replyId: ReplyId
  publicationCycle: number
  attemptNumber: number
  sourceEpoch: number
  materialReviewRevision: number
  expectedReplyDigest: string
  outcome:
    | 'sending'
    | 'provider_outcome_pending'
    | 'retryable_failure'
    | 'ambiguous'
    | 'terminal_rejection'
    | 'confirmed'
    | 'superseded'
}>

type DecideGoogleReplyObservationInput = Readonly<{
  sourceEpoch: number
  materialReviewRevision: number
  observedText: string | null
  previous: PreviousGoogleReplyObservation | null
  candidate: GoogleReplyPublicationCandidate | null
}>

const CONFIRMABLE_ATTEMPT_OUTCOMES: ReadonlySet<
  GoogleReplyPublicationCandidate['outcome']
> = new Set(['sending', 'provider_outcome_pending', 'ambiguous'])

type ObservedGoogleReplyState = Readonly<{
  state: 'live' | 'absent'
  normalizedText: string | null
  normalizedDigest: string | null
}>

/** Absent provider text has no normalization; live text is normalized once and
 * digested under the frozen normalization version. */
function describeObservedText(observedText: string | null): ObservedGoogleReplyState {
  if (observedText === null) {
    return { state: 'absent', normalizedText: null, normalizedDigest: null }
  }
  return {
    state: 'live',
    normalizedText: normalizeGoogleReplyText(observedText),
    normalizedDigest: googleReplyTextDigest(observedText),
  }
}

type ObservationScope = Readonly<{ sourceEpoch: number; materialReviewRevision: number }>

/** Material change against the previous head. A head recorded under a different
 * source scope cannot witness an edit or a deletion, so live text there reads as
 * newly added and absence as no change. */
function decideObservationChange(
  observed: ObservedGoogleReplyState,
  previous: PreviousGoogleReplyObservation | null,
  scope: ObservationScope,
): 'added' | 'deleted' | 'edited' | 'unchanged' {
  const outOfScope =
    previous === null ||
    previous.sourceEpoch !== scope.sourceEpoch ||
    previous.materialReviewRevision !== scope.materialReviewRevision
  if (outOfScope) return observed.state === 'live' ? 'added' : 'unchanged'
  if (previous.state === 'live' && observed.state === 'absent') return 'deleted'
  if (previous.state === 'absent' && observed.state === 'live') return 'added'
  if (
    observed.state === 'live' &&
    previous.normalizedDigest !== observed.normalizedDigest
  ) {
    return 'edited'
  }
  return 'unchanged'
}

/** A RepKey attempt is still attributable only while it belongs to the observed
 * source scope and has not yet reached a settled outcome. */
function isConfirmableCurrentAttempt(
  candidate: GoogleReplyPublicationCandidate,
  scope: ObservationScope,
): boolean {
  return (
    candidate.sourceEpoch === scope.sourceEpoch &&
    candidate.materialReviewRevision === scope.materialReviewRevision &&
    CONFIRMABLE_ATTEMPT_OUTCOMES.has(candidate.outcome)
  )
}

/** Pure authority for material provider-reply changes and RepKey attribution. */
export function decideGoogleReplyObservation(input: DecideGoogleReplyObservationInput) {
  const observed = describeObservedText(input.observedText)
  const { state, normalizedText, normalizedDigest } = observed
  const change = decideObservationChange(observed, input.previous, input)

  const candidate = input.candidate
  const currentCandidate =
    candidate !== null && isConfirmableCurrentAttempt(candidate, input)
  const exactCurrentCandidate =
    state === 'live' &&
    candidate !== null &&
    currentCandidate &&
    candidate.expectedReplyDigest === normalizedDigest

  if (exactCurrentCandidate) {
    return Object.freeze({
      state,
      change,
      resolution: 'confirmed_on_google' as const,
      provenance: 'repkey_confirmed' as const,
      normalizedText,
      normalizedDigest,
      matchedReplyId: candidate.replyId,
      matchedPublicationCycle: candidate.publicationCycle,
      matchedAttemptNumber: candidate.attemptNumber,
    })
  }

  if (state === 'absent') {
    return Object.freeze({
      state,
      change,
      resolution: change === 'deleted' ? ('absent' as const) : ('unchanged' as const),
      provenance: 'none' as const,
      normalizedText,
      normalizedDigest,
      matchedReplyId: null,
      matchedPublicationCycle: null,
      matchedAttemptNumber: null,
    })
  }

  if (currentCandidate) {
    return Object.freeze({
      state,
      change,
      resolution: 'external_current_live' as const,
      provenance: 'external_or_unknown' as const,
      normalizedText,
      normalizedDigest,
      matchedReplyId: null,
      matchedPublicationCycle: null,
      matchedAttemptNumber: null,
    })
  }

  const resolution =
    change === 'unchanged' ? ('unchanged' as const) : ('external_current_live' as const)
  return Object.freeze({
    state,
    change,
    resolution,
    provenance: 'external_or_unknown' as const,
    normalizedText,
    normalizedDigest,
    matchedReplyId: null,
    matchedPublicationCycle: null,
    matchedAttemptNumber: null,
  })
}
