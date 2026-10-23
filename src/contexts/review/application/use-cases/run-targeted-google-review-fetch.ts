import type {
  GoogleConnectionId,
  OrganizationId,
  PropertyId,
  ReviewId,
} from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import {
  GOOGLE_CONNECTION_UNUSABLE_CODE,
  isGoogleConnectionUnusable,
  type GoogleReviewApiPort,
} from '../ports/google-review-api.port'
import type { PropertySourceEpochPort } from '../ports/property-source-epoch.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-observation-writer.port'
import type { ReviewFirstSightingRecorder } from '../ports/review-first-sighting-recorder.port'
import type { GoogleReviewPushNotificationKind } from '../ports/review-queue.port'
import type { ReviewSyncActivityRecorder } from '../ports/review-sync-activity.port'
import type { TargetedGoogleReviewReferenceResolver } from '../ports/targeted-google-review-reference.port'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'
import { persistGoogleReviewObservation } from './persist-google-review-observation'

export type RunTargetedGoogleReviewFetchInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  referenceRef: string | null
  /** Durable outbox event identity; makes observation replay idempotent. */
  deliveryId: string
  /** When Pub/Sub accepted the push; the arrival time push health judges. */
  acceptedAt: Date
  notificationKind: GoogleReviewPushNotificationKind
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
  /**
   * The Property's Google connection cannot be used (it waits for a
   * reconnect), so the read never reached Google. Quiet by design: the
   * reconnect notice is the signal, and the first poll after the reconnect
   * finds what the push announced.
   */
  | Readonly<{ status: 'skipped'; code: typeof GOOGLE_CONNECTION_UNUSABLE_CODE }>

export type RunTargetedGoogleReviewFetchDeps = Readonly<{
  references: TargetedGoogleReviewReferenceResolver
  googleReviewApi: GoogleReviewApiPort
  propertySourceEpoch: PropertySourceEpochPort
  observationWriter: ReviewProviderObservationWriter
  subjectKeyService: ReviewProviderSubjectKeyService
  syncActivity: ReviewSyncActivityRecorder
  firstSightings: ReviewFirstSightingRecorder
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

    let providerResult: Awaited<ReturnType<GoogleReviewApiPort['getReview']>>
    try {
      providerResult = await deps.googleReviewApi.getReview({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        connectionId: input.connectionId,
        sourceEpoch: input.sourceEpoch,
        locationName: target.locationName,
        reviewName: target.reviewName,
      })
    } catch (error) {
      // Only the unusable connection is quiet. A refusal of a connection that
      // IS usable (`authorization_denied`: the permit vector moved, the content
      // posture denied) and every other failure still throws.
      if (isGoogleConnectionUnusable(error)) {
        return { status: 'skipped', code: GOOGLE_CONNECTION_UNUSABLE_CODE }
      }
      throw error
    }
    if (providerResult.status === 'not_found') {
      return {
        status: 'reconcile',
        locationName: target.locationName,
        reason: 'target_not_found',
      }
    }
    if (!(await currentSource(deps, input))) return { status: 'obsolete' }

    const persisted = await persistGoogleReviewObservation(deps, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
      locationName: target.locationName,
      review: providerResult.review,
      observationKey: sha256Hex(
        `repkey-targeted-review-push-observation-v1\0${input.deliveryId}\0${providerResult.review.reviewName}`,
      ),
      firstSeenVia: 'push',
      pushAcceptedAt: input.acceptedAt,
    })
    if (persisted.isNew) {
      await deps.syncActivity.recordNewReviewObserved(input.propertyId, deps.clock())
    } else if (input.notificationKind !== 'UPDATED_REVIEW') {
      // Polling saw this Review first: pair the push with its first-sighting
      // row. A Review the push itself created already carries the push (the
      // writer records it with the Review). An UPDATED_REVIEW push says a
      // Review changed, not that a new one arrived, so it never counts.
      await deps.firstSightings.markPushArrived({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: persisted.reviewId,
        acceptedAt: input.acceptedAt,
      })
    }
    return { status: 'persisted', ...persisted }
  }

export type RunTargetedGoogleReviewFetch = ReturnType<typeof runTargetedGoogleReviewFetch>
