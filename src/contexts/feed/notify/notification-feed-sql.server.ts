// Feed notification surface — the SQL conditions and keyset reads the
// notification rows and the feed share.

import { and, eq, desc, inArray, isNull, ne, not, or, sql, type SQL } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import { notificationFromRow } from '../infrastructure/repositories/notification-row.mapper'
import { ACTIONABLE_NOTIFICATION_TYPES } from '../domain/notification-actionable'
import { NOTIFICATION_CATEGORIES } from '../domain/notification-delivery-policy'
import { getDefaultEnabled } from '../domain/notification-policy'
import type { NotificationListFilter } from '../application/notification-list-filter'
import {
  type NotificationFeedCursor,
  type NotificationFeedRow,
} from '../application/notification-page'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'

// The versioned default's in-app answer for the row's category, as SQL: on for
// every category but those the policy keeps off (arrivals, D4). Read from the
// policy, so a category turned off by default can never be listed by a
// fallback that still assumed "on for every category".
const IN_APP_OFF_BY_DEFAULT = NOTIFICATION_CATEGORIES.filter(
  (category) => !getDefaultEnabled(category, 'in_app'),
)
const inAppByDefault =
  IN_APP_OFF_BY_DEFAULT.length === 0
    ? sql`true`
    : sql`notifications.category NOT IN (${sql.join(
        IN_APP_OFF_BY_DEFAULT.map((category) => sql`${category}`),
        sql`, `,
      )})`

// Email-only notifications remain durable anchors, but are excluded from the
// in-app list while the reader has in-app off for that Property and category.
// It resolves exactly as delivery does (resolveCategoryPreference): the
// Property's own row, else the person's category default, else the versioned
// default (`inAppByDefault`). "Apply to all my properties" wrote the default
// and deleted the Property rows, so reading the Property table alone brought
// every muted row back; and a fallback of "on" listed every email-only
// arrival anchor of a reader who only ever chose arrivals email. Organization
// notices ignore preferences on delivery, so they are never hidden here.
//
// A Low ratings email-only anchor is hidden outright: whether a rating was low
// enough for the app was the reader's threshold at the moment it was routed,
// and the rating is not kept (ADR 0031), so no later read can re-derive it —
// the one category whose anchors a switch cannot tell apart. Read rows keep
// their read time; only an anchor has none.
export const notOptedOutInApp = sql`(
NOT (
  notifications.category = 'low_ratings'
  AND notifications.status = 'read'
  AND notifications.read_at IS NULL
) AND NOT (
  notifications.property_id IS NOT NULL
  AND notifications.category NOT IN ('mandatory', 'urgent_operational')
  AND NOT COALESCE(
    (SELECT enabled FROM notification_preferences
      WHERE user_id = notifications.user_id
        AND organization_id = notifications.organization_id
        AND property_id = notifications.property_id
        AND category = notifications.category
        AND channel = 'in_app'),
    (SELECT p.enabled FROM notification_preferences p
      WHERE p.user_id = notifications.user_id
        AND p.organization_id = notifications.organization_id
        AND p.property_id IS NULL
        AND p.category = notifications.category
        AND p.channel = 'in_app'
        AND NOT EXISTS (
          SELECT 1 FROM notification_category_defaults d
          WHERE d.user_id = p.user_id
            AND d.organization_id = p.organization_id
            AND d.category = p.category
            AND d.channel = p.channel
            AND d.updated_at > p.updated_at)),
    (SELECT enabled FROM notification_category_defaults
      WHERE user_id = notifications.user_id
        AND organization_id = notifications.organization_id
        AND category = notifications.category
        AND channel = 'in_app'),
    ${inAppByDefault}
  )
)
)`

// Latest activity: a coalesced row sorts by its newest absorbed event, so a
// re-fired alert rises to the top instead of keeping its original slot while
// its timestamp says "just now". Must stay textually identical to the
// expression in notifications_feed_activity_idx, or every poll sorts again.
const lastActivityAt = sql`COALESCE(${notifications.coalescedLatestAt}, ${notifications.createdAt})`

