// Inbox context — assign inbox item use case
// Claims, releases, or assigns an inbox item. Self-service claim/release uses
// source handling rights; managing another assignee additionally needs
// inbox.manage.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { inboxItemAssigned, inboxItemUnassigned } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import {
  loadInboxItemOrThrow,
  assertExpectedCommandRevision,
  assertInboxSourcePropertyAccessible,
  assertPropertyAccessible,
  canHandleInboxSource,
} from '../inbox-access'

export type AssignInboxItemInput = Readonly<{
  inboxItemId: InboxItemId
  assignedToUserId: UserId | null
  expectedCommandRevision: number
}>

export type AssignInboxItemDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>

export const assignInboxItem =
  (deps: AssignInboxItemDeps) =>
  async (input: AssignInboxItemInput, ctx: AuthContext): Promise<InboxItem> => {
    // 0. Auth gate
    if (!canForContext(ctx, 'inbox.write')) {
      throw inboxError('forbidden', 'No inbox write permission')
    }

    // 1. Find the projection-owned item before deciding whether this is a
    // self-service claim/release or management of another assignee.
    const item = await loadInboxItemOrThrow(
      deps.repo,
      input.inboxItemId,
      ctx.organizationId,
    )
    assertExpectedCommandRevision(item, input.expectedCommandRevision)
    if (!canHandleInboxSource(ctx, item.sourceType)) {
      throw inboxError('forbidden', 'No permission to handle this inbox source')
    }

    const touchesAnotherAssignee =
      (input.assignedToUserId !== null && input.assignedToUserId !== ctx.userId) ||
      (item.assignedTo !== null && item.assignedTo !== ctx.userId)
    if (touchesAnotherAssignee && !canForContext(ctx, 'inbox.manage')) {
      throw inboxError(
        'assignment_not_allowed',
        'Managing another assignee is not available for this role',
      )
    }

    // 2. Enforce role-scoped property access.
    await assertInboxSourcePropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'handle',
      item.sourceType,
      item.propertyId,
    )
    if (touchesAnotherAssignee) {
      await assertPropertyAccessible(
        deps.staffPublicApi,
        ctx,
        'inbox.manage',
        item.propertyId,
      )
    }

    // Assignment grants no authority. The command store re-evaluates both
    // actor and assignee against Identity + Staff inside the write transaction.
    if (item.assignedTo === input.assignedToUserId) return item

    // 3. Update assignment + record the fact atomically (assigned, or
    //    unassigned when the item had a previous assignee)
    const now = deps.clock()
    const event = input.assignedToUserId
      ? inboxItemAssigned({
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          userId: ctx.userId,
          assignedTo: input.assignedToUserId,
          source: 'web',
          occurredAt: now,
        })
      : item.assignedTo
        ? inboxItemUnassigned({
            inboxItemId: item.id,
            organizationId: item.organizationId,
            propertyId: item.propertyId,
            userId: ctx.userId,
            previousAssignee: item.assignedTo,
            source: 'web',
            occurredAt: now,
          })
        : null

    return deps.commandStore.assign(
      item,
      { assignedTo: input.assignedToUserId },
      event,
      now,
    )
  }

export type AssignInboxItem = ReturnType<typeof assignInboxItem>
