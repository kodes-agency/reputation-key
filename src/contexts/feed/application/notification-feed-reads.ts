// Feed notification surface — the reader's in-app feed, scoped to the
// Properties they can access NOW.
//
// Notifications are addressed when they are delivered, but Property access can
// end afterwards: a revoked grant or an expired temporary grant used to leave
// that Property's guest ratings and workflow state in the bell, counted by the
// badge, with every link and Mute on them refused. Each read therefore
// resolves the reader's current scope for `notification.read`, the way Recent
// Activity resolves `inbox.read`. Organization-scoped notices (no Property)
// are never Property-gated. "Mark all read" and "Clear all" resolve the same
// scope, so they change exactly the rows the reader's tab and count showed —
// including the page's Property filter, when one is set.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import {
  getAccessiblePropertyIdsForPermission,
  type PropertyAccessLookup,
} from '#/shared/domain/property-access'
import type {
  NotificationFeedQuery,
  NotificationFeedScope,
  NotificationRepositoryPort,
} from './ports/notification-repository.port'
import type { NotificationListFilter } from './notification-list-filter'
import type { NotificationFeedCursor } from './notification-page'

/** The page's Property filter: one Property's notices, or null for all. */
type PropertyFilter = PropertyId | null

type FeedPageRequest = Readonly<{
  limit: number
  filter: NotificationListFilter
  /** Absent: the whole feed. */
  propertyId?: PropertyFilter
}>

export type NotificationFeedReadsDeps = Readonly<{
  repo: Pick<
    NotificationRepositoryPort,
    'readFeedHead' | 'readFeedPage' | 'markAllRead' | 'markAllDismissed'
  >
  /** Identity-owned current Property access; null means every Property. */
  propertyAccess: PropertyAccessLookup
  clock: () => Date
}>

export const createNotificationFeedReads = (deps: NotificationFeedReadsDeps) => {
  const readerScope = async (
    ctx: AuthContext,
    propertyId: PropertyFilter,
  ): Promise<NotificationFeedScope> => ({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    visiblePropertyIds: await getAccessiblePropertyIdsForPermission(
      deps.propertyAccess,
      ctx,
      'notification.read',
    ),
    ...(propertyId === null ? {} : { propertyId }),
  })
  const readerQuery = async (
    ctx: AuthContext,
    request: FeedPageRequest,
  ): Promise<NotificationFeedQuery> => ({
    ...(await readerScope(ctx, request.propertyId ?? null)),
    limit: request.limit,
    filter: request.filter,
  })

  return {
    /** The polled first page, with the badge count from the same snapshot. */
    getFeedHead: async (ctx: AuthContext, request: FeedPageRequest) =>
      deps.repo.readFeedHead(await readerQuery(ctx, request)),
    /** A keyset page below the head, continuing strictly after `before`. */
    getNotifications: async (
      ctx: AuthContext,
      request: FeedPageRequest & Readonly<{ before: NotificationFeedCursor | null }>,
    ) =>
      deps.repo.readFeedPage({
        ...(await readerQuery(ctx, request)),
        before: request.before,
      }),
    /** "Mark all read" on the reader's tab: the unread rows it holds and shows. */
    markAllRead: async (
      ctx: AuthContext,
      filter: NotificationListFilter,
      propertyId: PropertyFilter = null,
    ) => deps.repo.markAllRead(await readerScope(ctx, propertyId), filter, deps.clock()),
    /** "Clear all": every row the reader's feed shows, and none it hides. */
    dismissAll: async (ctx: AuthContext, propertyId: PropertyFilter = null) =>
      deps.repo.markAllDismissed(await readerScope(ctx, propertyId), deps.clock()),
  } as const
}
