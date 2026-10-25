// Where the back pages go on an office sheet (final design spec §10.4): each
// sheet is followed by its back, the cells mirrored left to right, so that
// turning the printed sheet over like the page of a book puts every back behind
// its front. Cards only: a tent's flat prints its front on both of its faces.
//
// A card that lies a quarter turn across its cell (the third card on the Letter
// Paper Counter sheet) turns the other way on the back. Its top edge lies along
// the sheet's left edge on the front; seen from the reverse the same edge lies
// along the right, so the back's top is the same physical edge as the front's.
// The back sheet carries no cut marks and no note: the cuts are made from the
// front, and the marks sit where nothing is printed on either side.

import {
  type PrintFinalSheet,
  type PrintFinalSheetCell,
  type PrintFinalSheetPlacement,
} from './portal-print-final-sheets'

/** The cell a front cell is behind: the same box, mirrored across the sheet's vertical centre line. */
export const printFinalBackCell = (
  sheet: Pick<PrintFinalSheet, 'widthPt'>,
  cell: PrintFinalSheetCell,
): PrintFinalSheetCell => ({
  ...cell,
  leftPt: sheet.widthPt - cell.leftPt - cell.widthPt,
})

/** The back page's place in the cell behind a front cell: its box and the turn that keeps its top on the front's edge. */
export function printFinalBackPlacement(
  sheet: Pick<PrintFinalSheet, 'widthPt' | 'folds'>,
  cell: PrintFinalSheetCell,
): PrintFinalSheetPlacement {
  if (sheet.folds) {
    throw new RangeError('A tent prints its front on both faces: it has no back to place')
  }
  const { leftPt, topPt, widthPt, heightPt } = printFinalBackCell(sheet, cell)
  return { leftPt, topPt, widthPt, heightPt, turnDeg: cell.turned ? 90 : 0 }
}
