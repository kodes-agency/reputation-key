// The Orientation control of the Print cards section (design spec
// §11.1): Upright or Wide for the piece on show, with portrait and landscape
// shapes, and the one line of physics beside it. The phone's Preview sheet
// repeats it, so a manager can compare the two without closing the sheet.

import { RectangleHorizontal, RectangleVertical } from 'lucide-react'
import { SegmentedControl } from '#/components/ui/segmented-control'
import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import type { PrintOrientation, PrintPiece } from '#/shared/domain/portal-print'
import {
  PRINT_PIECE_FACTS,
  printOrientationNote,
} from '#/shared/domain/portal-print-share'

const OPTIONS = [
  {
    value: 'upright',
    label: 'Upright',
    icon: <RectangleVertical aria-hidden="true" className="size-3.5" />,
  },
  {
    value: 'wide',
    label: 'Wide',
    icon: <RectangleHorizontal aria-hidden="true" className="size-3.5" />,
  },
] as const

type Props = Readonly<{
  piece: PrintPiece
  orientation: PrintOrientation
  paper: PrintKitPaper
  onChange: (orientation: PrintOrientation) => void
  /** Keeps the ids of the section's control and the sheet's apart. */
  idPrefix: string
  /** The line of physics beside the control; the phone's sheet leaves it out. */
  showNote?: boolean
}>

export function PrintOrientationControl({
  piece,
  orientation,
  paper,
  onChange,
  idPrefix,
  showNote = true,
}: Props) {
  const noteId = `${idPrefix}-orientation-note`
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span aria-hidden="true" className="text-[13px] font-medium">
        Orientation
      </span>
      <SegmentedControl
        aria-label={`${PRINT_PIECE_FACTS[piece].title} orientation`}
        {...(showNote ? { 'aria-describedby': noteId } : {})}
        value={orientation}
        onValueChange={(value) => onChange(value as PrintOrientation)}
        options={OPTIONS}
        touch
      />
      {showNote && (
        <span
          id={noteId}
          className="min-w-48 flex-1 text-xs text-pretty text-muted-foreground"
        >
          {printOrientationNote(piece, orientation, paper)}
        </span>
      )}
    </div>
  )
}
