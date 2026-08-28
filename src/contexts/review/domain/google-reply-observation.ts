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

/** Pure authority for material provider-reply changes and RepKey attribution. */
export function decideGoogleReplyObservation(input: DecideGoogleReplyObservationInput) {
  const state = input.observedText === null ? ('absent' as const) : ('live' as const)
  const normalizedText =
    input.observedText === null ? null : normalizeGoogleReplyText(input.observedText)
  const normalizedDigest =
    input.observedText === null ? null : googleReplyTextDigest(input.observedText)
  const samePreviousScope =
    input.previous !== null &&
    input.previous.sourceEpoch === input.sourceEpoch &&
    input.previous.materialReviewRevision === input.materialReviewRevision

  const change = !samePreviousScope
    ? state === 'live'
      ? ('added' as const)
      : ('unchanged' as const)
    : input.previous!.state === 'live' && state === 'absent'
      ? ('deleted' as const)
      : input.previous!.state === 'absent' && state === 'live'
        ? ('added' as const)
        : state === 'live' && input.previous!.normalizedDigest !== normalizedDigest
          ? ('edited' as const)
          : ('unchanged' as const)

  const candidate = input.candidate
  const currentCandidate =
    candidate !== null &&
    candidate.sourceEpoch === input.sourceEpoch &&
    candidate.materialReviewRevision === input.materialReviewRevision &&
    CONFIRMABLE_ATTEMPT_OUTCOMES.has(candidate.outcome)
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
