import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxRepository } from '../ports/inbox.repository'
import type {
  ReviewHandlingCycleExpectation,
  ReviewHandlingCycleStore,
} from '../ports/review-handling-cycle.store'
import { inboxError } from '../../domain/errors'

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
  openedBy: UserId | null
}>

export type StartReviewHandlingCycleDeps = Readonly<{
  inboxRepo: InboxRepository
  cycleStore: ReviewHandlingCycleStore
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
    return deps.cycleStore.startNext({
      ...input,
      openedAt: deps.clock(),
    })
  }
}

export type StartReviewHandlingCycle = ReturnType<typeof startReviewHandlingCycle>
