// Notification context — repository port for in-app notifications
// Per architecture: type alias + Readonly<{…}>, no classes.
// Note: Implementations accept `string` for branded type params.
// TypeScript structural typing makes `string` assignable to branded types.
// Brands serve as documentation of intent, not runtime enforcement.

import type {
  Notification,
  NotificationStatus,
  NotificationType,
} from '../../domain/types'
import type { NotificationId, UserId, OrganizationId } from '#/shared/domain/ids'

export type NotificationRepositoryPort = Readonly<{
  /** Upsert on conflict by idempotency key (userId + type + resourceId + eventId). */
  insert(notification: Notification): Promise<Notification>

  findById(id: NotificationId, orgId: OrganizationId): Promise<Notification | null>

  /** Batch-fetch by ids within an org. Returns a Map keyed by notification id. */
  findByIds(
    ids: readonly NotificationId[],
    orgId: OrganizationId,
  ): Promise<Map<string, Notification>>

  findUnreadByUser(
    userId: UserId,
    orgId: OrganizationId,
    limit: number,
    offset: number,
  ): Promise<readonly Notification[]>

  countUnreadByUser(userId: UserId, orgId: OrganizationId): Promise<number>

  findByUser(
    userId: UserId,
    orgId: OrganizationId,
    limit: number,
    offset: number,
  ): Promise<readonly Notification[]>

  markRead(
    id: NotificationId,
    userId: UserId,
    orgId: OrganizationId,
    readAt: Date,
    updatedAt: Date,
  ): Promise<void>

  markAllRead(userId: UserId, orgId: OrganizationId, updatedAt: Date): Promise<void>

  /** Find a user's existing unread notification for a type+resource (dedup). */
  findUnreadByUserTypeResource(
    userId: UserId,
    orgId: OrganizationId,
    type: NotificationType,
    resourceId: string,
  ): Promise<Notification | null>

  /** Bump an existing unread notification (refresh title/body/updatedAt). */
  refreshUnread(
    id: NotificationId,
    userId: UserId,
    orgId: OrganizationId,
    title: string,
    body: string | null,
    updatedAt: Date,
  ): Promise<void>

  /** Dismiss every non-dismissed notification for the user (Clear-all). */
  markAllDismissed(userId: UserId, orgId: OrganizationId, updatedAt: Date): Promise<void>

  updateStatus(
    id: NotificationId,
    userId: UserId,
    orgId: OrganizationId,
    status: NotificationStatus,
    updatedAt: Date,
  ): Promise<void>
}>
