// Inbox context — assign inbox item use case
// Assigns an inbox item to a user. Validates role eligibility.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { isPropertyAccessible } from '#/shared/domain/property-access'
import { inboxItemAssigned, inboxItemUnassigned } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import { loadInboxItemOrThrow, assertPropertyAccessible } from '../inbox-access'

export type AssignInboxItemInput = Readonly<{
  inboxItemId: InboxItemId
  assignedToUserId: UserId | null
}>

// fallow-ignore-next-line unused-type
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

    // 1. Validate assignment eligibility (inbox.manage — PM+ for built-in roles)
    if (!canForContext(ctx, 'inbox.manage')) {
      throw inboxError('assignment_not_allowed', 'Cannot assign inbox items')
    }

    // 2. Find item + enforce role-scoped property access
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

    // 2b. Verify the ASSIGNEE has access to the item's property (INBOX-04).
    //     The caller check above is not sufficient — the assignee must also
    //     be able to access the property to handle the inbox item. The org-wide
    //     flag mirrors the caller's scope (admin trusts the assignee).
    if (input.assignedToUserId) {
      const assigneeCanAccess = await isPropertyAccessible(
        (orgId, uId, orgWide) =>
          deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
        ctx.organizationId,
        input.assignedToUserId,
        scopeForPermission(ctx, 'inbox.write') === 'organization',
        item.propertyId,
      )
      if (!assigneeCanAccess) {
        throw inboxError('forbidden', 'Assignee does not have access to this property', {
          assignedToUserId: input.assignedToUserId,
          propertyId: item.propertyId,
        })
      }
    }

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

// fallow-ignore-next-line unused-type
export type AssignInboxItem = ReturnType<typeof assignInboxItem>
