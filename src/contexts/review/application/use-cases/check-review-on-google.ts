import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { sha256Hex } from '#/shared/domain/sha256'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import type { Review } from '../../domain/types'
import {
  GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE,
  type GoogleReviewApiPort,
} from '../ports/google-review-api.port'
import type {
  PropertyGoogleReadBindingPort,
  ReviewPropertyGoogleReadBinding,
} from '../ports/property-google-read-binding.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-snapshot.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'

export type CheckReviewOnGoogleInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
}>

/** Why a review was not read at all: waiting will not change it. */
export type ReviewNotCheckableReason =
  /** Gone, erased, or with no provider identity left. */
  | 'review_unavailable'
  /** Its source content has expired; reading would re-hydrate erased content. */
  | 'content_expired'
  /** The review belongs to another Property. */
  | 'scope_mismatch'
  /** The Property is gone, not active, or holds no active Google binding. */
  | 'property_not_bound'
  /** Google reads are switched off for this Property. */
  | 'capability_off'
  /** This process has no Google provider. */
  | 'no_provider'
  /** The Property's binding changed while Google was being read. */
  | 'source_moved'

/** What one read of a review from Google came to. Content-free. */
export type CheckReviewOnGoogleResult =
  /** Read, and the observation (review and reply state) recorded. */
  | Readonly<{ status: 'read' }>
  /** Read and recorded, but the reply text could not be recovered: no reply state. */
  | Readonly<{ status: 'reply_unreadable' }>
  /** Google answered 404; a 404 is source-lifecycle evidence, not a deletion. */
  | Readonly<{ status: 'review_missing' }>
  | Readonly<{ status: 'not_checkable'; reason: ReviewNotCheckableReason }>
  /** The read or its write failed: `later` may work on another try, `never` will not. */
  | Readonly<{ status: 'unavailable'; retry: 'later' | 'never' }>

export type CheckReviewOnGoogleDeps = Readonly<{
  /** Receives the error class of an unexpected failure, never its text. */
  logger: Pick<LoggerPort, 'warn'>
  reviewRepo: Pick<ReviewRepository, 'findById'>
  googleReviewApi: Pick<GoogleReviewApiPort, 'getReview'>
  propertyBinding: PropertyGoogleReadBindingPort
  observationWriter: ReviewProviderObservationWriter
  subjectKeyService: ReviewProviderSubjectKeyService
  /** `property.connect_gbp` for this Property: the capability every Google review read runs under. */
  isGoogleReadEnabled: (
    scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ) => boolean
  /** A fresh value per read; the use case itself reads no randomness. */
  newObservationNonce: () => string
  clock: () => Date
}>

// Errors the authorizer (kill switch, suspension, grant, connection state)
// raises carry one of these codes; the adapter's own errors carry theirs.
const PERMANENT_AUTHORIZER_CODES: ReadonlySet<string> = new Set([
  'authorization_denied',
  'stale_source',
  'capability_killed',
])
const PERMANENT_API_CODES: ReadonlySet<string> = new Set([
  'authorization_changed',
  'reauthorization_required',
  'provider_rejected',
  'invalid_request',
  'malformed_response',
])

type FailureKind = 'no_provider' | 'permanent' | 'transient'

const errorCode = (error: unknown): string | null =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null

/**
 * Whether a failed read is worth another try. Rate limits, outages and
 * timeouts are; a refusal (the connection needs reauthorizing, the capability
 * is off, the provider rejected the request) is not, and neither is a
 * process with no provider. Anything unrecognised is treated as transient:
 * the caller bounds how long that may delay a reminder.
 */
const classifyFailure = (error: unknown): FailureKind => {
  const code = errorCode(error)
  if (code === GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE) return 'no_provider'
  if (
    code !== null &&
    (PERMANENT_AUTHORIZER_CODES.has(code) || PERMANENT_API_CODES.has(code))
  ) {
    return 'permanent'
  }
  return 'transient'
}

const notCheckable = (reason: ReviewNotCheckableReason): CheckReviewOnGoogleResult => ({
  status: 'not_checkable',
  reason,
})

const sameBinding = (
  a: ReviewPropertyGoogleReadBinding,
  b: ReviewPropertyGoogleReadBinding | null,
): boolean =>
  b !== null && a.sourceEpoch === b.sourceEpoch && a.connectionId === b.connectionId

