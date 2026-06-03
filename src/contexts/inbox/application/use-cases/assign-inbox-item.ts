// Inbox context — assign inbox item use case
// Assigns an inbox item to a user. Validates role eligibility.

import type { InboxRepository } from '../ports/inbox.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { validateAssignment } from '../../domain/rules'
import { inboxItemAssigned, inboxItemUnassigned } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import { can } from '#/shared/domain/permissions'

export type AssignInboxItemInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  assignedToUserId: UserId | null
  role: Role
  userId: UserId
}>

// fallow-ignore-next-line unused-type
export type AssignInboxItemDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>

export const assignInboxItem =
  (deps: AssignInboxItemDeps) =>
  async (input: AssignInboxItemInput): Promise<InboxItem> => {
    // 0. Auth gate
    if (!can(input.role, 'inbox.write')) {
      throw inboxError('forbidden', 'No inbox write permission')
    }

    // 1. Validate assignment eligibility (PM+ only)
    const assignmentResult = validateAssignment(input.role)
    if (assignmentResult.isErr()) {
      throw assignmentResult.error
    }

    // 2. Find item
    const item = await deps.repo.findById(input.inboxItemId, input.organizationId)
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    // Enforce role-scoped property access
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

    // 3. Update assignment
    const updated = await deps.repo.updateAssignment(
      input.inboxItemId,
      input.organizationId,
      input.assignedToUserId,
    )

    // 4. Emit event if assigned to a user, or unassigned
    if (input.assignedToUserId) {
      await deps.events.emit(
        inboxItemAssigned({
          inboxItemId: updated.id,
          organizationId: updated.organizationId,
          propertyId: item.propertyId,
          userId: input.userId,
          assignedTo: input.assignedToUserId,
          source: 'web',
          occurredAt: deps.clock(),
        }),
      )
    } else if (item.assignedTo) {
      await deps.events.emit(
        inboxItemUnassigned({
          inboxItemId: updated.id,
          organizationId: updated.organizationId,
          propertyId: item.propertyId,
          userId: input.userId,
          previousAssignee: item.assignedTo,
          source: 'web',
          occurredAt: deps.clock(),
        }),
      )
    }

    // 5. Return
    return updated
  }

// fallow-ignore-next-line unused-type
export type AssignInboxItem = ReturnType<typeof assignInboxItem>
