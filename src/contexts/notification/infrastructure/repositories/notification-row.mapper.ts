// Notification context — row-to-domain mapper for notification rows
// Extracted from notification.repository.ts to keep repository file focused on queries.

import { notifications } from '#/shared/db/schema/notification.schema'
import {
  notificationId,
  userId as toUserId,
  organizationId as toOrgId,
} from '#/shared/domain/ids'
import type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationStatus,
  NotificationResourceType,
} from '../../domain/types'

// ── Row type ───────────────────────────────────────────────────────

export type NotificationRow = typeof notifications.$inferSelect

// ── Mapper ─────────────────────────────────────────────────────────

export const notificationFromRow = (row: NotificationRow): Notification => ({
  id: notificationId(row.id),
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  type: row.type as NotificationType,
  priority: row.priority as NotificationPriority,
  status: row.status as NotificationStatus,
  resourceType: row.resourceType as NotificationResourceType,
  resourceId: row.resourceId,
  eventId: row.eventId,
  title: row.title,
  body: row.body,
  readAt: row.readAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
