// The marks on a final Paper office sheet (final design spec §10.1): grey cut
// ticks where a card sheet is cut, and dashed fold marks on a tent flat's fold
// line. Pure and shared: the PDF draws them, the Share tab's preview draws the
// same ones.
//
// Each cut line gets one tick just beyond each end of the pieces it bounds,
// 0.06 in clear of them and 0.3 in long. A tick is clipped so it never touches
// a piece and so its ends stay at least 0.27 in from the sheet's edge; where a
// line has no room outside its pieces at all, a short tick sits on the line
// itself in the 0.27 to 0.47 in band (the Letter Counter sheet's named
// exception: its cards fill the sheet's width). Quarters and strips carry no
// ticks. Copied from the generator that drew the boards (`final-sheets.mjs`,
// `marks` and `foldMarks`).

import {
  printFinalSheetCuts,
  type PrintFinalPaperSheet,
  type PrintFinalSheetCell,
} from './portal-print-final-sheets'
import { inPt, mmPt } from './portal-print-final-measures'

export const PRINT_FINAL_SHEET_MARKS = Object.freeze({
  /** Cut ticks and fold marks are this grey on Paper. */
  colour: '#9C968E',
  tickWeightPt: mmPt(0.24),
  foldWeightPt: mmPt(0.25),
  /** A dash and the gap after it, along a fold mark. */
  foldDashPt: mmPt(0.6),
  tickLengthPt: inPt(0.3),
  /** A tick shorter than this is not drawn. */
  tickMinLengthPt: inPt(0.08),
  /** A tick starts this far beyond the pieces it bounds, and stays this far from any piece. */
  tickGapPt: inPt(0.06),
  /** A mark's ends stay this far from the sheet's edge. */
  edgePt: inPt(0.27),
  throughLengthPt: inPt(0.2),
  foldLengthPt: inPt(0.18),
  /** A fold mark starts this far inside the flat. */
  foldInsetPt: inPt(0.02),
})

export type PrintFinalSheetMark = Readonly<{
  kind: 'tick' | 'through' | 'fold'
  /** The mark's centre line; a vertical mark has x0Pt === x1Pt and a horizontal one y0Pt === y1Pt. */
  x0Pt: number
  y0Pt: number
  x1Pt: number
  y1Pt: number
}>

/** Two edges this close lie on one line. */
const SAME_LINE_PT = 0.07
/** A span this close to touching a piece's far side still clips against it. */
const CLIP_SLACK_PT = 0.07

/** A box in a cut line's own frame: `a` runs across the line, `b` along it. */
type Span = readonly [a0: number, b0: number, a1: number, b1: number]

const sameLine = (a: number, b: number) => Math.abs(a - b) < SAME_LINE_PT

/**
 * The part of `lo..hi`, along a cut line at `at`, that stays clear of every
 * piece the line crosses; null when less than the shortest tick is left. `dir`
 * says which end stands against a piece: -1 for the low end, 1 for the high.
 */
function clearSpan(
  boxes: readonly Span[],
  at: number,
  range: readonly [lo: number, hi: number],
  dir: -1 | 1,
): readonly [number, number] | null {
  const { tickMinLengthPt, tickGapPt } = PRINT_FINAL_SHEET_MARKS
  let [lo, hi] = range
  for (const [a0, b0, a1, b1] of boxes) {
    const crosses = at >= a0 - CLIP_SLACK_PT && at <= a1 + CLIP_SLACK_PT
    const overlaps = b1 > lo + 1e-6 && b0 < hi - 1e-6
    if (!crosses || !overlaps) continue
    if (dir < 0) lo = Math.max(lo, b1 + tickGapPt)
    else hi = Math.min(hi, b0 - tickGapPt)
  }
  return hi - lo >= tickMinLengthPt ? [lo, hi] : null
}

type Frame = Readonly<{
  /** The cells as boxes in the line's frame. */
  boxes: readonly Span[]
  /** How far the page runs along the line. */
  extentPt: number
  /** The marks as the page sees them, from a line `a` and a stretch along it. */
  mark: (
    kind: 'tick' | 'through',
    a: number,
    b0: number,
    b1: number,
  ) => PrintFinalSheetMark
}>

