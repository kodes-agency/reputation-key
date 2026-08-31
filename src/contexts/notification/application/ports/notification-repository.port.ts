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
import type {
  NotificationId,
  OrganizationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type { NotificationListFilter } from '../notification-list-filter'
import type { NotificationFeedHead } from '../notification-page'

export type NotificationRepositoryPort = Readonly<{
  /**
   * Insert the unread row. Conflicts resolve on the ADR 0046 r.2 partial
   * unique key (user, type, resource) WHERE status = 'unread' — the row's
   * rendered copy and payload win.
   */
  insert(notification: Notification): Promise<Notification>

  findById(id: NotificationId, orgId: OrganizationId): Promise<Notification | null>
  findByIdForProperty(
    id: NotificationId,
    orgId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<Notification | null>

  /** Batch-fetch by ids within an org. Returns a Map keyed by notification id. */
  findByIds(
    ids: readonly NotificationId[],
    orgId: OrganizationId,
  ): Promise<Map<string, Notification>>
  findByIdsForProperty(
    ids: readonly NotificationId[],
    orgId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<Map<string, Notification>>

  findUnreadByUser(
    userId: UserId,
    orgId: OrganizationId,
    limit: number,
    offset: number,
  ): Promise<readonly Notification[]>

  /**
   * Read the offset-zero page and exact unread count from one repeatable-read
   * PostgreSQL snapshot. The returned watermark identifies that shared read.
   */
  readFeedHead(
    userId: UserId,
    orgId: OrganizationId,
    limit: number,
    filter: NotificationListFilter,
  ): Promise<NotificationFeedHead>

  findByUser(
    userId: UserId,
    orgId: OrganizationId,
    limit: number,
    offset: number,
    filter: NotificationListFilter,
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
    propertyId: PropertyId | null,
    type: NotificationType,
    resourceId: string,
  ): Promise<Notification | null>

  /**
   * Persist an ADR 0046 r.2 coalescing bump: the already-coalesced entity
   * (title/body/payload/count/latest/updatedAt) produced by
   * `applyCoalescence`. Scoped to the owning user + org so a bump can never
   * cross a tenant.
   */
  refreshUnread(notification: Notification): Promise<void>

  /**
   * Flip a read row back to unread. Returns null — never throws — when the
   * flip would collide with the partial unread-uniqueness key, i.e. another
   * unread row already represents this (user, type, resource), or when the row
   * is not the user's / not read.
   */
  markUnread(
    id: NotificationId,
    userId: UserId,
    orgId: OrganizationId,
    updatedAt: Date,
  ): Promise<Notification | null>

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
