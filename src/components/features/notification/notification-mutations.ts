// Notification MUTATIONS — optimistic, targeted, and self-announcing.
//
// Three defects this file exists to fix:
//
//  1. Every handler used to `await` the server and then invalidate the whole
//     `forOrganization(org)` subtree. With `staleTime: 0` that made the row
//     visibly lag; and the subtree included the settings page's 60s-cached
//     preferences, so merely OPENING the bell evicted them. Invalidation is now
//     `feed(org)` only, declared per mutation via `invalidateKeys`.
//  2. Nothing was announced. Rows vanished silently.
//  3. `mutateAsync` was called without a catch, so a failed dismiss produced an
//     unhandled rejection. Every action here resolves, never rejects.

import { useQueryClient } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { notificationKeys } from '#/shared/queries/query-keys'
import type { Notification } from '#/contexts/notification/application/public-api'
import type { NotificationListFilter } from '#/contexts/notification/application/public-api'
import { patchNotificationFeedCache } from './notification-feed-cache'
import type { NotificationServerFns } from './types'

const readNow = (row: Notification): Notification => ({
  ...row,
  status: 'read',
  readAt: new Date(),
})

export type NotificationFeedMutations = Readonly<{
  onMarkRead: (notificationId: string) => void
  onMarkUnread: (notificationId: string) => void
  onDismiss: (notificationId: string) => void
  onMuteCategory: (notification: Notification) => void
  markAllRead: () => void
  dismissAll: () => void
  isMarkingAllRead: boolean
  isDismissingAll: boolean
}>

export function useNotificationMutations(
  fns: NotificationServerFns,
  organizationId: string,
  announce: (text: string) => void,
  limit = 20,
  filter: NotificationListFilter = 'all',
): NotificationFeedMutations {
  const qc = useQueryClient()
  const listKey = notificationKeys.list(organizationId, limit, filter)
  const headKey = notificationKeys.head(organizationId, limit, filter)
  const invalidateKeys = [notificationKeys.feed(organizationId)]

  const markRead = useActionMutation(fns.markRead, {
    invalidateKeys,
    optimistic: (input) =>
      patchNotificationFeedCache(qc, listKey, headKey, (row) =>
        row.id === input.data.notificationId ? readNow(row) : row,
      ),
  })
  const markUnread = useActionMutation(fns.markUnread, {
    invalidateKeys,
    optimistic: (input) =>
      patchNotificationFeedCache(qc, listKey, headKey, (row) =>
        row.id === input.data.notificationId
          ? { ...row, status: 'unread', readAt: null }
          : row,
      ),
  })
  const dismiss = useActionMutation(fns.dismiss, {
    invalidateKeys,
    optimistic: (input) =>
      patchNotificationFeedCache(qc, listKey, headKey, (row) =>
        row.id === input.data.notificationId ? null : row,
      ),
  })
  const markAllRead = useActionMutation(fns.markAllRead, {
    invalidateKeys,
    optimistic: () =>
      patchNotificationFeedCache(
        qc,
        listKey,
        headKey,
        (row) => (row.status === 'unread' ? readNow(row) : row),
        { unreadCount: 0 },
      ),
  })
  const dismissAll = useActionMutation(fns.dismissAll, {
    invalidateKeys,
    optimistic: () =>
      patchNotificationFeedCache(qc, listKey, headKey, () => null, {
        clearContinuation: true,
        unreadCount: 0,
      }),
  })
  const muteCategory = useActionMutation(fns.muteCategory, {
    invalidateKeys: [notificationKeys.preferences(organizationId)],
  })

  /** Awaits a mutation, announcing either outcome. Never rejects. */
  const run = async (work: Promise<unknown>, done: string) => {
    try {
      await work
      announce(done)
    } catch {
      announce('That action could not be completed. Please try again.')
    }
  }

  return {
    onMarkRead: (id) => {
      void run(markRead({ data: { notificationId: id } }), 'Marked as read.')
    },
    onMarkUnread: (id) => {
      void run(markUnread({ data: { notificationId: id } }), 'Marked as unread.')
    },
    onDismiss: (id) => {
      void run(dismiss({ data: { notificationId: id } }), 'Notification dismissed.')
    },
    onMuteCategory: (notification) => {
      if (notification.propertyId === null || notification.category === 'mandatory') {
        announce('This account notice is always on.')
        return
      }
      void run(
        muteCategory({
          data: {
            propertyId: notification.propertyId,
            category: notification.category,
          },
        }),
        'Muted. You can turn it back on in notification settings.',
      )
    },
    markAllRead: () => {
      void run(markAllRead({ data: undefined }), 'All notifications marked as read.')
    },
    dismissAll: () => {
      void run(dismissAll({ data: undefined }), 'All notifications dismissed.')
    },
    isMarkingAllRead: markAllRead.isPending,
    isDismissingAll: dismissAll.isPending,
  }
}
