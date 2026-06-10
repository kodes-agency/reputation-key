// Notification context — status transition constructors
// Per architecture: "Domain Returns Result<T, DomainError>. Never throws."

import { ok, err, type Result } from '#/shared/domain'
import type { Notification, NotificationEmail } from './types'
import { notificationError, type NotificationError } from './errors'
import { ALLOWED_STATUSES } from './constructors'

// ── Notification status transitions ─────────────────────────────────

export const markNotificationRead = (
  notification: Notification,
  clock: () => Date,
): Result<Notification, NotificationError> => {
  if (notification.status === 'read') {
    return ok(notification) // Idempotent — already read
  }

  if (!ALLOWED_STATUSES.has(notification.status)) {
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

// ── Email status transitions ────────────────────────────────────────

export const markEmailSent = (
  email: NotificationEmail,
  clock: () => Date,
): Result<NotificationEmail, NotificationError> => {
  if (email.status === 'sent') {
    return ok(email) // Idempotent
  }

  const now = clock()
  return ok({
    ...email,
    status: 'sent',
    sentAt: now,
    updatedAt: now,
  })
}

export const markEmailFailed = (
  email: NotificationEmail,
  clock: () => Date,
): Result<NotificationEmail, NotificationError> => {
  if (email.status !== 'pending' && email.status !== 'failed') {
    return err(
      notificationError(
        'invalid_status',
        `Cannot mark email as failed from status: ${email.status}`,
        { status: email.status },
      ),
    )
  }

  const now = clock()
  return ok({
    ...email,
    status: 'failed',
    failedAt: now,
    retryCount: email.retryCount + 1,
    updatedAt: now,
  })
}

export const markEmailSkipped = (
  email: NotificationEmail,
  clock: () => Date,
): Result<NotificationEmail, NotificationError> => {
  if (email.status !== 'pending') {
    return err(
      notificationError(
        'invalid_status',
        `Cannot mark email as skipped from status: ${email.status}`,
        { status: email.status },
      ),
    )
  }

  const now = clock()
  return ok({
    ...email,
    status: 'skipped',
    updatedAt: now,
  })
}
