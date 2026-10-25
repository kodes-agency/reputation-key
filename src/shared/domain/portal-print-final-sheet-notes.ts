// The printed note on a final Paper office sheet (final design spec §10.1): set
// in Ysabeau Office 400 at 6.5 pt, 1.3 apart, in soft grey. It reads "Print at
// Actual size (100%): each cream code square measures …" and the cutting step,
// and sits where nothing else is printed: never on a piece, a mark or a fold
// mark, at least 0.27 in from every edge, and out of the 0.55 in at the paper's
// short edge, where an inkjet may stop. Copied from the generator that drew the
// boards (`final-sheets.mjs`, `notesFor`).
//
// A sheet with no free paper carries no note: quarters and strips. Their PDF
// asks the print dialog for Actual size instead (`PrintScaling /None`), and How
// to print asks the manager to measure one code.

import type { PrintFinalRegion } from './portal-print-final'
import { inPt, mmPt } from './portal-print-final-measures'
import {
  printFinalSheetCuts,
  type PrintFinalPaperSheet,
} from './portal-print-final-sheets'

export const PRINT_FINAL_SHEET_NOTE = Object.freeze({
  sizePt: 6.5,
  leading: 1.3,
  colour: '#5C5650',
  /** Never within this of the paper's short edge, and never within `edgePt` of any edge. */
  shortEdgeBandPt: inPt(0.55),
  edgePt: inPt(0.27),
})

/** A note's box: its width, and the height it may take; its text wraps inside the width. */
export type PrintFinalSheetNote = Readonly<{
  leftPt: number
  topPt: number
  widthPt: number
  heightPt: number
  text: string
}>

/** A code's cream square as the note names it: "1.5 in (3.8 cm)" on Letter, "38 mm" on A4. */
export function printFinalTileLabel(tilePt: number, region: PrintFinalRegion): string {
  if (region === 'eu') return `${Math.round((tilePt / 72) * 25.4)} mm`
  const inches = tilePt / 72
  return `${Number(inches.toFixed(2))} in (${(inches * 2.54).toFixed(1)} cm)`
}

type Box = readonly [x: number, y: number, w: number, h: number]
type NoteRow = Readonly<{ box: Box; says: 'size' | 'cut' | 'strip' }>

const SIZE_SENTENCE = (tile: string) =>
  `Print at Actual size (100%): each cream code square measures ${tile}.`

/** Where each Paper card sheet's notes go, in the paper's unit; the rest carry none. */
const LETTER: Readonly<Record<string, readonly NoteRow[]>> = {
  'counter-upright': [{ box: [0.3, 6.8, 0.88, 1.0], says: 'strip' }],
  'counter-wide': [{ box: [6.8, 0.38, 3.65, 0.36], says: 'strip' }],
  'small-wide': [
    { box: [0.85, 0.3, 3.3, 0.13], says: 'size' },
    { box: [4.35, 0.3, 3.3, 0.13], says: 'cut' },
  ],
  'small-upright': [
    { box: [2.6, 0.36, 1.8, 0.36], says: 'size' },
    { box: [4.6, 0.36, 1.8, 0.36], says: 'cut' },
  ],
}

const A4: Readonly<Record<string, readonly NoteRow[]>> = {
  'small-wide': [
    { box: [22, 7.4, 81, 4], says: 'size' },
    { box: [107, 7.4, 81, 4], says: 'cut' },
  ],
  'small-upright': [
    { box: [69.5, 9, 50, 9], says: 'size' },
    { box: [123.5, 9, 50, 9], says: 'cut' },
  ],
}

function textOf(
  says: NoteRow['says'],
  sheet: PrintFinalPaperSheet,
  tile: string,
): string {
  if (says === 'size') return SIZE_SENTENCE(tile)
  if (says === 'strip') {
    const side = sheet.orientation === 'upright' ? 'lower' : 'right-hand'
    return `${SIZE_SENTENCE(tile)} Cut the ${side} strip off first, then each card on the grey ticks.`
  }
  const cuts = printFinalSheetCuts(sheet, sheet.cells)
  return `Cut on the grey ticks: ${cuts.xsPt.length} lines down, ${cuts.ysPt.length} across.`
}

/** The notes a sheet prints, for the code's cream square of `tilePt`. */
export function printFinalSheetNotes(
  sheet: PrintFinalPaperSheet,
  tilePt: number,
): readonly PrintFinalSheetNote[] {
  const letter = sheet.paper === 'letter'
  const rows = (letter ? LETTER : A4)[`${sheet.piece}-${sheet.orientation}`] ?? []
  const unit = letter ? inPt : mmPt
  const tile = printFinalTileLabel(tilePt, letter ? 'us' : 'eu')
  return rows.map(({ box: [x, y, w, h], says }) => ({
    leftPt: unit(x),
    topPt: unit(y),
    widthPt: unit(w),
    heightPt: unit(h),
    text: textOf(says, sheet, tile),
  }))
}
