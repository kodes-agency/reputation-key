// Row overflow menu — the SAFE secondary actions only.
//
// Deliberately absent: Approve / Publish. Approving a drafted reply without
// having read the review it answers is an operational hazard, so the primary
// CTA takes you to the item and the decision happens there.
//
// Everything here is keyboard reachable by construction: it lives behind a
// permanently visible trigger, not a hover-only affordance.

import { BellOff, Check, Trash2, Undo2 } from 'lucide-react'
import {
  RowActionsItem,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'
import {
  isPreferenceDisableable,
  NOTIFICATION_SETTINGS_CATEGORIES,
  type NotificationView,
} from '#/contexts/feed/application/public-api'
import type { NotificationRowActions } from './types'

type Props = Readonly<{
  notification: NotificationView
  /** Human name of the notification's category, e.g. "Action needed". */
  categoryLabel: string
  /** Used only for the trigger's accessible name, never rendered. */
  title: string
  actions: NotificationRowActions
}>

export function NotificationRowMenu({
  notification,
  categoryLabel,
  title,
  actions,
}: Props) {
  const isUnread = notification.status === 'unread'
  // A settled row has stopped asking and shows no unread dot, though it stays
  // unread until opened: offering "Mark as read" on it contradicted the row.
  const isSettled = notification.resolvedAt !== null
  // A mute is a per-Property in-app switch. An Organization-scoped row
  // (mandatory, or the ADR 0059 report outcome) has no Property to switch
  // off, even when its category is configurable elsewhere.
  const canMute =
    notification.propertyId !== null &&
    notification.category !== 'mandatory' &&
    NOTIFICATION_SETTINGS_CATEGORIES.includes(notification.category) &&
    isPreferenceDisableable(notification.category, 'in_app')

  return (
    <RowActionsMenu name={title} size="small" width="default" data-row-control="menu">
      {!isSettled && isUnread && (
        <RowActionsItem icon={Check} onSelect={() => actions.onMarkRead(notification.id)}>
          Mark as read
        </RowActionsItem>
      )}
      {!isSettled && !isUnread && (
        <RowActionsItem
          icon={Undo2}
          onSelect={() => actions.onMarkUnread(notification.id)}
        >
          Mark as unread
        </RowActionsItem>
      )}
      <RowActionsItem icon={Trash2} onSelect={() => actions.onDismiss(notification.id)}>
        Dismiss
      </RowActionsItem>
      {canMute && (
        <>
          <RowActionsSeparator />
          <RowActionsItem
            icon={BellOff}
            onSelect={() => actions.onMuteCategory(notification)}
          >
            Mute {categoryLabel.toLowerCase()} for this property
          </RowActionsItem>
        </>
      )}
    </RowActionsMenu>
  )
}
