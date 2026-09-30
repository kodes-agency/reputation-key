// "Assigned to you" stops waiting on whoever held an item once it moves on
// (D3, ADR 0046 amended 2026-09-30).
//
// Their own "No longer yours" notice retires it, but that notice is not always
// sent: nobody is told about a handoff they made themselves, and a bulk move
// notifies per group, not per item. The assignment fact itself names the
// previous holder, so the assignment consumer retires their row from it,
// whatever notices go out. Settling is idempotent: a row already resolved is
// not touched again, so a redelivered fact cancels no newer mail.

import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import { SETTLED_EMAIL_REASON } from '../domain/notification-settlement'
import type { NotificationRepositoryPort } from './ports/notification-repository.port'
import type { NotificationEmailRepositoryPort } from './ports/notification-email-repository.port'

export type RetireMovedAssignmentDeps = Readonly<{
  notifications: Pick<NotificationRepositoryPort, 'settleUnreadForReader'>
  emails: Pick<NotificationEmailRepositoryPort, 'cancelQueuedForNotifications'>
}>

export type RetireMovedAssignment = (
  input: Readonly<{
    organizationId: OrganizationId
    /** Who held the item before it moved. */
    userId: UserId
    inboxItemId: InboxItemId
    at: Date
  }>,
) => Promise<void>

export const createRetireMovedAssignment =
  (deps: RetireMovedAssignmentDeps): RetireMovedAssignment =>
  async ({ organizationId, userId, inboxItemId, at }) => {
    const settled = await deps.notifications.settleUnreadForReader({
      organizationId,
      userId,
      types: ['inbox.assigned'],
      resourceId: inboxItemId,
      resolvedAt: at,
    })
    if (settled.length === 0) return
    await deps.emails.cancelQueuedForNotifications(
      settled,
      organizationId,
      SETTLED_EMAIL_REASON,
      at,
    )
  }
