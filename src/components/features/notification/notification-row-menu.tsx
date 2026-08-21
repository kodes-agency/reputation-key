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
import type { Notification } from '#/contexts/notification/application/public-api'
import type { NotificationRowActions } from './types'

type Props = Readonly<{
  notification: Notification
  /** Human name of the notification's category, e.g. "Urgent operations". */
  categoryLabel: string
  /** Used only for the trigger's accessible name, never rendered. */
  title: string
  actions: NotificationRowActions
}>

// Cognitive-only finding, and it measures JSX nesting rather than logic here:
// cyclomatic is 3 against a threshold of 22. A dropdown is atomic — trigger
// and items only ever exist together — so the only split on offer is "the
// items", a component that could never be rendered anywhere else. The two
// conditionals (read vs unread item, and mandatory categories not offering a
// mute) ARE this menu's reason to exist; hiding them one level down would cost
// a reader the whole picture. This shape is the norm rather than the exception
// in this repo: 126 components exceed the cognitive threshold, none suppressed,
// including notification-popover-content.tsx in this same directory.
// Revisit when the CYCLOMATIC number climbs — real branching arriving here
// means the menu grew logic worth extracting. A deeper markup tree does not.
// fallow-ignore-next-line complexity
export function NotificationRowMenu({
  notification,
  categoryLabel,
  title,
  actions,
}: Props) {
  const isUnread = notification.status === 'unread'
  // `mandatory` is non-disableable by ADR 0046, so muting it is not offered.
  const canMute = notification.category !== 'mandatory'

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
