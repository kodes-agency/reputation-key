import {
  reviewId,
  type InboxItemId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import type { ManualReopenReason } from '../../domain/types'
import type { InboxRepository } from '../ports/inbox.repository'
import type {
  ReviewHandlingCycleExpectation,
  ReviewHandlingCycleStore,
} from '../ports/review-handling-cycle.store'
import { inboxError } from '../../domain/errors'
import type { ReviewSourceLookupPort } from '../ports/review-source-lookup.port'
import type { ReviewResponseTargetAuthorityPort } from '../ports/review-response-target-authority.port'

export type StartReviewHandlingCycleInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  expected: ReviewHandlingCycleExpectation
  materialReviewRevision: number
  openedReason:
    | 'material_revision_changed'
    | 'manual_reopen'
    | 'provider_reply_deleted'
    | 'provider_reply_diverged'
  manualReopenReason?: ManualReopenReason
  manualReopenExplanation?: string | null
  openedBy: UserId | null
}>

export type StartReviewHandlingCycleDeps = Readonly<{
  inboxRepo: InboxRepository
  cycleStore: ReviewHandlingCycleStore
  reviewSourceLookup: ReviewSourceLookupPort
  responseTargetAuthority: ReviewResponseTargetAuthorityPort
  clock: () => Date
}>

/** Internal re-handling command; authorization stays with the invoking workflow. */
export const startReviewHandlingCycle = (deps: StartReviewHandlingCycleDeps) => {
  return async (input: StartReviewHandlingCycleInput) => {
    const item = await deps.inboxRepo.findById(input.inboxItemId, input.organizationId)
    if (!item) throw inboxError('not_found', 'Inbox item not found')
    if (item.sourceType !== 'review') {
      throw inboxError(
        'invalid_input',
        'Review Handling Cycles cannot be opened for a feedback item',
      )
    }
    const source = await deps.reviewSourceLookup.getReviewSourceMetaById(
      reviewId(item.sourceId),
      item.organizationId,
    )
    if (!source) throw inboxError('not_found', 'Review source is unavailable')
    const openedAt = deps.clock()
    const authority = await deps.responseTargetAuthority.withExactCurrent(
      {
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        reviewId: item.sourceId,
        sourceEpoch: source.sourceEpoch,
      },
      (permit) => {
        if (permit.materialReviewRevision !== input.materialReviewRevision) {
          throw inboxError(
            'revision_conflict',
            'Review Material Revision changed; reload and retry',
          )
        }
        return deps.cycleStore.startNext({
          ...input,
          openedAt,
          responseTarget: {
            reviewAuthority: permit,
            targetStart:
              input.openedReason === 'manual_reopen' ||
              input.openedReason === 'provider_reply_deleted'
                ? { basis: 'operational_reopen' as const, at: openedAt }
                : { basis: 'review_provenance' as const },
          },
        })
      },
    )
    if (authority.status === 'obsolete') {
      throw inboxError('revision_conflict', 'Review source changed; reload and retry')
    }
    return authority.value
  }
}

export type StartReviewHandlingCycle = ReturnType<typeof startReviewHandlingCycle>
