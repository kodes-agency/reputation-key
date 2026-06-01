// Inbox context — bulk update inbox status use case
// Batch status change for multiple inbox items.

import type { InboxRepository } from '../ports/inbox.repository'
import type { NewCounterPort } from '../ports/new-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { InboxStatus } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { validateTransition } from '../../domain/rules'
import { inboxStatusChanged } from '../../domain/events'
import { can } from '#/shared/domain/permissions'
import type { LoggerPort } from '#/shared/domain/logger.port'

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
  newCounter: NewCounterPort
  clock: () => Date
  staffPublicApi: StaffPublicApi
  logger: LoggerPort
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

    // Pre-compute accessible property IDs for non-admin users (once, outside loop)
    let accessiblePropertyIds: Awaited<
      ReturnType<StaffPublicApi['getAccessiblePropertyIds']>
    > | null = null
    if (!can(input.role, 'inbox.manage')) {
      try {
        accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
          input.organizationId,
          input.userId,
          input.role,
        )
      } catch (err) {
        deps.logger.warn(
          { err, organizationId: input.organizationId },
          'Access check for property IDs failed, treating as no access',
        )
        return { updated: 0 }
      }
    }

    // Batch-fetch all items in one query (eliminates N+1)
    const items = await deps.repo.findByIds(input.inboxItemIds, input.organizationId)
    const itemMap = new Map(items.map((item) => [item.id as string, item]))

    // Validate each item individually, collect valid IDs
    const validIds: InboxItemId[] = []
    const oldStatuses = new Map<InboxItemId, InboxStatus>()

    for (const id of input.inboxItemIds) {
      const item = itemMap.get(id as string)
      if (!item) continue

      // Defense-in-depth: skip reviews for bulk 'addressed' (reviews auto-transition via reply.published)
      if (input.newStatus === 'addressed' && item.sourceType === 'review') continue

      // Enforce role-scoped property access (using pre-computed list)
      if (accessiblePropertyIds !== null) {
        if (!accessiblePropertyIds.includes(item.propertyId as PropertyId)) {
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
      now,
    )

    // Decrement new counter for items transitioning away from 'new'
    if (input.newStatus !== 'new') {
      const newCount = validIds.filter((id) => oldStatuses.get(id) === 'new').length
      for (let i = 0; i < newCount; i++) {
        try {
          await deps.newCounter.decrement(input.organizationId)
        } catch (err) {
          deps.logger.warn(
            { err, organizationId: input.organizationId },
            'New counter decrement failed, DB is source of truth',
          )
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
