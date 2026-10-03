// How tiles are re-ordered: a handle at the tile's edge, as the board draws,
// and two buttons that move it one place.
//
// Drag and drop is not offered, so the handle is its keyboard stand-in: focus it
// and press Up or Down, the way a drag handle is driven without a pointer. It
// shows no grab cursor, because it cannot be dragged, and it is left out at
// phone width, where it would only crowd the tile's label: the two buttons do
// the same for a pointer or a finger and stay. Each control carries
// `data-link-move`, so the section can put focus back on the control that was
// used after the list re-orders.

import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import {
  moveDirectionForKey,
  type LinkMoveControl,
  type LinkMoveDirection,
} from './linktree-rules'
import { IconButton } from '#/components/ui/icon-button'

/** The one hint every handle points at: rendered once, by the section. */
export const LINKTREE_MOVE_HINT_ID = 'linktree-move-hint'

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
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label={`Reorder ${label}`}
        aria-describedby={LINKTREE_MOVE_HINT_ID}
        aria-keyshortcuts="ArrowUp ArrowDown"
        data-link-move={`${linkId}:handle`}
        title="Focus, then press Up or Down to move"
        className="hidden size-7 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grid"
        onKeyDown={(event) => {
          const direction = moveDirectionForKey(event.key)
          if (direction === null) return
          event.preventDefault()
          onMove(direction, 'handle')
        }}
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <div className="flex flex-col">
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          tooltip={false}
          label={`Move ${label} up`}
          data-link-move={`${linkId}:up`}
          disabled={!canMoveUp}
          onClick={() => onMove('up', 'up')}
        >
          <ChevronUp aria-hidden="true" className="size-4" />
        </IconButton>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          tooltip={false}
          label={`Move ${label} down`}
          data-link-move={`${linkId}:down`}
          disabled={!canMoveDown}
          onClick={() => onMove('down', 'down')}
        >
          <ChevronDown aria-hidden="true" className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}
