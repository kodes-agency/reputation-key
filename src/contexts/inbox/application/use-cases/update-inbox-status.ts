// Inbox context — update inbox status use case
// Changes status, validates transition via domain rules.

import type { InboxRepository } from '../ports/inbox.repository'
import type { UnreadCounterPort } from '../ports/unread-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxStatus, InboxItem } from '../../domain/types'
import { validateTransition } from '../../domain/rules'
import { inboxStatusChanged } from '../../domain/events'
import { inboxError } from '../../domain/errors'

export type UpdateInboxStatusInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  newStatus: InboxStatus
  userId: UserId
}>

// fallow-ignore-next-line unused-type
export type UpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  unreadCounter: UnreadCounterPort
  clock: () => Date
}>

export const updateInboxStatus =
  (deps: UpdateInboxStatusDeps) =>
  async (input: UpdateInboxStatusInput): Promise<InboxItem> => {
    // 1. Find item
    const item = await deps.repo.findById(input.inboxItemId, input.organizationId)
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    // 2. Validate transition
    const transitionResult = validateTransition(item.status, input.newStatus)
    if (transitionResult.isErr()) {
      throw transitionResult.error
    }

    // 3. Compute timestamp fields
    const now = deps.clock()
    const timestampFields: Partial<Record<string, Date>> = {}
    if (input.newStatus === 'read') timestampFields.readAt = now
    if (input.newStatus === 'escalated') timestampFields.escalatedAt = now
    if (input.newStatus === 'addressed') timestampFields.addressedAt = now
    if (input.newStatus === 'archived') timestampFields.archivedAt = now

    // 4. Update status
    const updated = await deps.repo.updateStatus(
      input.inboxItemId,
      input.organizationId,
      input.newStatus,
      timestampFields,
    )

    // 5. Decrement unread counter if transitioning from 'new' to 'read'
    if (item.status === 'new' && input.newStatus === 'read') {
      await deps.unreadCounter.decrement(input.organizationId, input.userId)
    }

    // 6. Emit event
    await deps.events.emit(
      inboxStatusChanged({
        inboxItemId: updated.id,
        organizationId: updated.organizationId,
        oldStatus: item.status,
        newStatus: updated.status,
        occurredAt: now,
      }),
    )

    // 7. Return
    return updated
  }

// fallow-ignore-next-line unused-type
export type UpdateInboxStatus = ReturnType<typeof updateInboxStatus>
