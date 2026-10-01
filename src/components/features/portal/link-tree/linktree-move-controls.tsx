// The keyboard way to re-order tiles: two buttons that move a tile one place.
// Each carries `data-link-move` so the section can put focus back on the same
// control after the list re-orders.

import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { LinkMoveDirection } from './linktree-rules'

type Props = Readonly<{
  linkId: string
  label: string
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: LinkMoveDirection) => void
}>

export function LinktreeMoveControls({
  linkId,
  label,
  canMoveUp,
  canMoveDown,
  onMove,
}: Props) {
  return (
    <div className="flex shrink-0 flex-col">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={`Move ${label} up`}
        data-link-move={`${linkId}:up`}
        disabled={!canMoveUp}
        onClick={() => onMove('up')}
      >
        <ChevronUp aria-hidden="true" className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={`Move ${label} down`}
        data-link-move={`${linkId}:down`}
        disabled={!canMoveDown}
        onClick={() => onMove('down')}
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </Button>
    </div>
  )
}
