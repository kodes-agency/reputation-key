// Feed notification surface — the reader's in-app feed, scoped to the
// Properties they can access NOW.
//
// Notifications are addressed when they are delivered, but Property access can
// end afterwards: a revoked grant or an expired temporary grant used to leave
// that Property's guest ratings and workflow state in the bell, counted by the
// badge, with every link and Mute on them refused. Each read therefore
// resolves the reader's current scope for `notification.read`, the way Recent
// Activity resolves `inbox.read`. Organization-scoped notices (no Property)
// are never Property-gated.

import type { AuthContext } from '#/shared/domain/auth-context'
import {
  getAccessiblePropertyIdsForPermission,
  type PropertyAccessLookup,
} from '#/shared/domain/property-access'
import type {
  NotificationFeedQuery,
  NotificationRepositoryPort,
} from './ports/notification-repository.port'
import type { NotificationListFilter } from './notification-list-filter'
import type { NotificationFeedCursor } from './notification-page'

type FeedPageRequest = Readonly<{
  limit: number
  filter: NotificationListFilter
}>

export type NotificationFeedReadsDeps = Readonly<{
  repo: Pick<NotificationRepositoryPort, 'readFeedHead' | 'readFeedPage'>
  /** Identity-owned current Property access; null means every Property. */
  propertyAccess: PropertyAccessLookup
}>

export const createNotificationFeedReads = (deps: NotificationFeedReadsDeps) => {
  const readerQuery = async (
    ctx: AuthContext,
    request: FeedPageRequest,
  ): Promise<NotificationFeedQuery> => ({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    visiblePropertyIds: await getAccessiblePropertyIdsForPermission(
      deps.propertyAccess,
      ctx,
      'notification.read',
    ),
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
  } as const
}
