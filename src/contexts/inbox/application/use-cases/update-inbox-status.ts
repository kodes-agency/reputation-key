// Inbox context — update inbox status use case
// Governed manual reopen path (ADR 0023/0055). Closing is source-specific:
// provider observation closes Review work and an explicit manager outcome
// closes private feedback.
// Escalation is a separate, orthogonal action.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import { reviewId, type InboxItemId } from '#/shared/domain/ids'
import type { InboxStatus, InboxItem } from '../../domain/types'
import type { ManualReopenReason } from '../../domain/types'
import type { ReviewHandlingCycleStore } from '../ports/review-handling-cycle.store'
import type { ReviewSourceLookupPort } from '../ports/review-source-lookup.port'
import type { ReviewResponseTargetAuthorityPort } from '../ports/review-response-target-authority.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { validateTransition, timestampFieldsForStatus } from '../../domain/rules'
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

export const updateInboxStatus =
  (deps: UpdateInboxStatusDeps): UpdateInboxStatus =>
  async (input, ctx) => {
    if (!canForContext(ctx, 'inbox.write'))
      throw inboxError('forbidden', 'No inbox write permission')

    // 1. Find item + enforce role-scoped property access
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
      const head = deps.cycleStore.findSourceHead
        ? await deps.cycleStore.findSourceHead(item.id, item.organizationId)
        : item.sourceType === 'review'
          ? await deps.cycleStore.findHead(item.id, item.organizationId)
          : null
      if (!head) {
        throw inboxError('not_found', 'Inbox item has no current Handling Cycle')
      }
      const command = {
        item,
        expected: {
          cycleNumber: head.currentCycleNumber,
          sourceRevision:
            'currentMaterialReviewRevision' in head
              ? (head.currentSourceRevision ?? head.currentMaterialReviewRevision)
              : head.currentSourceRevision,
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
    return deps.commandStore.updateStatus(
      item,
      {
        status: input.newStatus,
        timestampFields: timestampFieldsForStatus(input.newStatus, now),
      },
      fact,
      now,
    )
  }
