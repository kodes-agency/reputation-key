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
//
// A failure is a visible toast, not only an announcement: the optimistic
// change is undone, and a row that reappears with no word of why looks like
// the UI undoing itself. A mute is confirmed by a toast too, because nothing
// else on screen says what it covered.

import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  actionErrorMessage,
  GENERIC_ACTION_ERROR_MESSAGE,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { CATEGORY_COPY } from '#/components/features/settings/notifications-type-rows'
import { notificationKeys } from '#/shared/queries/query-keys'
import type {
  NotificationListFilter,
  NotificationView,
} from '#/contexts/feed/application/public-api'
import { patchNotificationFeedCache } from './notification-feed-cache'
import {
  matchesNotificationFilter,
  notificationFilterScope,
} from './notification-filters'
import type { NotificationServerFns } from './types'

const readNow = (row: NotificationView): NotificationView => ({
  ...row,
  status: 'read',
  readAt: new Date(),
})

/** A failed action's toast: the server's sentence for a refusal, else what failed. */
const failed = (what: string) => (error: unknown) => {
  const message = actionErrorMessage(error)
  return message === GENERIC_ACTION_ERROR_MESSAGE ? `${what} Try again.` : message
}

/**
 * Names what a mute switched off: this Property's in-app notices of one
 * category, the ones already listed included (the server stops returning
 * them). Email and other Properties are untouched, which "in-app" and the
 * Property name say without a second line.
 */
function muteConfirmation(notification: NotificationView): string {
  const category = CATEGORY_COPY[notification.category].label.toLowerCase()
  const property = notification.payload.propertyName ?? 'this property'
  return `In-app ${category} notices muted for ${property}, including earlier ones.`
}

export type NotificationFeedMutations = Readonly<{
  onMarkRead: (notificationId: string) => void
  onMarkUnread: (notificationId: string) => void
  onDismiss: (notificationId: string) => void
  onMuteCategory: (notification: NotificationView) => void
  /** Marks read the unread rows `filter` holds: the tab the reader is on, not every tab. */
  markAllRead: (filter: NotificationListFilter) => void
  dismissAll: () => void
  isMarkingAllRead: boolean
  isDismissingAll: boolean
}>

export function useNotificationMutations(
  fns: NotificationServerFns,
  organizationId: string,
  announce: (text: string) => void,
): NotificationFeedMutations {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const invalidateKeys = [notificationKeys.feed(organizationId)]
  const patchFeed = (
    patch: Parameters<typeof patchNotificationFeedCache>[2],
    options?: Parameters<typeof patchNotificationFeedCache>[3],
  ) => patchNotificationFeedCache(qc, organizationId, patch, options)

  const markRead = useActionMutation(fns.markRead, {
    invalidateKeys,
    errorMessage: failed("Couldn't mark that notification as read."),
    optimistic: (input) =>
      patchFeed((row) => (row.id === input.data.notificationId ? readNow(row) : row)),
  })
  const markUnread = useActionMutation(fns.markUnread, {
    invalidateKeys,
    errorMessage: failed("Couldn't mark that notification as unread."),
    optimistic: (input) =>
      patchFeed((row) =>
        row.id === input.data.notificationId
          ? { ...row, status: 'unread', readAt: null }
          : row,
      ),
  })
  const dismiss = useActionMutation(fns.dismiss, {
    invalidateKeys,
    errorMessage: failed("Couldn't dismiss that notification."),
    optimistic: (input) =>
      patchFeed((row) => (row.id === input.data.notificationId ? null : row)),
  })
  const markAllRead = useActionMutation(fns.markAllRead, {
    invalidateKeys,
    errorMessage: failed("Couldn't mark those notifications as read."),
    optimistic: (input) => {
      const filter = input?.data?.filter ?? 'all'
      return patchFeed(
        (row) =>
          row.status === 'unread' && matchesNotificationFilter(row, filter)
            ? readNow(row)
            : row,
        { clearsUnreadOf: filter },
      )
    },
  })
  const dismissAll = useActionMutation(fns.dismissAll, {
    invalidateKeys,
    errorMessage: failed("Couldn't dismiss all notifications."),
    optimistic: () =>
      patchFeed(() => null, {
        clearContinuation: true,
        clearsUnreadOf: 'all',
      }),
  })
  // The server hides every row of the muted category for that Property, read
  // or unread, from the next read on; the list says so at once, and the feed
  // is read again so the badge and loaded history agree.
  const muteCategory = useActionMutation(fns.muteCategory, {
    invalidateKeys: [...invalidateKeys, notificationKeys.preferences(organizationId)],
    errorMessage: failed("Couldn't mute those notifications."),
    optimistic: (input) =>
      patchFeed((row) =>
        row.propertyId === input.data.propertyId && row.category === input.data.category
          ? null
          : row,
      ),
  })

  /** Awaits a mutation and reports success; its failure is the mutation's toast. Never rejects. */
  const run = async (work: Promise<unknown>, done: () => void) => {
    try {
      await work
      done()
    } catch {
      // Already reported: `errorMessage` toasts, and sonner's region announces it.
    }
  }

  return {
    onMarkRead: (id) => {
      void run(markRead({ data: { notificationId: id } }), () =>
        announce('Marked as read.'),
      )
    },
    onMarkUnread: (id) => {
      void run(markUnread({ data: { notificationId: id } }), () =>
        announce('Marked as unread.'),
      )
    },
    onDismiss: (id) => {
      void run(dismiss({ data: { notificationId: id } }), () =>
        announce('Notification dismissed.'),
      )
    },
    onMuteCategory: (notification) => {
      // The row menu never offers these; the guard keeps the command honest.
      if (notification.propertyId === null || notification.category === 'mandatory') {
        announce("This notice can't be muted. Dismiss it instead.")
        return
      }
      const work = muteCategory({
        data: { propertyId: notification.propertyId, category: notification.category },
      })
      void run(work, () =>
        toast.success(muteConfirmation(notification), {
          action: {
            label: 'Settings',
            onClick: () => void navigate({ to: '/settings/notifications' }),
          },
        }),
      )
    },
    markAllRead: (filter) => {
      void run(markAllRead({ data: { filter } }), () =>
        announce(`${notificationFilterScope(filter)} marked as read.`),
      )
    },
    dismissAll: () => {
      void run(dismissAll({ data: undefined }), () =>
        announce('All notifications dismissed.'),
      )
    },
    isMarkingAllRead: markAllRead.isPending,
    isDismissingAll: dismissAll.isPending,
  }
}
