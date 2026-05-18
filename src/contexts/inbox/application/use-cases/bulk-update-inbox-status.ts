// Inbox context — bulk update inbox status use case
// Batch status change for multiple inbox items.

import type { InboxRepository } from '../ports/inbox.repository'
import type { UnreadCounterPort } from '../ports/unread-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxStatus } from '../../domain/types'
import { validateTransition } from '../../domain/rules'
import { inboxStatusChanged } from '../../domain/events'

export type BulkUpdateInboxStatusInput = Readonly<{
  inboxItemIds: ReadonlyArray<InboxItemId>
  organizationId: OrganizationId
  newStatus: InboxStatus
  userId: UserId
}>

// fallow-ignore-next-line unused-type
export type BulkUpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  unreadCounter: UnreadCounterPort
  clock: () => Date
}>

export const bulkUpdateInboxStatus =
  (deps: BulkUpdateInboxStatusDeps) =>
  async (input: BulkUpdateInboxStatusInput): Promise<{ updated: number }> => {
    const now = deps.clock()

    // Compute timestamp fields
    const timestampFields: Partial<Record<string, Date>> = {}
    if (input.newStatus === 'read') timestampFields.readAt = now
    if (input.newStatus === 'escalated') timestampFields.escalatedAt = now
    if (input.newStatus === 'addressed') timestampFields.addressedAt = now
    if (input.newStatus === 'archived') timestampFields.archivedAt = now

    // Validate each item individually, collect valid IDs
    const validIds: InboxItemId[] = []
    const oldStatuses = new Map<InboxItemId, InboxStatus>()

    for (const id of input.inboxItemIds) {
      const item = await deps.repo.findById(id, input.organizationId)
      if (!item) continue

      const transitionResult = validateTransition(item.status, input.newStatus)
      if (transitionResult.isOk()) {
        validIds.push(id)
        oldStatuses.set(id, item.status)
      }
    }

    if (validIds.length === 0) {
      return { updated: 0 }
    }

    // Bulk update
    const result = await deps.repo.bulkUpdateStatus(
      validIds,
      input.organizationId,
      input.newStatus,
      timestampFields,
    )

    // Decrement unread counter for items transitioning from 'new' to 'read'
    if (input.newStatus === 'read') {
      const newCount = validIds.filter((id) => oldStatuses.get(id) === 'new').length
      for (let i = 0; i < newCount; i++) {
        await deps.unreadCounter.decrement(input.organizationId, input.userId)
      }
    }

    // Emit events for each updated item
    for (const id of validIds) {
      await deps.events.emit(
        inboxStatusChanged({
          inboxItemId: id,
          organizationId: input.organizationId,
          oldStatus: oldStatuses.get(id)!,
          newStatus: input.newStatus,
          occurredAt: now,
        }),
      )
    }

    return result
  }

// fallow-ignore-next-line unused-type
export type BulkUpdateInboxStatus = ReturnType<typeof bulkUpdateInboxStatus>
