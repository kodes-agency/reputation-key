// Inbox context — update inbox status use case
// Governed manual reopen path (ADR 0055). Closing is source-specific:
// provider observation closes Review work and an explicit manager outcome
// closes private feedback.
// Escalation is a separate, orthogonal action.

import { borrowReviewTransaction } from '#/contexts/reputation/reviews/open-transaction.server'
import type { InboxRepository } from '#/contexts/reputation/inbox/inbox-repository.port.server'
import type {
  InboxCommandStore,
  ReopenReviewHandlingCycleCommand,
} from '#/contexts/reputation/inbox/command-store.port.server'
import { reviewId, type InboxItemId } from '#/shared/domain/ids'
import type {
  HandlingCycleHead,
  InboxItem,
  InboxStatus,
  ManualReopenReason,
  ReviewHandlingCycleHead,
} from '#/contexts/reputation/domain/inbox-types'
import type { ReviewHandlingCycleStore } from '#/contexts/reputation/inbox/review-handling-cycle-store.port.server'
import type { ReviewSourceLookupPort } from '#/contexts/reputation/inbox/review-source-lookup.port.server'
import type { ReviewResponseTargetAuthority } from '#/contexts/reputation/reviews/response-target-authority.port.server'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import { validateTransition } from '#/contexts/reputation/domain/inbox-rules'
import { inboxItemStatusChanged } from '#/contexts/reputation/domain/inbox-events'
import { inboxError } from '#/contexts/reputation/domain/inbox-errors'
import { loadItemForCommand } from '#/contexts/reputation/inbox/inbox-access.server'

export type UpdateInboxStatusInput = Readonly<{
  inboxItemId: InboxItemId
  newStatus: InboxStatus
  expectedCommandRevision: number
  reopenReason?: ManualReopenReason
  reopenExplanation?: string | null
}>

export type UpdateInboxStatus = (
  input: UpdateInboxStatusInput,
  ctx: AuthContext,
) => Promise<InboxItem>

export type UpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  clock: () => Date
  staffPublicApi: StaffPublicApi
  cycleStore: ReviewHandlingCycleStore
  reviewSourceLookup: ReviewSourceLookupPort
  responseTargetAuthority: ReviewResponseTargetAuthority
}>

type CycleHead = HandlingCycleHead | ReviewHandlingCycleHead

/** Source-agnostic head when the store offers one; otherwise the Review-only head. */
async function findCurrentCycleHead(
  deps: UpdateInboxStatusDeps,
  item: InboxItem,
): Promise<CycleHead | null> {
  if (deps.cycleStore.findSourceHead) {
    return deps.cycleStore.findSourceHead(item.id, item.organizationId)
  }
  if (item.sourceType === 'review') {
    return deps.cycleStore.findHead(item.id, item.organizationId)
  }
  return null
}

/** A Review-only head names the source revision under its Review-specific field. */
function currentSourceRevisionOf(head: CycleHead): number {
  if ('currentMaterialReviewRevision' in head) {
    return head.currentSourceRevision ?? head.currentMaterialReviewRevision
  }
  return head.currentSourceRevision
}

/**
 * Review reopen runs under the Response Target authority so the new cycle's
 * target anchor and the Review's exact current source state commit together.
 */
async function reopenUnderResponseTargetAuthority(
  deps: UpdateInboxStatusDeps,
  item: InboxItem,
  head: CycleHead,
  command: ReopenReviewHandlingCycleCommand,
  now: Date,
): Promise<InboxItem> {
  const source = await deps.reviewSourceLookup.getReviewSourceMetaById(
    reviewId(item.sourceId),
    item.organizationId,
  )
  if (!source) throw inboxError('not_found', 'Review source is unavailable')
  const authority = await deps.responseTargetAuthority.withExactCurrent(
    {
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      reviewId: item.sourceId,
      sourceEpoch: source.sourceEpoch,
    },
    (permit, reviewTx) => {
      if (permit.materialReviewRevision !== head.currentSourceRevision) {
        throw inboxError(
          'revision_conflict',
          'Review Material Revision changed; reload and retry',
        )
      }
      return deps.commandStore.reopenReviewCycle(
        {
          ...command,
          responseTarget: {
            reviewAuthority: permit,
            targetStart: { basis: 'operational_reopen', at: now },
          },
        },
        borrowReviewTransaction(reviewTx),
      )
    },
  )
  if (authority.status === 'obsolete') {
    throw inboxError('revision_conflict', 'Review source changed; reload and retry')
  }
  return authority.value
}

export const updateInboxStatus =
  (deps: UpdateInboxStatusDeps): UpdateInboxStatus =>
  async (input, ctx) => {
    // 1. Permission, tenancy, role-scoped property access, then the optimistic fence
    const item = await loadItemForCommand(deps, input, ctx)

    // Every close is source-specific: Google observation closes Review work;
    // private feedback closes only after a manager chooses one outcome. The
    // generic status endpoint remains the governed reopen path.
    if (input.newStatus === 'closed') {
      throw inboxError(
        'invalid_input',
        item.sourceType === 'review'
          ? 'Google review work closes after the current reply is observed on Google'
          : 'Use Mark as handled and choose a private-feedback outcome',
      )
    }

    // 2. Validate transition (open ⇄ closed).
    const transitionResult = validateTransition(item.status, input.newStatus)
    if (transitionResult.isErr()) {
      throw transitionResult.error
    }

    // 3. Update status + record the fact atomically (timestamp derived from
    //    target status — closedAt only)
    const now = deps.clock()
    const fact = inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      oldStatus: item.status,
      newStatus: input.newStatus,
      userId: ctx.userId,
      occurredAt: now,
    })
    if (!input.reopenReason) {
      throw inboxError('invalid_input', 'A neutral reopen reason is required')
    }
    const head = await findCurrentCycleHead(deps, item)
    if (!head) {
      throw inboxError('not_found', 'Inbox item has no current Handling Cycle')
    }
    const command: ReopenReviewHandlingCycleCommand = {
      item,
      expected: {
        cycleNumber: head.currentCycleNumber,
        sourceRevision: currentSourceRevisionOf(head),
        stateRevision: head.stateRevision,
      },
      reason: input.reopenReason,
      explanation: input.reopenExplanation ?? null,
      fact,
      now,
    }
    if (item.sourceType !== 'review') {
      return deps.commandStore.reopenReviewCycle(command)
    }
    return reopenUnderResponseTargetAuthority(deps, item, head, command, now)
  }
