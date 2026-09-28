import type { Notification } from '../domain/notification-types'

/**
 * A notification as the browser receives it: exactly what the in-app surfaces
 * render or act on. Rows render from `type` + `payload` (ADR 0046 r.8), so the
 * frozen pre-template title/body snapshot stays on the server, as do the
 * durable-delivery correlation id (withheld even from the Organization
 * export), `updatedAt`, and the recipient and Organization ids the session
 * already implies.
 */
export type NotificationView = Pick<
  Notification,
  | 'id'
  | 'type'
  | 'category'
  | 'priority'
  | 'status'
  | 'propertyId'
  | 'resourceType'
  | 'resourceId'
  | 'payload'
  | 'coalescedCount'
  | 'coalescedLatestAt'
  | 'resolvedAt'
  | 'readAt'
  | 'createdAt'
>

/**
 * Still waiting on its reader: what the badge and the Unread tab count. A row
 * whose work was settled upstream keeps its unread status (read is not
 * resolved) but has stopped asking. The browser's twin of the repository's
 * `stillWaiting`, so an optimistic count or a staleness check never counts a
 * row the server does not.
 */
export const isStillWaiting = (
  notification: Pick<NotificationView, 'status' | 'resolvedAt'>,
): boolean => notification.status === 'unread' && notification.resolvedAt === null

/** Copies field by field, so a column added to the domain row never reaches the wire by default. */
export function toNotificationView(notification: Notification): NotificationView {
  return {
    id: notification.id,
    type: notification.type,
    category: notification.category,
    priority: notification.priority,
    status: notification.status,
    propertyId: notification.propertyId,
    resourceType: notification.resourceType,
    resourceId: notification.resourceId,
    payload: notification.payload,
    coalescedCount: notification.coalescedCount,
    coalescedLatestAt: notification.coalescedLatestAt,
    resolvedAt: notification.resolvedAt,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  }
}
