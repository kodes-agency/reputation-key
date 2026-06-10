// Notification context — email queue entry constructor

import { ok, type Result } from '#/shared/domain'
import type { NotificationEmail, NotificationPriority } from './types'
import type {
  NotificationEmailId,
  NotificationId,
  UserId,
  OrganizationId,
} from '#/shared/domain/ids'
import type { NotificationError } from './errors'

// ── Create email queue entry ────────────────────────────────────────

export type CreateNotificationEmailInput = Readonly<{
  notificationId: NotificationId
  userId: UserId
  organizationId: OrganizationId
  priority: NotificationPriority
}>

export const createNotificationEmail = (
  input: CreateNotificationEmailInput,
  clock: () => Date,
): Result<NotificationEmail, NotificationError> => {
  const now = clock()
  return ok({
    id: '' as unknown as NotificationEmailId,
    notificationId: input.notificationId,
    userId: input.userId,
    organizationId: input.organizationId,
    status: 'pending',
    priority: input.priority,
    sentAt: null,
    failedAt: null,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  })
}
