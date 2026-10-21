import type {
  GoogleConnectionId,
  OrganizationId,
  PropertyId,
  ReviewId,
} from '#/shared/domain/ids'
import type { ReviewProviderSubject } from '#/shared/review-provider-subject-contract'
import type { ReviewFirstSeenVia } from '#/shared/domain/push-health'
import type { GoogleReviewRead } from './google-review-api.port'
import type { ReviewProviderObservationOrigin } from './response-target-authority.port'

export type ReviewProviderSubjectCandidates = readonly [
  ReviewProviderSubject,
  ...ReviewProviderSubject[],
]

/** Request-scoped source writer supplied by the normal Review sync path. */
export type ReviewProviderObservationWriter = Readonly<{
  /** Allocate after provider response acquisition; gaps are expected when
   * later validation or persistence fails. */
  allocateReplyReadGeneration(): Promise<number>
  persist(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      connectionId: GoogleConnectionId
      sourceEpoch: number
      observationOrigin: ReviewProviderObservationOrigin
      /**
       * How this read reaches RepKey, for the push health ledger. Used only
       * when the read turns out to be a live first sighting of the Review.
       * Required, so a new read path cannot silently mislabel itself.
       */
      firstSeenVia: ReviewFirstSeenVia
      /** The Pub/Sub acceptance time of the push this read answers, if any. */
      pushAcceptedAt?: Date
      /** Content-free idempotency digest for one logical provider observation. */
      observationKey: string
      replyReadGeneration: number
      /** As the provider adapter mapped it: `replyUnreadable` rides with it. */
      review: GoogleReviewRead
      subjects: ReviewProviderSubjectCandidates
    }>,
  ): Promise<Readonly<{ reviewId: ReviewId; sourceRevision: number; isNew: boolean }>>
}>
