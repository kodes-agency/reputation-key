// Notification context — entity constructor: createNotification
// Per architecture: "Domain Returns Result<T, DomainError>. Never throws."
//
// Callers pass FACTS (`payload`), never sentences. `title`/`body` are derived
// here from `renderNotification(type, payload)` so the stored snapshot can
// never disagree with what the in-app row, the email, and the digest render
// (ADR 0046 r.8). There is exactly one place notification copy exists:
// domain/notification-templates.ts.

import { ok, err, type Result } from '#/shared/domain'
import type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationResourceType,
} from './types'
import type {
  NotificationId,
  UserId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'
import { notificationError, type NotificationError } from './errors'
import { isUrgent, NOTIFICATION_TYPES } from './types'
import { classifyNotification } from './notification-delivery-policy'
import {
  parseNotificationPayload,
  type NotificationPayload,
} from './notification-payload'
import { renderNotification } from './notification-templates'

// ── Allowed values ──────────────────────────────────────────────────

const ALLOWED_TYPES: ReadonlySet<NotificationType> = new Set(NOTIFICATION_TYPES)

const ALLOWED_RESOURCE_TYPES: ReadonlySet<NotificationResourceType> = new Set([
  'inbox_item',
  'reply',
  'goal',
  'badge',
])

// ── Create notification ─────────────────────────────────────────────

export type CreateNotificationInput = Readonly<{
  id: NotificationId
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId
  type: NotificationType
  resourceType: NotificationResourceType
  resourceId: string
  eventId: string
  /**
   * Content-free render metadata (ADR 0046 r.8). Untrusted on the way in — it
   * arrives over BullMQ — so it goes through `parseNotificationPayload`, which
   * drops every unrecognised key. Omitted entirely for a bare notification;
   * the templates degrade to the short sentence.
   */
  payload?: unknown
}>

export const createNotification = (
  input: CreateNotificationInput,
  clock: () => Date,
): Result<Notification, NotificationError> => {
  if (!input.userId) {
    return err(notificationError('invalid_input', 'userId is required'))
  }
  if (!input.propertyId) {
    return err(notificationError('invalid_input', 'propertyId is required'))
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

  // The old `invalid_title` guard is gone: a title is no longer supplied, it is
  // rendered, and every renderer returns a non-empty title for an EMPTY
  // payload. What still needs guarding is the resource identity the deep link
  // and the coalescing key are built from.
  if (!input.resourceId.trim()) {
    return err(notificationError('invalid_resource_id', 'ResourceId must not be empty'))
  }
  if (!input.eventId.trim()) {
    return err(notificationError('invalid_event_id', 'EventId must not be empty'))
  }

  const now = clock()
  const priority: NotificationPriority = isUrgent(input.type) ? 'urgent' : 'normal'
  const payload: NotificationPayload = parseNotificationPayload(input.payload)
  const rendered = renderNotification(input.type, payload)

  return ok({
    id: input.id,
    userId: input.userId,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    type: input.type,
    category: classifyNotification(input.type),
    priority,
    status: 'unread',
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    eventId: input.eventId,
    title: rendered.title,
    // An empty supporting sentence is stored as NULL, not '' — the column is
    // nullable and a blank string would render as an empty second line.
    body: rendered.body === '' ? null : rendered.body,
    payload,
    coalescedCount: 1,
    coalescedLatestAt: null,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  })
}
