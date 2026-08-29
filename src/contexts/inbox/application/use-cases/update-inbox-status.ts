// Inbox context — update inbox status use case
// Governed manual reopen path (ADR 0023/0055). Closing is source-specific:
// provider observation closes Review work and an explicit manager outcome
// closes private feedback.
// Escalation is a separate, orthogonal action.

import type { InboxRepository } from '../ports/inbox.repository'
import type {
  InboxCommandStore,
  ReopenReviewHandlingCycleCommand,
} from '../ports/inbox-command-store.port'
import { reviewId, type InboxItemId } from '#/shared/domain/ids'
import type {
  HandlingCycleHead,
  InboxStatus,
  InboxItem,
  ReviewHandlingCycleHead,
} from '../../domain/types'
import type { ManualReopenReason } from '../../domain/types'
import type { ReviewHandlingCycleStore } from '../ports/review-handling-cycle.store'
import type { ReviewSourceLookupPort } from '../ports/review-source-lookup.port'
import type { ReviewResponseTargetAuthorityPort } from '../ports/review-response-target-authority.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { validateTransition } from '../../domain/rules'
import { inboxItemStatusChanged } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import {
  loadInboxItemOrThrow,
  assertExpectedCommandRevision,
  assertInboxSourcePropertyAccessible,
  canHandleInboxSource,
} from '../inbox-access'

export type UpdateInboxStatusInput = Readonly<{
  inboxItemId: InboxItemId
  newStatus: InboxStatus
  expectedCommandRevision: number
  reopenReason?: ManualReopenReason
  reopenExplanation?: string | null
}>

export type UpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  clock: () => Date
  staffPublicApi: StaffPublicApi
  cycleStore: ReviewHandlingCycleStore
  reviewSourceLookup: ReviewSourceLookupPort
  responseTargetAuthority: ReviewResponseTargetAuthorityPort
}>

export type UpdateInboxStatus = (
  input: UpdateInboxStatusInput,
  ctx: AuthContext,
) => Promise<InboxItem>

type CycleHead = HandlingCycleHead | ReviewHandlingCycleHead

/** Permission, tenancy, optimistic fence, and role-scoped property access. */
async function authorizeStatusUpdate(
  deps: UpdateInboxStatusDeps,
  input: UpdateInboxStatusInput,
  ctx: AuthContext,
): Promise<InboxItem> {
  if (!canForContext(ctx, 'inbox.write'))
    throw inboxError('forbidden', 'No inbox write permission')

  const item = await loadInboxItemOrThrow(
    deps.repo,
    input.inboxItemId,
    ctx.organizationId,
  )
  assertExpectedCommandRevision(item, input.expectedCommandRevision)
  if (!canHandleInboxSource(ctx, item.sourceType)) {
    throw inboxError('forbidden', 'No permission to handle this inbox source')
  }
  await assertInboxSourcePropertyAccessible(
    deps.staffPublicApi,
    ctx,
    'handle',
    item.sourceType,
    item.propertyId,
  )
  return item
}

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
    (permit) => {
      if (permit.materialReviewRevision !== head.currentSourceRevision) {
        throw inboxError(
          'revision_conflict',
          'Review Material Revision changed; reload and retry',
        )
      }
      return deps.commandStore.reopenReviewCycle({
        ...command,
        responseTarget: {
          reviewAuthority: permit,
          targetStart: { basis: 'operational_reopen', at: now },
        },
      })
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
    // 1. Find item + enforce role-scoped property access
    const item = await authorizeStatusUpdate(deps, input, ctx)

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
    if (input.newStatus === 'open') {
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
    // `InboxStatus` is exactly `open | closed`. `closed` was refused above and
    // `open` returned above, so this arm is unreachable — and it used to be the
    // one path in this use case that wrote `inbox_items.status` without the
    // Handling Cycle head. It fails closed rather than keeping an unfenced
    // writer of the compatibility mirror alive for a status that cannot exist.
    throw inboxError(
      'invalid_input',
      'Inbox status has no transition outside open and closed',
      { requestedStatus: input.newStatus },
    )
  }
