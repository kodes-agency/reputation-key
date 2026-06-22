// Notification context — entity constructor: createNotification
// Per architecture: "Domain Returns Result<T, DomainError>. Never throws."

import { ok, err, type Result } from '#/shared/domain'
import type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationResourceType,
  NotificationStatus,
} from './types'
import type { NotificationId, UserId, OrganizationId } from '#/shared/domain/ids'
import { notificationError, type NotificationError } from './errors'
import { isUrgent, NOTIFICATION_TYPES } from './types'

// ── Allowed values ──────────────────────────────────────────────────

export const ALLOWED_TYPES: ReadonlySet<NotificationType> = new Set(NOTIFICATION_TYPES)

export const ALLOWED_RESOURCE_TYPES: ReadonlySet<NotificationResourceType> = new Set([
  'inbox_item',
  'reply',
  'goal',
  'badge',
])

export const ALLOWED_STATUSES: ReadonlySet<NotificationStatus> = new Set([
  'unread',
  'read',
  'dismissed',
])

// ── Create notification ─────────────────────────────────────────────

export type CreateNotificationInput = Readonly<{
  id: NotificationId
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
  if (!input.userId) {
    return err(notificationError('invalid_input', 'userId is required'))
  }

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

  if (!input.title.trim()) {
    return err(notificationError('invalid_title', 'Title must not be empty'))
  }
  if (!input.resourceId.trim()) {
    return err(notificationError('invalid_resource_id', 'ResourceId must not be empty'))
  }
  if (!input.eventId.trim()) {
    return err(notificationError('invalid_event_id', 'EventId must not be empty'))
  }

  const now = clock()
  const priority: NotificationPriority = isUrgent(input.type) ? 'urgent' : 'normal'

  return ok({
    id: input.id,
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
