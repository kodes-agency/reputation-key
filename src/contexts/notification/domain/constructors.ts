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
import { isUrgent } from './types'

// ── Allowed values ──────────────────────────────────────────────────

export const ALLOWED_TYPES: ReadonlySet<NotificationType> = new Set([
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

export const ALLOWED_RESOURCE_TYPES: ReadonlySet<NotificationResourceType> = new Set([
  'inbox_item',
  'reply',
  'goal',
])

export const ALLOWED_STATUSES: ReadonlySet<NotificationStatus> = new Set([
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
