// Inbox context — bulk update inbox status use case
// Batch status change for multiple inbox items.

import type { InboxRepository } from '../ports/inbox.repository'
import type { UnreadCounterPort } from '../ports/unread-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxStatus } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { validateTransition } from '../../domain/rules'
import { inboxStatusChanged } from '../../domain/events'
import { hasRole } from '#/shared/domain/roles'

export type BulkUpdateInboxStatusInput = Readonly<{
  inboxItemIds: ReadonlyArray<InboxItemId>
  organizationId: OrganizationId
  newStatus: InboxStatus
  userId: UserId
  role: Role
}>

// fallow-ignore-next-line unused-type
export type BulkUpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  unreadCounter: UnreadCounterPort
  clock: () => Date
  staffPublicApi: StaffPublicApi
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

      // Enforce role-scoped property access
      if (!hasRole(input.role, 'AccountAdmin' as Role)) {
        let accessible: Awaited<ReturnType<StaffPublicApi['getAccessiblePropertyIds']>> = // eslint-disable-line no-useless-assignment
          null
        try {
          accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
            input.organizationId,
            input.userId,
            input.role,
          )
        } catch {
          continue // If access check fails, skip this item
        }
        if (
          accessible !== null &&
          !accessible.includes(
            item.propertyId as ReturnType<
              typeof import('#/shared/domain/ids').propertyId
            >,
          )
        ) {
          continue // Skip items from inaccessible properties
        }
      }

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

    // Decrement unread counter for items transitioning away from 'new'
    if (input.newStatus !== 'new') {
      const newCount = validIds.filter((id) => oldStatuses.get(id) === 'new').length
      for (let i = 0; i < newCount; i++) {
        try {
          await deps.unreadCounter.decrement(input.organizationId, input.userId)
        } catch {
          // Counter unavailable — non-critical, DB is source of truth
          break
        }
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
