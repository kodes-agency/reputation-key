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

import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { notificationKeys } from '#/shared/queries/query-keys'
import type { Notification } from '#/contexts/notification/application/public-api'
import type { NotificationServerFns } from './types'

/** Shape `useInfiniteQuery` stores under `notificationKeys.list(...)`. */
type FeedPages = Readonly<{
  pages: ReadonlyArray<ReadonlyArray<Notification>>
  pageParams: ReadonlyArray<number>
}>

/** `null` removes the row. Returning the row unchanged is a no-op. */
type RowPatch = (row: Notification) => Notification | null

function patchPage(
  page: ReadonlyArray<Notification>,
  patch: RowPatch,
): Readonly<{ rows: Notification[]; unreadDelta: number }> {
  const rows: Notification[] = []
  let unreadDelta = 0
  for (const row of page) {
    const patched = patch(row)
    const wasUnread = row.status === 'unread'
    if (patched === null) {
      if (wasUnread) unreadDelta -= 1
      continue
    }
    if (wasUnread !== (patched.status === 'unread')) unreadDelta += wasUnread ? -1 : 1
    rows.push(patched)
  }
  return { rows, unreadDelta }
}

/**
 * Applies `patch` to every cached page and adjusts the badge by the change in
 * unread rows. Returns the rollback thunk `useActionMutation` runs on failure.
 */
function patchFeed(
  qc: QueryClient,
  listKey: QueryKey,
  countKey: QueryKey,
  patch: RowPatch,
): (() => void) | undefined {
  const previousPages = qc.getQueryData<FeedPages>(listKey)
  if (!previousPages) return undefined
  const previousCount = qc.getQueryData<{ count: number }>(countKey)

  let unreadDelta = 0
  const pages = previousPages.pages.map((page) => {
    const patched = patchPage(page, patch)
    unreadDelta += patched.unreadDelta
    return patched.rows
  })

  qc.setQueryData<FeedPages>(listKey, { ...previousPages, pages })
  if (previousCount && unreadDelta !== 0) {
    qc.setQueryData(countKey, { count: Math.max(0, previousCount.count + unreadDelta) })
  }

  return () => {
    qc.setQueryData(listKey, previousPages)
    if (previousCount) qc.setQueryData(countKey, previousCount)
  }
}

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
  clearAll: () => void
  isMarkingAllRead: boolean
  isClearingAll: boolean
}>

export function useNotificationMutations(
  fns: NotificationServerFns,
  organizationId: string,
  announce: (text: string) => void,
  limit = 20,
): NotificationFeedMutations {
  const qc = useQueryClient()
  const listKey = notificationKeys.list(organizationId, limit)
  const countKey = notificationKeys.count(organizationId)
  const invalidateKeys = [notificationKeys.feed(organizationId)]

  const markRead = useActionMutation(fns.markRead, {
    invalidateKeys,
    optimistic: (input) =>
      patchFeed(qc, listKey, countKey, (row) =>
        row.id === input.data.notificationId ? readNow(row) : row,
      ),
  })
  const markUnread = useActionMutation(fns.markUnread, {
    invalidateKeys,
    optimistic: (input) =>
      patchFeed(qc, listKey, countKey, (row) =>
        row.id === input.data.notificationId
          ? { ...row, status: 'unread', readAt: null }
          : row,
      ),
  })
  const dismiss = useActionMutation(fns.dismiss, {
    invalidateKeys,
    optimistic: (input) =>
      patchFeed(qc, listKey, countKey, (row) =>
        row.id === input.data.notificationId ? null : row,
      ),
  })
  const markAllRead = useActionMutation(fns.markAllRead, {
    invalidateKeys,
    optimistic: () =>
      patchFeed(qc, listKey, countKey, (row) =>
        row.status === 'unread' ? readNow(row) : row,
      ),
  })
  const dismissAll = useActionMutation(fns.dismissAll, {
    invalidateKeys,
    optimistic: () => patchFeed(qc, listKey, countKey, () => null),
  })
  const mutePreference = useActionMutation(fns.updatePreference, {
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

  const muteCategory = async (notification: Notification) => {
    // Preferences are fetched only now, so the bell costs no extra request.
    const preferences = await qc.ensureQueryData({
      queryKey: notificationKeys.preferences(organizationId),
      queryFn: () => fns.getPreferences(),
      staleTime: 60_000,
    })
    const current = preferences.find(
      (preference) =>
        preference.propertyId === notification.propertyId &&
        preference.category === notification.category &&
        preference.channel === 'in_app',
    )
    // The update DTO is a full replace, so absent fields fall back to the
    // shipped defaults rather than being silently blanked.
    await mutePreference({
      data: {
        propertyId: notification.propertyId,
        category: notification.category,
        channel: 'in_app',
        enabled: false,
        cadence: current?.cadence ?? 'immediate',
        urgentBypassEnabled: current?.urgentBypassEnabled ?? false,
        quietHoursStart: current?.quietHoursStart ?? null,
        quietHoursEnd: current?.quietHoursEnd ?? null,
      },
    })
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
      void run(
        muteCategory(notification),
        'Muted. You can turn it back on in notification settings.',
      )
    },
    markAllRead: () => {
      void run(markAllRead({ data: undefined }), 'All notifications marked as read.')
    },
    clearAll: () => {
      void run(dismissAll({ data: undefined }), 'All notifications cleared.')
    },
    isMarkingAllRead: markAllRead.isPending,
    isClearingAll: dismissAll.isPending,
  }
}
