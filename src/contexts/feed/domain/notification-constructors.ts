// Feed notification surface — entity constructor: createNotification
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
} from './notification-types'
import type {
  NotificationId,
  UserId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'
import { notificationError, type NotificationError } from './notification-errors'
import {
  isUrgent,
  NOTIFICATION_RESOURCE_TYPES,
  NOTIFICATION_TYPES,
} from './notification-types'
import {
  classifyNotification,
  notificationScopeForType,
  ORGANIZATION_INFORMATIONAL_TYPES,
} from './notification-delivery-policy'
import {
  parseNotificationPayload,
  type NotificationPayload,
} from './notification-payload'
import { renderNotification } from './notification-templates'

// ── Allowed values ──────────────────────────────────────────────────

const ALLOWED_TYPES: ReadonlySet<NotificationType> = new Set(NOTIFICATION_TYPES)

const ALLOWED_RESOURCE_TYPES: ReadonlySet<NotificationResourceType> = new Set(
  NOTIFICATION_RESOURCE_TYPES,
)

/**
 * The one resource each Organization-scoped family may point at. Mandatory
 * account notices point at the Organization; an informational notice points at
 * the record it is about, so its link and its coalescing key are that record.
 */
const organizationResourceFor = (type: NotificationType): NotificationResourceType =>
  ORGANIZATION_INFORMATIONAL_TYPES.has(type) ? 'beta_feedback_report' : 'organization'

// ── Create notification ─────────────────────────────────────────────

export type CreateNotificationInput = Readonly<{
  id: NotificationId
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId | null
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

/**
 * The scope rules the database also enforces (`notifications_mandatory_scope_check`,
 * ADR 0046 / ADR 0059), as one unit: which Property and which resource each
 * family may name. Returns the refusal, or null when the shape is admitted.
 */
function scopeViolation(
  input: Pick<CreateNotificationInput, 'type' | 'propertyId' | 'resourceType'>,
): string | null {
  if (notificationScopeForType(input.type) === 'organization') {
    const informational = ORGANIZATION_INFORMATIONAL_TYPES.has(input.type)
    if (input.propertyId !== null) {
      return informational
        ? 'Report-outcome notifications are Organization-scoped and cannot name a Property'
        : 'Mandatory notifications must use Organization scope'
    }
    if (input.resourceType !== organizationResourceFor(input.type)) {
      return informational
        ? 'Report-outcome notifications must point at the report'
        : 'Mandatory notifications must use an Organization resource'
    }
    return null
  }
  if (!input.propertyId) return 'propertyId is required'
  if (input.resourceType === 'beta_feedback_report') {
    return 'Property notifications cannot point at a beta report'
  }
  if (input.resourceType === 'organization') {
    return 'Property notifications cannot use an Organization resource'
  }
  return null
}

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

  const scopeError = scopeViolation(input)
  if (scopeError) return err(notificationError('invalid_input', scopeError))

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