function lineMarks(
  frame: Frame,
  at: number,
  throughStretches: readonly (readonly [number, number])[],
): readonly PrintFinalSheetMark[] {
  const { tickLengthPt, tickGapPt, edgePt } = PRINT_FINAL_SHEET_MARKS
  const on = frame.boxes.filter(([a0, , a1]) => sameLine(a0, at) || sameLine(a1, at))
  const start = Math.min(...on.map(([, b0]) => b0))
  const end = Math.max(...on.map(([, , , b1]) => b1))
  const spans = [
    clearSpan(
      frame.boxes,
      at,
      [Math.max(edgePt, start - tickGapPt - tickLengthPt), start - tickGapPt],
      -1,
    ),
    clearSpan(
      frame.boxes,
      at,
      [
        end + tickGapPt,
        Math.min(frame.extentPt - edgePt, end + tickGapPt + tickLengthPt),
      ],
      1,
    ),
  ]
  const ticks = spans.flatMap((span) =>
    span === null ? [] : [frame.mark('tick', at, span[0], span[1])],
  )
  if (ticks.length > 0) return ticks
  return throughStretches.map(([b0, b1]) => frame.mark('through', at, b0, b1))
}

function cutMarks(
  sheet: PrintFinalPaperSheet,
  cells: readonly PrintFinalSheetCell[],
): readonly PrintFinalSheetMark[] {
  const { edgePt, throughLengthPt } = PRINT_FINAL_SHEET_MARKS
  const cuts = printFinalSheetCuts(sheet, cells)
  const down: Frame = {
    boxes: cells.map((c) => [
      c.leftPt,
      c.topPt,
      c.leftPt + c.widthPt,
      c.topPt + c.heightPt,
    ]),
    extentPt: sheet.heightPt,
    mark: (kind, x, y0, y1) => ({ kind, x0Pt: x, y0Pt: y0, x1Pt: x, y1Pt: y1 }),
  }
  const across: Frame = {
    boxes: cells.map((c) => [
      c.topPt,
      c.leftPt,
      c.topPt + c.heightPt,
      c.leftPt + c.widthPt,
    ]),
    extentPt: sheet.widthPt,
    mark: (kind, y, x0, x1) => ({ kind, x0Pt: x0, y0Pt: y, x1Pt: x1, y1Pt: y }),
  }
  return [
    // A vertical line with no room outside its pieces keeps one tick at the top ...
    ...cuts.xsPt.flatMap((x) => lineMarks(down, x, [[edgePt, edgePt + throughLengthPt]])),
    // ... a horizontal one keeps one at each side.
    ...cuts.ysPt.flatMap((y) =>
      lineMarks(across, y, [
        [edgePt, edgePt + throughLengthPt],
        [sheet.widthPt - edgePt - throughLengthPt, sheet.widthPt - edgePt],
      ]),
    ),
  ]
}

/** A tent flat's fold: a dashed mark just inside each end of its middle line, never nearer the sheet's edge than 0.29 in. */
function foldMarks(
  sheet: PrintFinalPaperSheet,
  cells: readonly PrintFinalSheetCell[],
): readonly PrintFinalSheetMark[] {
  const { edgePt, foldLengthPt, foldInsetPt } = PRINT_FINAL_SHEET_MARKS
  return cells.flatMap((cell) => {
    const y = cell.topPt + cell.heightPt / 2
    const left = Math.max(cell.leftPt, edgePt) + foldInsetPt
    const right =
      Math.min(cell.leftPt + cell.widthPt, sheet.widthPt - edgePt) -
      foldInsetPt -
      foldLengthPt
    return [left, right].map((x): PrintFinalSheetMark => ({
      kind: 'fold',
      x0Pt: x,
      y0Pt: y,
      x1Pt: x + foldLengthPt,
      y1Pt: y,
    }))
  })
}

/** Every mark a sheet carries round the pieces it holds (`cells`, the first of its cells). */
export function printFinalSheetMarks(
  sheet: PrintFinalPaperSheet,
  cells: readonly PrintFinalSheetCell[],
): readonly PrintFinalSheetMark[] {
  return [
    ...(sheet.kind === 'cards' ? cutMarks(sheet, cells) : []),
    ...(sheet.folds ? foldMarks(sheet, cells) : []),
  ]
}

/** A tick as the filled rectangle it is drawn as: the centre line widened by the tick's weight. */
export function printFinalTickRect(mark: PrintFinalSheetMark) {
  const half = PRINT_FINAL_SHEET_MARKS.tickWeightPt / 2
  const vertical = mark.x0Pt === mark.x1Pt
  return {
    leftPt: vertical ? mark.x0Pt - half : mark.x0Pt,
    topPt: vertical ? mark.y0Pt : mark.y0Pt - half,
    widthPt: vertical ? 2 * half : mark.x1Pt - mark.x0Pt,
    heightPt: vertical ? mark.y1Pt - mark.y0Pt : 2 * half,
  }
}
