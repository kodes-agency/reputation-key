// Inbox context — update inbox status use case
// Changes status, validates transition via domain rules.
// Enforces role-scoped property access.

import type { InboxRepository } from '../ports/inbox.repository'
import type { NewCounterPort } from '../ports/new-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId } from '#/shared/domain/ids'
import type { InboxStatus, InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { canForContext } from '#/shared/domain/permissions'
import { validateTransition, timestampFieldsForStatus } from '../../domain/rules'
import { inboxItemStatusChanged, inboxItemEscalated } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import { loadInboxItemOrThrow, assertPropertyAccessible } from '../inbox-access'

export type UpdateInboxStatusInput = Readonly<{
  inboxItemId: InboxItemId
  newStatus: InboxStatus
}>

// fallow-ignore-next-line unused-type
export type UpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  newCounter: NewCounterPort
  clock: () => Date
  staffPublicApi: StaffPublicApi
  logger: LoggerPort
}>

export const updateInboxStatus =
  (deps: UpdateInboxStatusDeps) =>
  async (input: UpdateInboxStatusInput, ctx: AuthContext): Promise<InboxItem> => {
    if (!canForContext(ctx, 'inbox.write'))
      throw inboxError('forbidden', 'No inbox write permission')

    // 1. Find item + enforce role-scoped property access
    const item = await loadInboxItemOrThrow(
      deps.repo,
      input.inboxItemId,
      ctx.organizationId,
    )
    await assertPropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'inbox.write',
      item.propertyId,
    )

    // 2. Reject manual 'addressed' on review items — reviews auto-transition
    //    to addressed only via review.reply.published (CONTEXT.md L15).
    //    Server-authoritative mirror of the bulk path's guard
    //    (bulk-update-inbox-status.ts) and the UI's hidden button.
    if (input.newStatus === 'addressed' && item.sourceType === 'review') {
      throw inboxError('invalid_transition', 'Review items cannot be manually addressed')
    }

    // 3. Validate transition
    const transitionResult = validateTransition(item.status, input.newStatus)
    if (transitionResult.isErr()) {
      throw transitionResult.error
    }

    // 4. Update status (timestamp fields derived from the target status)
    const now = deps.clock()
    const updated = await deps.repo.updateStatus(
      input.inboxItemId,
      ctx.organizationId,
      input.newStatus,
      timestampFieldsForStatus(input.newStatus, now),
      now,
    )

    // 5. Decrement new counter if transitioning away from 'new'
    if (item.status === 'new' && input.newStatus !== 'new') {
      try {
        await deps.newCounter.decrement(ctx.organizationId)
      } catch (err) {
        deps.logger.warn(
          { err, organizationId: ctx.organizationId },
          'New counter decrement failed — DB is source of truth',
        )
      }
    }

    // 6. Emit event
    await deps.events.emit(
      inboxItemStatusChanged({
        inboxItemId: updated.id,
        organizationId: updated.organizationId,
        propertyId: item.propertyId,
        oldStatus: item.status,
        newStatus: input.newStatus,
        userId: ctx.userId,
        occurredAt: now,
      }),
    )

    if (input.newStatus === 'escalated') {
      await deps.events.emit(
        inboxItemEscalated({
          inboxItemId: updated.id,
          organizationId: updated.organizationId,
          propertyId: item.propertyId,
          oldStatus: item.status,
          userId: ctx.userId,
          occurredAt: now,
        }),
      )
    }

    // 7. Return
    return updated
  }

// fallow-ignore-next-line unused-type
export type UpdateInboxStatus = ReturnType<typeof updateInboxStatus>
