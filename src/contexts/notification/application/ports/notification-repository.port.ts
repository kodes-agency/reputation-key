// Notification context — repository port for in-app notifications
// Per architecture: type alias + Readonly<{…}>, no classes.

import type { Notification } from '../../domain/types'
import type { NotificationId, UserId, OrganizationId } from '#/shared/domain/ids'

export type NotificationRepositoryPort = Readonly<{
  /** Upsert on conflict by idempotency key (userId + type + resourceId + eventId). */
  insert(notification: Notification): Promise<Notification>

  findById(id: NotificationId, orgId: OrganizationId): Promise<Notification | null>

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

  markRead(id: NotificationId, orgId: OrganizationId, readAt: Date): Promise<void>

  markAllRead(userId: UserId, orgId: OrganizationId): Promise<void>
}>
