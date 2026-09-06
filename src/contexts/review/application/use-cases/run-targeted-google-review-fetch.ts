import type {
  GoogleConnectionId,
  OrganizationId,
  PropertyId,
  ReviewId,
} from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { PropertySourceEpochPort } from '../ports/property-source-epoch.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-snapshot.repository'
import type { ReviewSyncActivityRecorder } from '../ports/review-sync-activity.port'
import type { TargetedGoogleReviewReferenceResolver } from '../ports/targeted-google-review-reference.port'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'

export type RunTargetedGoogleReviewFetchInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  referenceRef: string | null
  /** Durable outbox event identity; makes observation replay idempotent. */
  deliveryId: string
}>

export type RunTargetedGoogleReviewFetchResult =
  | Readonly<{
      status: 'persisted'
      reviewId: ReviewId
      sourceRevision: number
      isNew: boolean
    }>
  | Readonly<{
      status: 'reconcile'
      locationName: string
      reason:
        | 'reference_missing'
        | 'reference_expired'
        | 'reference_unavailable'
        | 'reference_invalid'
        | 'target_not_found'
    }>
  | Readonly<{ status: 'obsolete' }>

export type RunTargetedGoogleReviewFetchDeps = Readonly<{
  references: TargetedGoogleReviewReferenceResolver
  googleReviewApi: GoogleReviewApiPort
  propertySourceEpoch: PropertySourceEpochPort
  observationWriter: ReviewProviderObservationWriter
  subjectKeyService: ReviewProviderSubjectKeyService
  syncActivity: ReviewSyncActivityRecorder
  clock: () => Date
}>

async function currentSource(
  deps: RunTargetedGoogleReviewFetchDeps,
  input: RunTargetedGoogleReviewFetchInput,
): Promise<boolean> {
  const scope = await deps.propertySourceEpoch.getSourceEpoch(
    input.organizationId,
    input.propertyId,
  )
  return scope !== null && scope.sourceEpoch === input.sourceEpoch
}

export const runTargetedGoogleReviewFetch =
  (deps: RunTargetedGoogleReviewFetchDeps) =>
  async (
    input: RunTargetedGoogleReviewFetchInput,
  ): Promise<RunTargetedGoogleReviewFetchResult> => {
    if (!(await currentSource(deps, input))) return { status: 'obsolete' }
    const target = await deps.references.resolve({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
      referenceRef: input.referenceRef,
    })
    if (target.status === 'obsolete') return { status: 'obsolete' }
    if (target.status === 'reconcile') return target

    const providerResult = await deps.googleReviewApi.getReview({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
      locationName: target.locationName,
      reviewName: target.reviewName,
    })
    if (providerResult.status === 'not_found') {
      return {
        status: 'reconcile',
        locationName: target.locationName,
        reason: 'target_not_found',
      }
    }
    if (!(await currentSource(deps, input))) return { status: 'obsolete' }

    const resource = parseReviewProviderResource(providerResult.review.reviewName)
    if (
      `accounts/${resource.accountId}/locations/${resource.locationId}` !==
      target.locationName
    ) {
      throw new TypeError('Targeted Google review resource mismatch')
    }
    const deriver = await deps.subjectKeyService.acquireDeriver()
    const subjects = deriver.deriveCandidates({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      resourceName: providerResult.review.reviewName,
    })
    const replyReadGeneration = await deps.observationWriter.allocateReplyReadGeneration()
    const persisted = await deps.observationWriter.persist({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
      observationOrigin: 'ongoing',
      observationKey: sha256Hex(
        `repkey-targeted-review-push-observation-v1\0${input.deliveryId}\0${providerResult.review.reviewName}`,
      ),
      replyReadGeneration,
      review: providerResult.review,
      subjects,
    })
    if (persisted.isNew) {
      await deps.syncActivity.recordNewReviewObserved(input.propertyId, deps.clock())
    }
    return { status: 'persisted', ...persisted }
  }

export type RunTargetedGoogleReviewFetch = ReturnType<typeof runTargetedGoogleReviewFetch>
