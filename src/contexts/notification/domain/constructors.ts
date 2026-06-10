// Notification context — entity constructors
// Per architecture: "Domain Returns Result<T, DomainError>. Never throws."

import { ok, err, type Result } from '#/shared/domain'
import type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationResourceType,
  NotificationStatus,
  NotificationEmail,
  NotificationPreference,
} from './types'
import type {
  NotificationId,
  NotificationEmailId,
  NotificationPreferenceId,
  UserId,
  OrganizationId,
} from '#/shared/domain/ids'
import { notificationError, type NotificationError } from './errors'
import { isUrgent } from './types'

// ── Allowed values ──────────────────────────────────────────────────

const ALLOWED_TYPES: ReadonlySet<NotificationType> = new Set([
  'review.created',
  'feedback.created',
  'reply.pending_approval',
  'reply.approved',
  'reply.rejected',
  'reply.published',
  'reply.publish_failed',
  'inbox.escalated',
  'inbox.assigned',
  'inbox_note.added',
  'goal.completed',
])

const ALLOWED_RESOURCE_TYPES: ReadonlySet<NotificationResourceType> = new Set([
  'inbox_item',
  'reply',
  'goal',
])

const ALLOWED_STATUSES: ReadonlySet<NotificationStatus> = new Set([
  'unread',
  'read',
  'dismissed',
])

// ── Create notification ─────────────────────────────────────────────

export type CreateNotificationInput = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  type: NotificationType
  resourceType: NotificationResourceType
  resourceId: string
  eventId: string
  title: string
  body: string | null
}>

export const createNotification = (
  input: CreateNotificationInput,
  clock: () => Date,
): Result<Notification, NotificationError> => {
  if (!ALLOWED_TYPES.has(input.type)) {
    return err(
      notificationError('invalid_type', `Invalid notification type: ${input.type}`, {
        type: input.type,
      }),
    )
  }

  if (!ALLOWED_RESOURCE_TYPES.has(input.resourceType)) {
    return err(
      notificationError(
        'invalid_resource_type',
        `Invalid resource type: ${input.resourceType}`,
        { resourceType: input.resourceType },
      ),
    )
  }

  const now = clock()
  const priority: NotificationPriority = isUrgent(input.type) ? 'urgent' : 'normal'

  return ok({
    id: '' as unknown as NotificationId,
    userId: input.userId,
    organizationId: input.organizationId,
    type: input.type,
    priority,
    status: 'unread',
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    eventId: input.eventId,
    title: input.title,
    body: input.body,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  })
}

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

// ── Create/update preference ────────────────────────────────────────

export type CreateNotificationPreferenceInput = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  type: NotificationType
  emailEnabled: boolean
  inAppEnabled: boolean
}>

export const createNotificationPreference = (
  input: CreateNotificationPreferenceInput,
  clock: () => Date,
): Result<NotificationPreference, NotificationError> => {
  if (!ALLOWED_TYPES.has(input.type)) {
    return err(
      notificationError('invalid_type', `Invalid notification type: ${input.type}`, {
        type: input.type,
      }),
    )
  }

  const now = clock()
  return ok({
    id: '' as unknown as NotificationPreferenceId,
    userId: input.userId,
    organizationId: input.organizationId,
    type: input.type,
    emailEnabled: input.emailEnabled,
    inAppEnabled: input.inAppEnabled,
    createdAt: now,
    updatedAt: now,
  })
}

// ── Status transitions ──────────────────────────────────────────────

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
  const now = clock()
  return ok({
    ...email,
    status: 'skipped',
    updatedAt: now,
  })
}
