// The final print's small marks (final design spec §5.1 and §5.4): the five
// outline stars above the Counter card's kicker, and the short rule between two
// languages. Both are placed by their ink like the words: the stars by their
// outlines and half their stroke, the rule by its box. Pure and shared, so the
// PDF and the Share tab's preview draw the same marks in the same place.

import type { PrintFinalPiece } from './portal-print-final'
import {
  PRINT_FINAL_DISTANCES,
  PRINT_FINAL_RULE_LENGTH_PT,
  PRINT_FINAL_STARS,
} from './portal-print-final-measures'

/** One star, drawn on a 24-unit grid (the boards' path). */
export const PRINT_FINAL_STAR = Object.freeze({
  grid: 24,
  path: 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z',
  /** The outline's extent on the grid: the path's corner points. */
  ink: Object.freeze({ left: 2.8, top: 2.8, right: 21.2, bottom: 20.3 }),
})

export type PrintFinalStars = Readonly<{
  /** Each star's grid origin (its 24-unit square's top-left), from the row's ink top-left. */
  origins: readonly Readonly<{ xPt: number; yPt: number }>[]
  /** The side of one star's 24-unit square. */
  sizePt: number
  strokePt: number
  /** The row's ink box: the outlines and half the stroke round them. */
  widthPt: number
  heightPt: number
}>

/** Whether a piece prints the stars: the Counter card only. */
export const printFinalHasStars = (piece: PrintFinalPiece): boolean =>
  PRINT_FINAL_STARS.pieces.includes(piece)

/** The row of stars: five, 0.38 × their size apart, measured by their ink. */
export function printFinalStars(): PrintFinalStars {
  const { count, sizePt, gapShare, strokePt } = PRINT_FINAL_STARS
  const { grid, ink } = PRINT_FINAL_STAR
  const unit = sizePt / grid
  const pitch = sizePt * (1 + gapShare)
  const inset = { x: ink.left * unit - strokePt / 2, y: ink.top * unit - strokePt / 2 }
  const origins = Array.from({ length: count }, (_, index) => ({
    xPt: index * pitch - inset.x,
    yPt: -inset.y,
  }))
  return {
    origins,
    sizePt,
    strokePt,
    widthPt: (count - 1) * pitch + (ink.right - ink.left) * unit + strokePt,
    heightPt: (ink.bottom - ink.top) * unit + strokePt,
  }
}

/** The rule between two languages: its box, which is its ink. */
export function printFinalRule(piece: PrintFinalPiece) {
  return {
    widthPt: PRINT_FINAL_RULE_LENGTH_PT[piece],
    heightPt: PRINT_FINAL_DISTANCES.ruleThicknessPt,
  }
}