/** The stored review, if it may be read from Google at all. */
const readableReview = async (
  deps: CheckReviewOnGoogleDeps,
  input: CheckReviewOnGoogleInput,
): Promise<Review | CheckReviewOnGoogleResult> => {
  const review = await deps.reviewRepo.findById(input.reviewId, input.organizationId)
  // `findById` answers null for a review whose content was erased.
  if (!review || !review.externalId || !review.externalLocationId) {
    return notCheckable('review_unavailable')
  }
  if (review.propertyId !== input.propertyId) return notCheckable('scope_mismatch')
  // The persist below would re-hydrate expired content; never from a reminder.
  if (
    review.contentExpiresAt !== null &&
    review.contentExpiresAt.getTime() <= deps.clock().getTime()
  ) {
    return notCheckable('content_expired')
  }
  return review
}

const isReview = (value: Review | CheckReviewOnGoogleResult): value is Review =>
  !('status' in value)

/**
 * Read one stored review from Google once and record what it shows, through
 * the same observation writer as a sync, so a reply written on Google closes
 * Inbox work along the normal event path.
 *
 * It needs no Reply and no push reference: the target comes from the stored
 * review, and the connection and epoch from the Property's CURRENT binding. It
 * never publishes, never reads erased or expired content, and never throws for
 * a provider or store failure; those come back as `unavailable`.
 */
export const checkReviewOnGoogle =
  (deps: CheckReviewOnGoogleDeps) =>
  async (input: CheckReviewOnGoogleInput): Promise<CheckReviewOnGoogleResult> => {
    try {
      return await run(deps, input)
    } catch (error) {
      // Only the class: an error message could carry review text or ids.
      deps.logger.warn(
        {
          stage: 'check_review_on_google',
          errorName: error instanceof Error ? error.name : 'non_error',
        },
        'Review check on Google ended in an unexpected error',
      )
      return { status: 'unavailable', retry: 'later' }
    }
  }

const run = async (
  deps: CheckReviewOnGoogleDeps,
  input: CheckReviewOnGoogleInput,
): Promise<CheckReviewOnGoogleResult> => {
  if (!deps.isGoogleReadEnabled(input)) return notCheckable('capability_off')
  const review = await readableReview(deps, input)
  if (!isReview(review)) return review
  const binding = await deps.propertyBinding.getBinding(
    input.organizationId,
    input.propertyId,
  )
  if (!binding || binding.connectionId === null) return notCheckable('property_not_bound')
  const connectionId = binding.connectionId

  let found
  try {
    found = await deps.googleReviewApi.getReview({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId,
      sourceEpoch: binding.sourceEpoch,
      locationName: review.externalLocationId,
      reviewName: `${review.externalLocationId}/reviews/${review.externalId}`,
    })
  } catch (error) {
    const kind = classifyFailure(error)
    if (kind === 'no_provider') return notCheckable('no_provider')
    return { status: 'unavailable', retry: kind === 'permanent' ? 'never' : 'later' }
  }
  if (found.status === 'not_found') return { status: 'review_missing' }

  const after = await deps.propertyBinding.getBinding(
    input.organizationId,
    input.propertyId,
  )
  if (!sameBinding(binding, after)) return notCheckable('source_moved')

  const resource = parseReviewProviderResource(found.review.reviewName)
  if (
    `accounts/${resource.accountId}/locations/${resource.locationId}` !==
    review.externalLocationId
  ) {
    return { status: 'unavailable', retry: 'never' }
  }
  const deriver = await deps.subjectKeyService.acquireDeriver()
  const subjects = deriver.deriveCandidates({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: binding.sourceEpoch,
    resourceName: found.review.reviewName,
  })
  const replyReadGeneration = await deps.observationWriter.allocateReplyReadGeneration()
  await deps.observationWriter.persist({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    connectionId,
    sourceEpoch: binding.sourceEpoch,
    observationOrigin: 'ongoing',
    observationKey: sha256Hex(
      `repkey-reminder-precheck-observation-v1\0${deps.newObservationNonce()}\0${found.review.reviewName}`,
    ),
    replyReadGeneration,
    review: found.review,
    subjects,
  })
  return found.review.replyUnreadable === true
    ? { status: 'reply_unreadable' }
    : { status: 'read' }
}

export type CheckReviewOnGoogle = ReturnType<typeof checkReviewOnGoogle>
