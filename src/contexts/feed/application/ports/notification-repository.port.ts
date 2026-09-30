// Feed notification surface — repository port for in-app notifications
// Per architecture: type alias + Readonly<{…}>, no classes.
// Note: Implementations accept `string` for branded type params.
// TypeScript structural typing makes `string` assignable to branded types.
// Brands serve as documentation of intent, not runtime enforcement.

import type {
  Notification,
  NotificationCategory,
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

/**
 * Whose feed a bulk action ("Mark all read", "Clear all") changes: the rows
 * that reader's feed shows now, as a read of it would resolve them.
 */
export type NotificationFeedScope = Omit<NotificationFeedQuery, 'filter' | 'limit'>

export type NotificationRepositoryPort = Readonly<{
  /**
   * Insert the unread row. Conflicts resolve on the ADR 0046 r.2 partial
   * unique key (user, type, resource) over rows still waiting — unread and
   * unsettled — so the row's rendered copy and payload win, and a settled row
   * is never revived.
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
   *
   * `arrivedSince` bounds it to notices whose latest arrival is at or after
   * that moment: an item escalated twice keeps the first escalation's rows,
   * and the people told only about that one were not told about this one.
   * `null` reads every notice ever held.
   */
  findRecipientsOfNotice(
    orgId: OrganizationId,
    type: NotificationType,
    resourceId: string,
    arrivedSince: Date | null,
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

  /**
   * The same, for ONE reader: a notice just written that takes over their own
   * earlier notices about the resource (`SUPERSEDED_FOR_READER`). Nobody
   * else's rows about it change.
   */
  settleUnreadForReader(
    input: Readonly<{
      organizationId: OrganizationId
      userId: UserId
      types: ReadonlyArray<NotificationType>
      /** Only rows of these categories; absent or null for any. */
      categories?: ReadonlyArray<NotificationCategory> | null
      /** Only rows still waiting in the app, never an email-only anchor. */
      inAppOnly?: boolean
      resourceId: string
      resolvedAt: Date
    }>,
  ): Promise<ReadonlyArray<NotificationId>>

  /**
   * The same, for every resource on one Property: the settling fact finishes
   * all of a Property's work at once (it was archived).
   */
  settleUnreadForProperty(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      types: ReadonlyArray<NotificationType>
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
    scope: NotificationFeedScope,
    filter: NotificationListFilter,
    updatedAt: Date,
  ): Promise<void>

  /**
   * Find a user's notification for a type+resource that is still waiting on
   * them — unread and unsettled (dedup). A settled row is done, so it is not
   * one to coalesce into.
   */
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

  /** Dismiss every notification the reader's feed shows (Clear-all). */
  markAllDismissed(scope: NotificationFeedScope, updatedAt: Date): Promise<void>

  updateStatus(
    id: NotificationId,
    userId: UserId,
    orgId: OrganizationId,
    status: NotificationStatus,
    updatedAt: Date,
  ): Promise<void>
}>
