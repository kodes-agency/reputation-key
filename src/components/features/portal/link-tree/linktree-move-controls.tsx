// How tiles are re-ordered: two buttons that move a tile one place, up and down.
// Drag and drop is not offered, so there is no grip handle to suggest it; the
// arrows are the whole control. Each button answers to its own click and Enter,
// and also to the Up and Down arrow keys, whichever of the two has focus, the
// way a list is re-ordered from the keyboard.
//
// From `md` up the two stack beside the tile; below it they sit side by side and
// are a tap target tall (the Button's `touch` option), so a thumb moves the right
// tile. Each control carries `data-link-move`, so the section can put focus back
// on the control that was used after the list re-orders.

import type { KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  moveDirectionForKey,
  type LinkMoveControl,
  type LinkMoveDirection,
} from './linktree-rules'
import { IconButton } from '#/components/ui/icon-button'

type Props = Readonly<{
  linkId: string
  label: string
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: LinkMoveDirection, control: LinkMoveControl) => void
}>

export function LinktreeMoveControls({
  linkId,
  label,
  canMoveUp,
  canMoveDown,
  onMove,
}: Props) {
  const arrowKeys = (control: LinkMoveControl) => (event: KeyboardEvent) => {
    const direction = moveDirectionForKey(event.key)
    if (direction === null) return
    event.preventDefault()
    onMove(direction, control)
  }
  return (
    <div className="flex shrink-0 flex-row items-center md:flex-col">
      <IconButton
        type="button"
        variant="ghost"
        size="icon-xs"
        touch
        tooltip={false}
        label={`Move ${label} up`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        data-link-move={`${linkId}:up`}
        disabled={!canMoveUp}
        onClick={() => onMove('up', 'up')}
        onKeyDown={arrowKeys('up')}
      >
        <ChevronUp aria-hidden="true" className="size-4" />
      </IconButton>
      <IconButton
        type="button"
        variant="ghost"
        size="icon-xs"
        touch
        tooltip={false}
        label={`Move ${label} down`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        data-link-move={`${linkId}:down`}
        disabled={!canMoveDown}
        onClick={() => onMove('down', 'down')}
        onKeyDown={arrowKeys('down')}
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </IconButton>
    </div>
  )
}
