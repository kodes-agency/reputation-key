// The final print kit's Immersive office sheets (final design spec §10.1 and
// §10.2): the geometry table of the twelve sheets, piece × orientation × paper,
// copied from the generator that drew and measured the boards
// (`final-sheets.mjs`, `layoutFor`, look `imm`), in the units the spec states
// them in: inches on Letter, millimetres on A4. Pure and shared, so the PDF and
// the Share tab's preview place the same pieces in the same cells.
//
// What sets Immersive apart from Paper (`portal-print-final-sheets.ts`):
//   - Each piece carries its own bleed (1/8 in, or 3 mm) and its own crop marks,
//     with a gap between pieces, so no two share a cut: a sheet holds 2 Counter
//     cards, 2 tents (flats) and 8 Small cards on Letter (9 on A4). The abutting
//     4-up of today's Table tent is not made here.
//   - The gap is at least twice the bleed, so one piece's bleed never runs onto
//     the next: the Small card sheets keep exactly that (0.25 in, or 6 mm).
//   - The trim keeps the Paper ink's distances from the paper's edges: 0.5 in from
//     the short edges, 0.34 in from the long ones. The bleed may run into the
//     inkjet band, because a clipped bleed is cut away: the A4 9-up's colour comes
//     0.47 in from the short edges.
//   - The grid turns with the piece, as on Paper, and a piece never turns in its
//     cell: no Counter card lies across a strip. A tent's cell is its flat, two
//     faces joined at the fold, so the bleed runs round the flat and not through
//     the fold.

import { printFinalRegionOf, type PrintFinalLook } from './portal-print-final'
import type { PrintFinalBleed } from './portal-print-final-layers'
import { PRINT_FINAL_DISTANCES } from './portal-print-final-measures'
import {
  grid,
  printFinalPaperSheet,
  sheetOf,
  type PrintFinalSheet,
  type PrintFinalSheetKey,
  type Row,
  type Rows,
  type SheetRows,
} from './portal-print-final-sheets'

/** `cols` × `rows` cells, `gap` apart, centred on the page (width, height as the sheet is turned). */
function centred(
  cell: readonly [w: number, h: number],
  cols: number,
  rows: number,
  gap: number,
  page: readonly [w: number, h: number],
): readonly Row[] {
  const across = cols * cell[0] + (cols - 1) * gap
  const down = rows * cell[1] + (rows - 1) * gap
  return grid(cell, cols, rows, [(page[0] - across) / 2, (page[1] - down) / 2], gap)
}

/** Every Immersive piece is cut one by one on its own crop marks. */
const cut = (landscape: boolean, rows: readonly Row[]): SheetRows => ({
  landscape,
  kind: 'cards',
  rows,
})

const LETTER_PORTRAIT = [8.5, 11] as const
const LETTER_LANDSCAPE = [11, 8.5] as const
const A4_PORTRAIT = [210, 297] as const
const A4_LANDSCAPE = [297, 210] as const

/** Letter, in inches. */
const LETTER: Rows = {
  counter: {
    upright: cut(true, centred([4, 6], 2, 1, 0.75, LETTER_LANDSCAPE)),
    wide: cut(false, centred([6, 4], 1, 2, 0.75, LETTER_PORTRAIT)),
  },
  tent: {
    wide: cut(true, centred([4.25, 5.5], 2, 1, 0.75, LETTER_LANDSCAPE)),
    upright: cut(false, centred([2.75, 8.5], 2, 1, 0.75, LETTER_PORTRAIT)),
  },
  small: {
    wide: cut(false, centred([3.5, 2], 2, 4, 0.25, LETTER_PORTRAIT)),
    upright: cut(true, centred([2, 3.5], 4, 2, 0.25, LETTER_LANDSCAPE)),
  },
}

/** A4, in millimetres. */
const A4: Rows = {
  counter: {
    upright: cut(true, centred([105, 148], 2, 1, 18, A4_LANDSCAPE)),
    wide: cut(false, centred([148, 105], 1, 2, 18, A4_PORTRAIT)),
  },
  tent: {
    wide: cut(true, centred([105, 148.5], 2, 1, 18, A4_LANDSCAPE)),
    upright: cut(false, centred([74.25, 210], 2, 1, 18, A4_PORTRAIT)),
  },
  small: {
    wide: cut(true, centred([85, 54], 3, 3, 6, A4_LANDSCAPE)),
    upright: cut(false, centred([54, 85], 3, 3, 6, A4_PORTRAIT)),
  },
}

/** One Immersive sheet: pieces with their own bleed and crop marks, a gap apart. */
export function printFinalImmersiveSheet(key: PrintFinalSheetKey): PrintFinalSheet {
  const table = key.paper === 'letter' ? LETTER : A4
  const bleedPt = PRINT_FINAL_DISTANCES.bleedPt[printFinalRegionOf(key.paper)]
  return sheetOf(key, 'immersive', bleedPt, table[key.piece][key.orientation])
}

/** The office sheet one look of a piece goes on, in an orientation, on a paper. */
export function printFinalSheet(
  key: PrintFinalSheetKey & Readonly<{ look: PrintFinalLook }>,
): PrintFinalSheet {
  const { look: _look, ...place } = key
  return key.look === 'paper'
    ? printFinalPaperSheet(place)
    : printFinalImmersiveSheet(place)
}

/**
 * How far one face's art runs past each trim edge on a sheet, in the face's own
 * frame: the sheet's bleed on every edge, except a tent's top, which is its
 * fold, where the flat's two faces meet. Paper has none.
 */
export function printFinalSheetFaceBleed(
  sheet: Pick<PrintFinalSheet, 'piece' | 'bleedPt'>,
): PrintFinalBleed {
  const { bleedPt } = sheet
  return {
    leftPt: bleedPt,
    rightPt: bleedPt,
    bottomPt: bleedPt,
    topPt: sheet.piece === 'tent' ? 0 : bleedPt,
  }
}
