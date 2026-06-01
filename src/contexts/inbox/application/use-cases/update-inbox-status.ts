// Inbox context — update inbox status use case
// Changes status, validates transition via domain rules.
// Enforces role-scoped property access.

import type { InboxRepository } from '../ports/inbox.repository'
import type { NewCounterPort } from '../ports/new-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxStatus, InboxItem } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { can } from '#/shared/domain/permissions'
import { validateTransition } from '../../domain/rules'
import { inboxStatusChanged, inboxItemEscalated } from '../../domain/events'
import { inboxError } from '../../domain/errors'

export type UpdateInboxStatusInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  newStatus: InboxStatus
  userId: UserId
  role: Role
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
  async (input: UpdateInboxStatusInput): Promise<InboxItem> => {
    // 1. Find item
    const item = await deps.repo.findById(input.inboxItemId, input.organizationId)
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    if (!can(input.role, 'inbox.manage')) {
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        input.role,
      )
      if (
        accessible !== null &&
        !accessible.includes(
          item.propertyId as ReturnType<typeof import('#/shared/domain/ids').propertyId>,
        )
      ) {
        throw inboxError('forbidden', 'No access to this property', {
          propertyId: item.propertyId,
        })
      }
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
      now,
    )

    // 5. Decrement new counter if transitioning away from 'new'
    if (item.status === 'new' && input.newStatus !== 'new') {
      try {
        await deps.newCounter.decrement(input.organizationId)
      } catch (err) {
        deps.logger.warn(
          { err, organizationId: input.organizationId },
          'New counter decrement failed, DB is source of truth',
        )
      }
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

    if (input.newStatus === 'escalated') {
      await deps.events.emit(
        inboxItemEscalated({
          inboxItemId: updated.id,
          organizationId: updated.organizationId,
          oldStatus: item.status,
          occurredAt: now,
        }),
      )
    }

    // 7. Return
    return updated
  }

// fallow-ignore-next-line unused-type
export type UpdateInboxStatus = ReturnType<typeof updateInboxStatus>
