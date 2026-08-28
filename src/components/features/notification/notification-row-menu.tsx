// Row overflow menu — the SAFE secondary actions only.
//
// Deliberately absent: Approve / Publish. Approving a drafted reply without
// having read the review it answers is an operational hazard, so the primary
// CTA takes you to the item and the decision happens there.
//
// Everything here is keyboard reachable by construction: it lives behind a
// permanently visible trigger, not a hover-only affordance.

import { BellOff, Check, MoreHorizontal, Trash2, Undo2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  isPreferenceDisableable,
  NOTIFICATION_SETTINGS_CATEGORIES,
  type Notification,
} from '#/contexts/notification/application/public-api'
import type { NotificationRowActions } from './types'

type Props = Readonly<{
  notification: Notification
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
  const canMute =
    notification.category !== 'mandatory' &&
    NOTIFICATION_SETTINGS_CATEGORIES.includes(notification.category) &&
    isPreferenceDisableable(notification.category, 'in_app')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={`More actions for: ${title}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {isUnread ? (
          <DropdownMenuItem onSelect={() => actions.onMarkRead(notification.id)}>
            <Check aria-hidden="true" />
            Mark as read
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => actions.onMarkUnread(notification.id)}>
            <Undo2 aria-hidden="true" />
            Mark as unread
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => actions.onDismiss(notification.id)}>
          <Trash2 aria-hidden="true" />
          Dismiss
        </DropdownMenuItem>
        {canMute && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.onMuteCategory(notification)}>
              <BellOff aria-hidden="true" />
              Mute {categoryLabel.toLowerCase()}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
