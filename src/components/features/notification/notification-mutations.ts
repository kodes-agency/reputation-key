// Notification MUTATIONS — optimistic, targeted, and self-announcing.
//
// A write shows at once: while in flight it is applied over every surface's
// rows and counts (notification-feed-writes.ts), and it stops applying once
// the feed has been read again after it settles. Nothing is snapshotted or
// restored, so writes made together (a stack's rows, a bulk action) cannot
// undo one another when one of them fails.
//
// Every handler resolves, never rejects. A failure is a visible toast, not
// only an announcement: the row comes back as the server has it, and a row
// that reappears with no word of why looks like the UI undoing itself. A
// dismissal and a mute are confirmed by a toast with Undo: a dismissed row
// has nowhere else to be found again, and nothing else on screen says what a
// mute covered. Sonner's live region reads the toast, so neither is announced
// a second time. Feed writes read only the feed again, never the settings
// page's cached preferences (a mute and its Undo also change those).

import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  actionFailureMessage as failed,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { categoryInSentence } from '#/components/features/settings/notifications-type-rows'
import { createKeys } from '#/shared/queries/query-keys'
import type { TenantScope } from '#/shared/queries/tenant-scope'
import type {
  NotificationListFilter,
  NotificationView,
} from '#/contexts/feed/application/public-api'
import { notificationFilterScope } from './notification-filters'
import { feedWriteOptions, type FeedWriteKind } from './notification-feed-writes'
import type { NotificationServerFns } from './types'

/**
 * Names what a mute switched off: this Property's in-app notices of one
 * category, the ones already listed included (the server stops returning
 * them). Email and other Properties are untouched, which "in-app" and the
 * Property name say without a second line.
 */
function muteConfirmation(notification: NotificationView): string {
  const category = categoryInSentence(notification.category)
  const property = notification.payload.propertyName ?? 'this property'
  return `In-app ${category} notices muted for ${property}, including earlier ones.`
}

/** How long a toast offering Undo stays: long enough to notice it and act. */
const UNDO_TOAST_MS = 6_000

export type NotificationFeedMutations = Readonly<{
  onMarkRead: (notificationId: string) => void
  onMarkUnread: (notificationId: string) => void
  onDismiss: (notificationId: string) => void
  onMarkManyRead: (notificationIds: ReadonlyArray<string>) => void
  onDismissMany: (notificationIds: ReadonlyArray<string>) => void
  onMuteCategory: (notification: NotificationView) => void
  /**
   * Marks read the unread rows `filter` holds: the tab the reader is on, not
   * every tab — and, with `propertyId`, only that Property's (the page's
   * Property filter).
   */
  markAllRead: (filter: NotificationListFilter, propertyId?: string) => void
  /** Dismisses every row the feed shows, or, with `propertyId`, that Property's. */
  dismissAll: (propertyId?: string) => void
  isMarkingAllRead: boolean
  isDismissingAll: boolean
}>

export function useNotificationMutations(
  scope: TenantScope,
  fns: NotificationServerFns,
  organizationId: string,
  announce: (text: string) => void,
): NotificationFeedMutations {
  const { notificationKeys } = createKeys(scope)
  const qc = useQueryClient()
  /** A feed write: shown while in flight, then the feed is read again however it ended. */
  const feedWrite = (kind: FeedWriteKind, what: string) => ({
    ...feedWriteOptions(qc, scope, organizationId, kind),
    errorMessage: failed(what),
  })
  const preferences = [notificationKeys.preferences(organizationId)]

  const markRead = useActionMutation(
    fns.markRead,
    feedWrite('markRead', "Couldn't mark that notification as read."),
  )
  const markUnread = useActionMutation(
    fns.markUnread,
    feedWrite('markUnread', "Couldn't mark that notification as unread."),
  )
  const dismiss = useActionMutation(
    fns.dismiss,
    feedWrite('dismiss', "Couldn't dismiss that notification."),
  )
  const markAllRead = useActionMutation(
    fns.markAllRead,
    feedWrite('markAllRead', "Couldn't mark those notifications as read."),
  )
  const dismissAll = useActionMutation(
    fns.dismissAll,
    feedWrite('dismissAll', "Couldn't dismiss all notifications."),
  )
  const restore = useActionMutation(
    fns.restore,
    feedWrite('restore', "Couldn't bring that notification back."),
  )
  const undoMute = useActionMutation(fns.undoMuteCategory, {
    ...feedWrite('undoMuteCategory', "Couldn't undo that mute."),
    invalidateKeys: preferences,
  })
  const muteCategory = useActionMutation(fns.muteCategory, {
    ...feedWrite('muteCategory', "Couldn't mute those notifications."),
    invalidateKeys: preferences,
  })

  /** Awaits a mutation and reports success; its failure is the mutation's toast. Never rejects. */
  const run = async <T>(work: Promise<T>, done: (result: T) => void) => {
    let result: T
    try {
      result = await work
    } catch {
      // Already reported: `errorMessage` toasts, and sonner's region announces it.
      return
    }
    done(result)
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
        toast('Notification dismissed.', {
          duration: UNDO_TOAST_MS,
          action: {
            label: 'Undo',
            onClick: () =>
              void run(restore({ data: { notificationId: id } }), () =>
                toast('Notification restored.'),
              ),
          },
        }),
      )
    },
    onMarkManyRead: (ids) => {
      void run(
        Promise.all(ids.map((id) => markRead({ data: { notificationId: id } }))),
        () => announce(`${ids.length} notifications marked as read.`),
      )
    },
    onDismissMany: (ids) => {
      void run(
        Promise.all(ids.map((id) => dismiss({ data: { notificationId: id } }))),
        () =>
          toast(`${ids.length} notifications dismissed.`, {
            duration: UNDO_TOAST_MS,
            action: {
              label: 'Undo',
              onClick: () =>
                void run(
                  Promise.all(ids.map((id) => restore({ data: { notificationId: id } }))),
                  () => toast(`${ids.length} notifications restored.`),
                ),
            },
          }),
      )
    },
    onMuteCategory: (notification) => {
      // The row menu never offers these; the guard keeps the command honest.
      const { propertyId } = notification
      if (propertyId === null || notification.category === 'mandatory') {
        announce("This notice can't be muted. Dismiss it instead.")
        return
      }
      const category = notification.category
      const work = muteCategory({ data: { propertyId, category } })
      void run(work, ({ previous }) =>
        toast.success(muteConfirmation(notification), {
          duration: UNDO_TOAST_MS,
          action: {
            label: 'Undo',
            onClick: () =>
              void run(undoMute({ data: { propertyId, category, previous } }), () =>
                toast('Mute undone.'),
              ),
          },
        }),
      )
    },
    markAllRead: (filter, propertyId) => {
      void run(
        markAllRead({ data: propertyId ? { filter, propertyId } : { filter } }),
        () =>
          announce(
            propertyId
              ? `${notificationFilterScope(filter)} at this property marked as read.`
              : `${notificationFilterScope(filter)} marked as read.`,
          ),
      )
    },
    dismissAll: (propertyId) => {
      void run(dismissAll({ data: propertyId ? { propertyId } : undefined }), () =>
        announce(
          propertyId
            ? "This property's notifications dismissed."
            : 'All notifications dismissed.',
        ),
      )
    },
    isMarkingAllRead: markAllRead.isPending,
    isDismissingAll: dismissAll.isPending,
  }
}
