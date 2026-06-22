// Notification context — status transition constructors
// Per architecture: "Domain Returns Result<T, DomainError>. Never throws."

import { ok, err, type Result } from '#/shared/domain'
import type { Notification } from './types'
import { notificationError, type NotificationError } from './errors'

// ── Notification status transitions ─────────────────────────────────

export const markNotificationRead = (
  notification: Notification,
  clock: () => Date,
): Result<Notification, NotificationError> => {
  if (notification.status === 'read') {
    return ok(notification) // Idempotent — already read
  }

  if (notification.status !== 'unread') {
    return err(
      notificationError(
        'invalid_status',
        `Cannot mark as read from status: ${notification.status}`,
        {
          status: notification.status,
        },
      ),
    )
  }

  const now = clock()
  return ok({
    ...notification,
    status: 'read',
    readAt: now,
    updatedAt: now,
  })
}

export const dismissNotification = (
  notification: Notification,
  clock: () => Date,
): Result<Notification, NotificationError> => {
  if (notification.status === 'dismissed') {
    return ok(notification) // Idempotent — already dismissed
  }

  if (notification.status !== 'unread' && notification.status !== 'read') {
    return err(
      notificationError(
        'invalid_status',
        `Cannot dismiss from status: ${notification.status}`,
        {
          status: notification.status,
        },
      ),
    )
  }

  const now = clock()
  return ok({
    ...notification,
    status: 'dismissed',
    updatedAt: now,
  })
}
