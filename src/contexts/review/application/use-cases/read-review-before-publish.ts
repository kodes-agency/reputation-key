import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { PropertySourceEpochPort } from '../ports/property-source-epoch.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-observation-writer.port'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'
import { persistGoogleReviewObservation } from './persist-google-review-observation'

export type ReadReviewBeforePublishInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  locationName: string
  reviewName: string
  /** Identifies one read (reply, cycle and job attempt); replaying it is idempotent. */
  readKey: string
}>

export type ReadReviewBeforePublishResult =
  /** Google's answer is recorded: the Reply's head is now what Google shows. */
  | Readonly<{ status: 'recorded' }>
  /** Google shows a reply RepKey cannot read. The review is recorded; the reply
   * is not, because recording it would say "no reply". */
  | Readonly<{ status: 'reply_unreadable' }>
  | Readonly<{ status: 'review_missing' }>
  /** The Property moved on (archive, relink) while the read was being made. */
  | Readonly<{ status: 'obsolete' }>

export type ReadReviewBeforePublishDeps = Readonly<{
  googleReviewApi: GoogleReviewApiPort
  propertySourceEpoch: PropertySourceEpochPort
  observationWriter: ReviewProviderObservationWriter
  subjectKeyService: ReviewProviderSubjectKeyService
}>

/**
 * One `reviews.get` of the review a Reply is about to be published on, recorded
 * through the writer sync and push use. A `reviews.reply` write is an upsert
 * with no precondition, so this read is the only thing that lets RepKey see an
 * answer someone wrote on Google since its last sync. The publish job claims
 * after it, and the claim's head fence is the check that decides: a reply
 * RepKey had not seen has moved the head.
 *
 * Throws when the read or the recording fails; the caller classifies it.
 */
export const readReviewBeforePublish =
  (deps: ReadReviewBeforePublishDeps) =>
  async (input: ReadReviewBeforePublishInput): Promise<ReadReviewBeforePublishResult> => {
    const sourceIsCurrent = async (): Promise<boolean> => {
      const scope = await deps.propertySourceEpoch.getSourceEpoch(
        input.organizationId,
        input.propertyId,
      )
      return scope !== null && scope.sourceEpoch === input.sourceEpoch
    }
    if (!(await sourceIsCurrent())) return { status: 'obsolete' }

    const providerResult = await deps.googleReviewApi.getReview({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
      locationName: input.locationName,
      reviewName: input.reviewName,
      forReplyPublication: true,
    })
    if (!(await sourceIsCurrent())) return { status: 'obsolete' }
    if (providerResult.status === 'not_found') return { status: 'review_missing' }

    await persistGoogleReviewObservation(deps, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      connectionId: input.connectionId,
      sourceEpoch: input.sourceEpoch,
      locationName: input.locationName,
      review: providerResult.review,
      observationKey: sha256Hex(
        ['repkey-prepublish-review-read-v1', input.readKey, input.reviewName].join('\0'),
      ),
      firstSeenVia: 'demand',
    })
    return providerResult.review.replyUnreadable === true
      ? { status: 'reply_unreadable' }
      : { status: 'recorded' }
  }

export type ReadReviewBeforePublish = ReturnType<typeof readReviewBeforePublish>
