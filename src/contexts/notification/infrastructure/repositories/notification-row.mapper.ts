// Notification context — row-to-domain mapper for notification rows
// Extracted from notification.repository.ts to keep repository file focused on queries.

import { notifications } from '#/shared/db/schema/notification.schema'
import { assertLiteral } from '#/shared/domain/assert'
import {
  notificationId,
  userId as toUserId,
  organizationId as toOrgId,
} from '#/shared/domain/ids'
import {
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationType,
  type NotificationPriority,
  type NotificationStatus,
  type NotificationResourceType,
} from '../../domain/types'

// ── Row type ───────────────────────────────────────────────────────

export type NotificationRow = typeof notifications.$inferSelect

// ── Mapper ─────────────────────────────────────────────────────────

// Single source: domain/types.ts NOTIFICATION_TYPES.
const VALID_TYPES: readonly NotificationType[] = NOTIFICATION_TYPES

const VALID_PRIORITIES: readonly NotificationPriority[] = ['urgent', 'normal']
const VALID_STATUSES: readonly NotificationStatus[] = ['unread', 'read', 'dismissed']
const VALID_RESOURCE_TYPES: readonly NotificationResourceType[] = [
  'inbox_item',
  'reply',
  'goal',
  'badge',
]

export const notificationFromRow = (row: NotificationRow): Notification => ({
  id: notificationId(row.id),
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
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
  readAt: row.readAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
