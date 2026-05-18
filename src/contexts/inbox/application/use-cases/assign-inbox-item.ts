// Inbox context — assign inbox item use case
// Assigns an inbox item to a user. Validates role eligibility.

import type { InboxRepository } from '../ports/inbox.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import { validateAssignment } from '../../domain/rules'
import { inboxItemAssigned } from '../../domain/events'
import { inboxError } from '../../domain/errors'

export type AssignInboxItemInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  assignedToUserId: UserId | null
  role: string
}>

// fallow-ignore-next-line unused-type
export type AssignInboxItemDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  clock: () => Date
}>

export const assignInboxItem =
  (deps: AssignInboxItemDeps) =>
  async (input: AssignInboxItemInput): Promise<InboxItem> => {
    // 1. Validate assignment eligibility
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

    // 3. Update assignment
    const updated = await deps.repo.updateAssignment(
      input.inboxItemId,
      input.organizationId,
      input.assignedToUserId,
    )

    // 4. Emit event if assigned to a user
    if (input.assignedToUserId) {
      await deps.events.emit(
        inboxItemAssigned({
          inboxItemId: updated.id,
          organizationId: updated.organizationId,
          assignedTo: input.assignedToUserId,
          occurredAt: deps.clock(),
        }),
      )
    }

    // 5. Return
    return updated
  }

// fallow-ignore-next-line unused-type
export type AssignInboxItem = ReturnType<typeof assignInboxItem>
