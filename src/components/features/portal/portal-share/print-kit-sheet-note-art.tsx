// The short note an office sheet carries (round-3 spec-delta S6), as the PDF sets
// it: its text wrapped in the box it is given, at its size. A note up a side
// margin is turned a quarter anticlockwise, its lines running up the page from
// the box's bottom-left corner. The PDF steps a note down a quarter point at a
// time until it fits its box, measuring the font; the preview cannot, so it sets
// the note at its size and lets it wrap.
//
// Laid out in the sheet's container units (`u`), as the sheet is.

import { SHEET_NOTE, type SheetNote } from '#/shared/domain/portal-print-kit-sheet-parts'
import type { PointsToLength } from './print-kit-code-block-layout'

export function SheetNoteArt({
  note,
  u,
}: Readonly<{ note: SheetNote; u: PointsToLength }>) {
  return (
    <p
      data-sheet-note
      style={{
        position: 'absolute',
        left: u(note.leftPt),
        top: u(note.topPt),
        width: u(note.widthPt),
        margin: 0,
        fontSize: u(note.sizePt),
        lineHeight: SHEET_NOTE.leading,
        color: SHEET_NOTE.colour,
        // Turned, the box runs up from its corner: the text starts at the corner and reads upward.
        transformOrigin: '0 0',
        transform: note.turned ? 'rotate(-90deg)' : undefined,
      }}
    >
      {note.text}
    </p>
  )
}
