// Feed notification surface — status transition constructors
// Per architecture: "Domain Returns Result<T, DomainError>. Never throws."

import { ok, err, type Result } from '#/shared/domain'
import type { Notification } from './notification-types'
import { notificationError, type NotificationError } from './notification-errors'

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

/**
 * Read -> unread. The inverse of `markNotificationRead`, for the row menu's
 * "Mark as unread".
 *
 * A dismissed row is NOT resurrected: dismissal is the user saying "gone", and
 * un-dismissing is `restoreDismissedNotification`, the dismissal's own undo. The
 * (user, type, resource) unread-uniqueness collision this can cause is a
 * database fact, so it is resolved by the repository's guarded UPDATE, not here.
 */
export const markNotificationUnread = (
  notification: Notification,
  clock: () => Date,
): Result<Notification, NotificationError> => {
  if (notification.status === 'unread') {
    return ok(notification) // Idempotent — already unread
  }

  if (notification.status !== 'read') {
    return err(
      notificationError(
        'invalid_status',
        `Cannot mark as unread from status: ${notification.status}`,
        { status: notification.status },
      ),
    )
  }

  const now = clock()
  return ok({
    ...notification,
    status: 'unread',
    readAt: null,
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

/**
 * Dismissed -> how it was before: the undo a dismissal offers for a few seconds
 * after it. A dismissal keeps `readAt`, so a row nobody had read comes back
 * unread and a read row comes back read. The (user, type, resource) unread key
 * another row may hold meanwhile is a database fact, resolved by the
 * repository's guarded UPDATE, as it is for `markNotificationUnread`.
 */
export const restoreDismissedNotification = (
  notification: Notification,
  clock: () => Date,
): Result<Notification, NotificationError> => {
  if (notification.status !== 'dismissed') {
    return err(
      notificationError(
        'invalid_status',
        `Cannot restore from status: ${notification.status}`,
        { status: notification.status },
      ),
    )
  }
  return ok({
    ...notification,
    status: notification.readAt === null ? 'unread' : 'read',
    updatedAt: clock(),
  })
}