// The cursor half of the keyset: the latest-activity instant as fixed-width
// UTC text with microseconds. A JS Date keeps only milliseconds, so a cursor
// built from one could split two rows that share a millisecond.
const lastActivityCursorAt = sql<string>`to_char(${lastActivityAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** The database client, or the transaction a notice is written on. */
export type NotificationDb = Database

/** Whose feed, which filter, and how many rows a page may hold. */
export type NotificationFeedQuery = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  /**
   * The Properties the reader can currently access, or null for every
   * Property. Organization-scoped notices (no Property) are always visible.
   */
  visiblePropertyIds: ReadonlyArray<PropertyId> | null
  /**
   * One Property's notices only (the page's Property filter); absent or null
   * reads the whole feed. A filtered read leaves out Organization-scoped
   * notices, and a Property the reader cannot access reads as empty.
   */
  propertyId?: PropertyId | null
  filter: NotificationListFilter
  limit: number
}>

/**
 * Whose feed a bulk action ("Mark all read", "Clear all") changes: the rows
 * that reader's feed shows now, as a read of it would resolve them.
 */
export type NotificationFeedScope = Omit<NotificationFeedQuery, 'filter' | 'limit'>

// A Property notice is shown only while the reader can still access that
// Property: access can end after delivery (a revoked or expired grant), and
// the rows must not outlive it in the feed or the badge. Organization-scoped
// notices have no Property and are never gated. Undefined: no restriction.
export const withinVisibleProperties = (
  visiblePropertyIds: ReadonlyArray<string> | null,
): SQL | undefined => {
  if (visiblePropertyIds === null) return undefined
  if (visiblePropertyIds.length === 0) return isNull(notifications.propertyId)
  return or(
    isNull(notifications.propertyId),
    inArray(notifications.propertyId, [...visiblePropertyIds]),
  )
}

// What "unread" means to the bell and to the Unread tab: still waiting on the
// reader. A row whose work was settled upstream keeps its unread status — read
// is not resolved — but stops asking, so it leaves the count and the tab and
// stays in the feed under its "Done" marker.
export const stillWaiting: SQL = and(
  eq(notifications.status, 'unread'),
  isNull(notifications.resolvedAt),
)!

// What a settling fact retires: every row still waiting on its reader, plus
// an email-only recipient's anchor, which is stored read but was never read
// (`isEmailOnlyAnchor`). Its queued email is still owed until the work is
// done, so settlement has to reach it to cancel that email.
export const awaitingSettlement: SQL = and(
  isNull(notifications.resolvedAt),
  or(
    eq(notifications.status, 'unread'),
    and(eq(notifications.status, 'read'), isNull(notifications.readAt)),
  ),
)!

// Work still waiting on its reader: an actionable notice (the types a settling
// fact can retire) that is unread and unsettled. The bell leads with these and
// counts only these (D2); everything else is an update.
const needsYou: SQL = and(
  stillWaiting,
  inArray(notifications.type, [...ACTIONABLE_NOTIFICATION_TYPES]),
)!

// The page's Property filter: one Property's notices. It is always ANDed with
// `withinVisibleProperties`, so a Property the reader can no longer access
// reads as empty instead of showing its rows, and Organization-scoped notices
// (no Property) are left out. Undefined: the whole feed.
export const inPropertyFilter = (
  propertyId: string | null | undefined,
): SQL | undefined => (propertyId ? eq(notifications.propertyId, propertyId) : undefined)

// What a feed filter adds to "the reader's notices": work waiting on them or
// everything else, the unread status, the urgent priority flag (any category),
// or one category. `all` adds nothing. Shared by the feed read, its filter's
// unread count and the filter-scoped "Mark all read", so the three can never
// disagree about a tab's rows.
export const feedFilterCondition = (filter: NotificationListFilter): SQL | undefined => {
  if (filter === 'all') return undefined
  if (filter === 'needs_you') return needsYou
  if (filter === 'updates') return not(needsYou)
  if (filter === 'unread') return stillWaiting
  if (filter === 'urgent') return eq(notifications.priority, 'urgent')
  return eq(notifications.category, filter)
}

export type NotificationFeedPageQuery = NotificationFeedQuery &
  Readonly<{
    /** Continue strictly after this position; null reads from the top. */
    before: NotificationFeedCursor | null
  }>

// Keyset read of a user's visible notifications, newest activity first with id
// as the tiebreak so rows sharing an instant keep one order. A page continues
// strictly after the previous page's last row, so rows arriving above it or
// leaving above it can neither shift it nor make it skip a row.
// The filter is applied BEFORE the limit so every returned page belongs to
// the requested feed. Dismissed rows are always hidden, not deleted.
// Reads `limit + 1` rows: the extra one is has-more evidence for the page.
export const selectFeedRows = (
  db: Database | Tx,
  query: NotificationFeedPageQuery,
): Promise<NotificationFeedRow[]> => {
  const conditions = [
    eq(notifications.userId, query.userId),
    eq(notifications.organizationId, query.organizationId),
    notOptedOutInApp,
    withinVisibleProperties(query.visiblePropertyIds),
    inPropertyFilter(query.propertyId),
    ne(notifications.status, 'dismissed'),
    feedFilterCondition(query.filter),
  ]
  if (query.before) {
    conditions.push(
      sql`(${lastActivityAt}, ${notifications.id}) < (${query.before.at}::timestamptz, ${query.before.id}::uuid)`,
    )
  }
  return db
    .select({ row: notifications, cursorAt: lastActivityCursorAt })
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(lastActivityAt), desc(notifications.id))
    .limit(query.limit + 1)
    .then((rows) =>
      rows.map(({ row, cursorAt }) => ({
        notification: notificationFromRow(row),
        cursor: { at: cursorAt, id: row.id },
      })),
    )
}

/**
 * The reader's visible unread rows, and how many of them the head's filter
 * holds (the rows that filter's "Mark all read" would change). One scan.
 */
export const countVisibleUnread = async (
  db: Database | Tx,
  query: NotificationFeedQuery,
): Promise<Readonly<{ unreadCount: number; filterUnreadCount: number }>> => {
  const inFilter = feedFilterCondition(query.filter) ?? sql`true`
  const rows = await db
    .select({
      unreadCount: sql<number>`count(*)::int`,
      filterUnreadCount: sql<number>`(count(*) FILTER (WHERE ${inFilter}))::int`,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, query.userId),
        eq(notifications.organizationId, query.organizationId),
        stillWaiting,
        notOptedOutInApp,
        withinVisibleProperties(query.visiblePropertyIds),
        inPropertyFilter(query.propertyId),
      ),
    )

  return rows[0]!
}

/**
 * A row may become unread again only while no other row waits under its
 * (user, type, resource) unread key, ADR 0046 r.2's partial unique key, or
 * when it is settled, which that key does not cover. Mark-unread and a
 * dismissal's Undo both pass through it. The sibling is looked for in the
 * row's own Organization.
 */
export const mayBecomeUnread = (userId: string) =>
  sql`(notifications.resolved_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM notifications AS unread_sibling
     WHERE unread_sibling.organization_id = notifications.organization_id
       AND unread_sibling.user_id = ${userId}
       AND unread_sibling.type = notifications.type
       AND unread_sibling.resource_id = notifications.resource_id
       AND unread_sibling.status = 'unread'
       AND unread_sibling.resolved_at IS NULL
  ))`
