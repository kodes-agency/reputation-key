// Feed notification surface — row-to-domain mapper for notification rows
// Extracted from notification.repository.ts to keep repository file focused on queries.

import { notifications } from '#/shared/db/schema/notification.schema'
import { assertLiteral } from '#/shared/domain/assert'
import {
  notificationId,
  organizationId as toOrgId,
  propertyId as toPropertyId,
  userId as toUserId,
} from '#/shared/domain/ids'
import {
  NOTIFICATION_RESOURCE_TYPES,
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationPriority,
  type NotificationResourceType,
  type NotificationStatus,
  type NotificationType,
} from '../../domain/notification-types'
import { parseNotificationPayload } from '../../domain/notification-payload'
import { withRepeatCount, withWaitAtNotice } from '../../domain/notification-policy'
import { NOTIFICATION_CATEGORIES } from '../../domain/notification-delivery-policy'

// ── Row type ───────────────────────────────────────────────────────

export type NotificationRow = typeof notifications.$inferSelect

// ── Mapper ─────────────────────────────────────────────────────────

// Single source: domain/notification-types.ts NOTIFICATION_TYPES.
const VALID_TYPES: readonly NotificationType[] = NOTIFICATION_TYPES

const VALID_PRIORITIES: readonly NotificationPriority[] = ['urgent', 'normal']
const VALID_STATUSES: readonly NotificationStatus[] = ['unread', 'read', 'dismissed']
// Single source: domain/notification-types.ts NOTIFICATION_RESOURCE_TYPES.
const VALID_RESOURCE_TYPES: readonly NotificationResourceType[] =
  NOTIFICATION_RESOURCE_TYPES

export const notificationFromRow = (row: NotificationRow): Notification => ({
  id: notificationId(row.id),
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  propertyId: row.propertyId === null ? null : toPropertyId(row.propertyId),
  // Fenced like every other enum column: migration 0070 retired the
  // `digest_summary` category, and a bare cast would have let a stale row walk
  // an impossible value into the domain instead of failing loudly.
  category: assertLiteral(row.category, NOTIFICATION_CATEGORIES, 'notification.category'),
  type: assertLiteral(row.type, VALID_TYPES, 'notification.type'),
  priority: assertLiteral(row.priority, VALID_PRIORITIES, 'notification.priority'),
  status: assertLiteral(row.status, VALID_STATUSES, 'notification.status'),
  resourceType: assertLiteral(
    row.resourceType,
    VALID_RESOURCE_TYPES,
    'notification.resourceType',
  ),
  resourceId: row.resourceId,
  eventId: row.eventId,
  title: row.title,
  body: row.body,
  // JSONB is untrusted on the way out: the column is written by this context
  // today, but legacy rows hold NULL and a hand-edited/older row can hold
  // anything. `parseNotificationPayload` drops every unrecognised key and
  // returns `{}` rather than null, so render never sees a surprise shape.
  // The repeat count comes from the column, never from the stored payload,
  // and a wait is measured to the row's latest event, the time it shows.
  payload: withWaitAtNotice(
    withRepeatCount(parseNotificationPayload(row.payload), row.coalescedCount),
    row.coalescedLatestAt ?? row.createdAt,
  ),
  coalescedCount: row.coalescedCount,
  coalescedLatestAt: row.coalescedLatestAt,
  resolvedAt: row.resolvedAt,
  readAt: row.readAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
