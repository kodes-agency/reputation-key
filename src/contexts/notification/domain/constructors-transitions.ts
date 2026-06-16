// Notification context — status transition constructors
// Per architecture: "Domain Returns Result<T, DomainError>. Never throws."

import { ok, err, type Result } from '#/shared/domain'
import type { Notification, NotificationEmail, EmailQueueStatus } from './types'
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

// ── Email status transitions ────────────────────────────────────────

// Shared guard + apply for email status transitions: validates the source
// status against an allow-list, then applies a patch at `now`.
const transitionEmail = (
  email: NotificationEmail,
  clock: () => Date,
  toStatus: EmailQueueStatus,
  validFrom: readonly EmailQueueStatus[],
  patch: (now: Date) => Partial<NotificationEmail>,
): Result<NotificationEmail, NotificationError> => {
  if (!validFrom.includes(email.status)) {
    return err(
      notificationError(
        'invalid_status',
        `Cannot mark email as ${toStatus} from status: ${email.status}`,
        { status: email.status },
      ),
    )
  }

  const now = clock()
  return ok({ ...email, ...patch(now), status: toStatus, updatedAt: now })
}

export const markEmailSent = (
  email: NotificationEmail,
  clock: () => Date,
): Result<NotificationEmail, NotificationError> => {
  if (email.status === 'sent') return ok(email) // Idempotent
  return transitionEmail(email, clock, 'sent', ['pending', 'failed'], (now) => ({
    sentAt: now,
  }))
}

export const markEmailFailed = (
  email: NotificationEmail,
  clock: () => Date,
): Result<NotificationEmail, NotificationError> =>
  transitionEmail(email, clock, 'failed', ['pending', 'failed'], (now) => ({
    failedAt: now,
    retryCount: email.retryCount + 1,
  }))

export const markEmailSkipped = (
  email: NotificationEmail,
  clock: () => Date,
): Result<NotificationEmail, NotificationError> =>
  transitionEmail(email, clock, 'skipped', ['pending'], () => ({}))
