// Feed notification surface — repository port for in-app notifications
// Per architecture: type alias + Readonly<{…}>, no classes.
// Note: Implementations accept `string` for branded type params.
// TypeScript structural typing makes `string` assignable to branded types.
// Brands serve as documentation of intent, not runtime enforcement.

import type {
  Notification,
  NotificationStatus,
  NotificationType,
} from '../../domain/notification-types'
import type {
  NotificationId,
  OrganizationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type { NotificationListFilter } from '../notification-list-filter'
import type {
  NotificationFeedCursor,
  NotificationFeedHead,
  NotificationPage,
} from '../notification-page'

/** Whose feed, which filter, and how many rows a page may hold. */
export type NotificationFeedQuery = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  /**
   * The Properties the reader can currently access, or null for every
   * Property. Organization-scoped notices (no Property) are always visible.
   */
  visiblePropertyIds: ReadonlyArray<PropertyId> | null
  filter: NotificationListFilter
  limit: number
}>

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

  /**
   * Read the first page, the exact unread count and the filter's share of it
   * from one repeatable-read PostgreSQL snapshot. The returned watermark
   * identifies that shared read. All honour `visiblePropertyIds`, so the badge
   * never counts a row the reader cannot see.
   */
  readFeedHead(query: NotificationFeedQuery): Promise<NotificationFeedHead>

  /**
   * One keyset page in feed order (latest activity DESC, id DESC), strictly
   * after `before`. Rows arriving or leaving above the cursor cannot shift it.
   */
  readFeedPage(
    query: NotificationFeedQuery & Readonly<{ before: NotificationFeedCursor | null }>,
  ): Promise<NotificationPage>

  /**
   * Everyone who holds a notice of this type about this resource, whatever
   * its read state. The evidence of who was told something, so the notice
   * that closes it can reach the same people (I5.3).
   */
  findRecipientsOfNotice(
    orgId: OrganizationId,
    type: NotificationType,
    resourceId: string,
  ): Promise<ReadonlyArray<UserId>>

  /**
   * Stamp `resolvedAt` on every recipient's still-waiting notice of these
   * types about one resource, and answer with the rows it settled so their
   * queued email can be cancelled. Read is not resolved: the status is left
   * alone, so nothing pretends the reader looked. A row already resolved is
   * left as it stands, which makes a redelivered settling fact a no-op.
   */
  settleUnreadForResource(
    input: Readonly<{
      organizationId: OrganizationId
      types: ReadonlyArray<NotificationType>
      resourceId: string
      resolvedAt: Date
    }>,
  ): Promise<ReadonlyArray<NotificationId>>

  markRead(
    id: NotificationId,
    userId: UserId,
    orgId: OrganizationId,
    readAt: Date,
    updatedAt: Date,
  ): Promise<void>

  /** Mark read every unread row the filter holds (the reader's tab), no more. */
  markAllRead(
    userId: UserId,
    orgId: OrganizationId,
    filter: NotificationListFilter,
    updatedAt: Date,
  ): Promise<void>

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
   * cross a tenant, and to a row that is still unread. Returns false — and
   * writes nothing — when the row was read or dismissed after it was looked
   * up; the caller then owes the event a fresh unread row.
   */
  refreshUnread(notification: Notification): Promise<boolean>

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
