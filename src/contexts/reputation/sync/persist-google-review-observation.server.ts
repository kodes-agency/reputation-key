import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { ReviewFirstSeenVia } from '#/shared/domain/push-health'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import type { GoogleReviewRead } from '../../review/application/ports/google-review-api.port'
import type { ReviewProviderObservationWriter } from './sync-reviews.port.server'
import type { ReviewProviderSubjectSightings } from './review-provider-subject-link.port.server'
import type { ReviewProviderSubjectKeyService } from './provider-subject-keyring.server'

export type PersistGoogleReviewObservationDeps = Readonly<{
  observationWriter: ReviewProviderObservationWriter
  subjectKeyService: ReviewProviderSubjectKeyService
  /** Maps the stored review if no listing has mapped it yet. */
  subjectSightings: ReviewProviderSubjectSightings
}>

export type PersistGoogleReviewObservationInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  /** The Location the read was addressed to. */
  locationName: string
  /** The review exactly as the provider adapter mapped it. */
  review: GoogleReviewRead
  /** Content-free 64-hex digest of one logical read (replays are idempotent). */
  observationKey: string
  /** How this read reaches RepKey, for the push health ledger. */
  firstSeenVia: ReviewFirstSeenVia
  /** The Pub/Sub acceptance time of the push this read answers, if any. */
  pushAcceptedAt?: Date
}>

/**
 * Record one single-review Google read through the writer sync and push use:
 * the Review row, and the Google reply observation that goes with it. The tail
 * of every targeted read of one review, so the push fetch and the read before a
 * reply is published cannot drift apart.
 *
 * The read generation is allocated after the response, so concurrent reads are
 * ordered by the truth they actually received, not by when they started. A
 * stored review no listing has mapped yet gets its provider subject mapping,
 * so it is removed like a listed one once Google's deletion is confirmed.
 */
export async function persistGoogleReviewObservation(
  deps: PersistGoogleReviewObservationDeps,
  input: PersistGoogleReviewObservationInput,
): Promise<Awaited<ReturnType<ReviewProviderObservationWriter['persist']>>> {
  const resource = parseReviewProviderResource(input.review.reviewName)
  if (
    `accounts/${resource.accountId}/locations/${resource.locationId}` !==
    input.locationName
  ) {
    throw new TypeError('Targeted Google review resource mismatch')
  }
  const deriver = await deps.subjectKeyService.acquireDeriver()
  const subjects = deriver.deriveCandidates({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
    resourceName: input.review.reviewName,
  })
  const replyReadGeneration = await deps.observationWriter.allocateReplyReadGeneration()
  const persisted = await deps.observationWriter.persist({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    connectionId: input.connectionId,
    sourceEpoch: input.sourceEpoch,
    observationOrigin: 'ongoing',
    firstSeenVia: input.firstSeenVia,
    ...(input.pushAcceptedAt === undefined
      ? {}
      : { pushAcceptedAt: input.pushAcceptedAt }),
    observationKey: input.observationKey,
    replyReadGeneration,
    review: input.review,
    subjects,
  })
  await deps.subjectSightings.record({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
    reviewId: persisted.reviewId,
    sourceRevision: persisted.sourceRevision,
    subjects,
  })
  return persisted
}
