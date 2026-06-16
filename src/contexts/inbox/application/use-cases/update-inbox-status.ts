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
import { validateTransition, timestampFieldsForStatus } from '../../domain/rules'
import { inboxItemStatusChanged, inboxItemEscalated } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import { loadInboxItemOrThrow, assertPropertyAccessible } from '../inbox-access'

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
    if (!can(input.role, 'inbox.write'))
      throw inboxError('forbidden', 'No inbox write permission')

    // 1. Find item + enforce role-scoped property access
    const item = await loadInboxItemOrThrow(
      deps.repo,
      input.inboxItemId,
      input.organizationId,
    )
    await assertPropertyAccessible(
      deps.staffPublicApi,
      input.organizationId,
      input.userId,
      input.role,
      item.propertyId,
    )

    // 2. Validate transition
    const transitionResult = validateTransition(item.status, input.newStatus)
    if (transitionResult.isErr()) {
      throw transitionResult.error
    }

    // 3. Update status (timestamp fields derived from the target status)
    const now = deps.clock()
    const updated = await deps.repo.updateStatus(
      input.inboxItemId,
      input.organizationId,
      input.newStatus,
      timestampFieldsForStatus(input.newStatus, now),
      now,
    )

    // 4. Decrement new counter if transitioning away from 'new'
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

    // 5. Emit event
    await deps.events.emit(
      inboxItemStatusChanged({
        eventId: crypto.randomUUID(),
        inboxItemId: updated.id,
        organizationId: updated.organizationId,
        propertyId: updated.propertyId,
        oldStatus: item.status,
        newStatus: updated.status,
        userId: input.userId,
        occurredAt: now,
      }),
    )

    if (input.newStatus === 'escalated') {
      await deps.events.emit(
        inboxItemEscalated({
          eventId: crypto.randomUUID(),
          inboxItemId: updated.id,
          organizationId: updated.organizationId,
          propertyId: updated.propertyId,
          oldStatus: item.status,
          userId: input.userId,
          occurredAt: now,
        }),
      )
    }

    // 6. Return
    return updated
  }

// fallow-ignore-next-line unused-type
export type UpdateInboxStatus = ReturnType<typeof updateInboxStatus>
