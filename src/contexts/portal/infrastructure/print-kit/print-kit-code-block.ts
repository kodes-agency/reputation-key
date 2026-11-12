// The code block, drawn as the design board draws it (spec 2.3): a cream tile
// with the code on it, and under it, joined with no gap and exactly as wide, a
// bar in the accent that holds a camera pictogram and the cue, in the lead
// language first. The whole object has rounded corners; on Paper an outline is
// drawn outside it, so the bar still measures the tile, the size check. The tile
// is the plan's: today's 2 in, or the one a size chose (`chooseCodeTile`).
//
// Drawn in the caller's coordinates, in points, from the tile's top-left corner.
// `planPdfCodeBlock` measures the cue in the PDF's own fonts and says how tall the
// object is, so a face can place it before it draws it.

import { PRINT_KIT_QR_QUIET_ZONE_MODULES } from '#/shared/domain/portal-print-kit'
import { PRINT_KIT_INK } from '#/shared/domain/portal-print-kit-palette'
import { qrDarkRuns, type QrMatrix } from './print-kit-qr'
type Corner = Readonly<{ x: number; y: number }>

/** The tile's code: one rectangle per run of dark modules, inside its quiet zone (the print kit draws it too). */
export function drawCode(
  doc: PDFKit.PDFDocument,
  qr: QrMatrix,
  tilePt: number,
  at: Corner,
): void {
  const module = tilePt / (qr.size + 2 * PRINT_KIT_QR_QUIET_ZONE_MODULES)
  const quiet = PRINT_KIT_QR_QUIET_ZONE_MODULES
  for (const run of qrDarkRuns(qr)) {
    doc.rect(
      at.x + (quiet + run.column) * module,
      at.y + (quiet + run.row) * module,
      run.length * module,
      module,
    )
  }
  doc.fill(PRINT_KIT_INK)
}
