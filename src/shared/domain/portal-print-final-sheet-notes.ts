// The printed note on a final office sheet (final design spec §10.1): set in
// Ysabeau Office 400 at 6.5 pt, 1.3 apart, in soft grey. It reads "Print at
// Actual size (100%): each cream code square measures …" and the cutting step,
// and sits where nothing else is printed: never on a piece, its bleed, a mark or
// a fold mark, at least 0.27 in from every edge, and out of the 0.55 in at the
// paper's short edge, where an inkjet may stop. Copied from the generator that
// drew the boards (`final-sheets.mjs`, `notesFor`).
//
// A sheet with no free paper carries no note: Paper quarters and strips, and the
// Letter Immersive upright Small card sheet. Their PDF asks the print dialog for
// Actual size instead (`PrintScaling /None`), and How to print asks the manager
// to measure one code.

import type { PrintFinalRegion } from './portal-print-final'
import { inPt, mmPt } from './portal-print-final-measures'
import {
  printFinalSheetCuts,
  type PrintFinalSheet,
  type PrintFinalSheetCell,
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

/** An Immersive sheet's note: the cutting step, after the size sentence unless `text` words the whole of it. */
type ImmersiveNoteRow = Readonly<{ box: Box; text: (tile: string) => string }>

const sized =
  (rest: string): ImmersiveNoteRow['text'] =>
  (tile) =>
    `${SIZE_SENTENCE(tile)} ${rest}`

const SCORE_AND_FOLD =
  'Cut on the crop marks. Score the fold with a ruler and a dry ballpoint, then fold on the dashed marks.'
const COUNTER_BLEED_LETTER =
  'Cut on the crop marks: the colour runs 1/8 in past each edge.'
const COUNTER_BLEED_A4 = 'Cut on the crop marks: the colour runs 3 mm past each edge.'

/** Where each Immersive sheet's note goes, in the paper's unit; the Letter upright Small card sheet has no free paper. */
const IMMERSIVE_LETTER: Readonly<Record<string, readonly ImmersiveNoteRow[]>> = {
  'counter-upright': [
    {
      box: [1.125, 0.38, 8.75, 0.24],
      text: sized(
        'Cut on the crop marks: the colour runs 1/8 in past each edge, so a cut that wanders does not show white.',
      ),
    },
  ],
  'counter-wide': [{ box: [1.3, 5.32, 5.9, 0.36], text: sized(COUNTER_BLEED_LETTER) }],
  'tent-wide': [{ box: [0.875, 0.4, 9.25, 0.5], text: sized(SCORE_AND_FOLD) }],
  'tent-upright': [
    {
      box: [1.125, 0.56, 6.25, 0.15],
      text: sized('Cut on the crop marks, score, fold on the dashed marks.'),
    },
  ],
  'small-wide': [
    {
      box: [0.625, 0.3, 7.25, 0.3],
      text: sized('Cut on the crop marks; every card has its own 1/8 in bleed.'),
    },
  ],
}

/** The A4 Small card sheets' notes sit on one line in a gap 3.4 mm high, so they say it shorter. */
const IMMERSIVE_A4: Readonly<Record<string, readonly ImmersiveNoteRow[]>> = {
  'counter-upright': [{ box: [34.5, 9, 228, 8], text: sized(COUNTER_BLEED_A4) }],
  'counter-wide': [{ box: [31, 14.5, 148, 7], text: sized(COUNTER_BLEED_A4) }],
  'tent-wide': [{ box: [34.5, 9, 228, 9], text: sized(SCORE_AND_FOLD) }],
  'tent-upright': [{ box: [21.75, 15, 166.5, 14], text: sized(SCORE_AND_FOLD) }],
  'small-upright': [
    { box: [80, 7.2, 50, 3.4], text: (tile) => `Actual size (100%): code ${tile}.` },
  ],
  'small-wide': [
    {
      box: [108, 9, 81, 3.4],
      text: (tile) => `Actual size (100%): code square ${tile}. Cut on the crop marks.`,
    },
  ],
}

function immersiveNotes(
  sheet: PrintFinalSheet,
  tile: string,
): readonly PrintFinalSheetNote[] {
  const letter = sheet.paper === 'letter'
  const rows = (letter ? IMMERSIVE_LETTER : IMMERSIVE_A4)[
    `${sheet.piece}-${sheet.orientation}`
  ]
  const unit = letter ? inPt : mmPt
  return (rows ?? []).map(({ box: [x, y, w, h], text }) => ({
    leftPt: unit(x),
    topPt: unit(y),
    widthPt: unit(w),
    heightPt: unit(h),
    text: text(tile),
  }))
}

function textOf(
  says: NoteRow['says'],
  sheet: PrintFinalSheet,
  cells: readonly PrintFinalSheetCell[],
  tile: string,
): string {
  if (says === 'size') return SIZE_SENTENCE(tile)
  if (says === 'strip') {
    // The turned card lies across the strip: with no card there, there is no strip to cut off.
    const stripHasCard = cells.some((cell) => cell.turned)
    if (!stripHasCard) return `${SIZE_SENTENCE(tile)} Cut each card on the grey ticks.`
    const side = sheet.orientation === 'upright' ? 'lower' : 'right-hand'
    return `${SIZE_SENTENCE(tile)} Cut the ${side} strip off first, then each card on the grey ticks.`
  }
  const cuts = printFinalSheetCuts(sheet, cells)
  return `Cut on the grey ticks: ${cuts.xsPt.length} lines down, ${cuts.ysPt.length} across.`
}

/**
 * The notes a sheet prints, for the code's cream square of `tilePt`. They say
 * what the sheet holds: on a last sheet with fewer pieces (`cells`, the first of
 * its cells) the cut count, and the lower strip, follow the pieces that are there.
 */
export function printFinalSheetNotes(
  sheet: PrintFinalSheet,
  tilePt: number,
  cells: readonly PrintFinalSheetCell[] = sheet.cells,
): readonly PrintFinalSheetNote[] {
  const letter = sheet.paper === 'letter'
  const tile = printFinalTileLabel(tilePt, letter ? 'us' : 'eu')
  if (sheet.look === 'immersive') return immersiveNotes(sheet, tile)
  const rows = (letter ? LETTER : A4)[`${sheet.piece}-${sheet.orientation}`] ?? []
  const unit = letter ? inPt : mmPt
  return rows.map(({ box: [x, y, w, h], says }) => ({
    leftPt: unit(x),
    topPt: unit(y),
    widthPt: unit(w),
    heightPt: unit(h),
    text: textOf(says, sheet, cells, tile),
  }))
}
