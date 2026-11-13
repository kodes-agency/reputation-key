import type { Result } from '#/shared/domain'
import type { Database } from '#/shared/db'
import type { UserId } from '#/shared/domain/ids'
import {
  markNotificationRead,
  markNotificationUnread,
  dismissNotification,
  restoreDismissedNotification,
} from '../domain/constructors-transitions'
import { notificationError } from '../domain/notification-errors'
import type { NotificationError } from '../domain/notification-errors'
import type { Notification } from '../domain/notification-types'
import {
  findNotificationById,
  saveNotificationRead,
  saveNotificationStatus,
  saveNotificationUnread,
  saveRestoredNotification,
} from './notification-rows.server'
import { toNotificationView } from '../application/notification-view'

type Dependencies = Readonly<{
  db: Database
  clock: () => Date
}>

/** The single-notification actions behind the row menu and the bell. */
export const createOwnedNotificationActions = (input: Dependencies) => {
  /**
   * The guard every single-notification mutation shares: load the row, prove
   * it belongs to the caller, then apply the domain transition. Returns the
   * transition's timestamp, or null when the transition is a no-op so the
   * caller skips its write. A wrong or foreign id throws `not_found`.
   *
   * Factored because these three paths MUST NOT drift: an ownership check
   * present in two of them and missing from the third is a cross-tenant write,
   * and that is exactly the kind of difference three near-identical inline
   * copies hide.
   */
  const applyOwnedTransition = async (
    id: string,
    orgId: string,
    userId: UserId,
    transition: (
      notification: Notification,
      clock: () => Date,
    ) => Result<Notification, NotificationError>,
  ): Promise<Date | null> => {
    const n = await findNotificationById(input.db, id, orgId)
    if (!n || n.userId !== userId) {
      throw notificationError('not_found', 'Notification not found or access denied')
    }
    const now = input.clock()
    return transition(n, () => now).isErr() ? null : now
  }

  return {
    markRead: async (id: string, orgId: string, userId: UserId) => {
      const now = await applyOwnedTransition(id, orgId, userId, markNotificationRead)
      if (now === null) return // invalid transition, skip
      await saveNotificationRead(input.db, id, userId, orgId, now, now)
    },
    /**
     * Read -> unread for the row menu. Resolves to the flipped row's browser view, or
     * null when the flip is a no-op: either the transition is invalid (the row
     * is already unread or was dismissed) or ADR 0046 r.2's unread-uniqueness
     * key is already held by another row for the same (user, type, resource) —
     * in which case that row IS the user's unread signal and there is nothing
     * to do. A wrong or foreign id still throws `not_found`.
     */
    markUnread: async (id: string, orgId: string, userId: UserId) => {
      const now = await applyOwnedTransition(id, orgId, userId, markNotificationUnread)
      if (now === null) return null // invalid transition, skip
      const flipped = await saveNotificationUnread(input.db, id, userId, orgId, now)
      return flipped === null ? null : toNotificationView(flipped)
    },
    dismiss: async (id: string, orgId: string, userId: UserId) => {
      const now = await applyOwnedTransition(id, orgId, userId, dismissNotification)
      if (now === null) return // invalid transition, skip
      await saveNotificationStatus(input.db, id, userId, orgId, 'dismissed', now)
    },
    /**
     * The undo a dismissal offers: the row comes back as it was, read or
     * unread. Resolves to its browser view, or null when there is nothing to
     * undo (it was not dismissed, or a dismiss-all already moved on). A wrong
     * or foreign id still throws `not_found`.
     */
    restore: async (id: string, orgId: string, userId: UserId) => {
      const notification = await findNotificationById(input.db, id, orgId)
      if (!notification || notification.userId !== userId) {
        throw notificationError('not_found', 'Notification not found or access denied')
      }
      const restored = restoreDismissedNotification(notification, input.clock)
      if (restored.isErr()) return null
      const row = await saveRestoredNotification(
        input.db,
        id,
        userId,
        orgId,
        restored.value.status === 'unread' ? 'unread' : 'read',
        restored.value.updatedAt,
      )
      return row === null ? null : toNotificationView(row)
    },
  } as const
}
