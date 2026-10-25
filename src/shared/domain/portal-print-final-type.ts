// The final print kit's type (final design spec §3, §5.3 and §8): the sizes
// per piece, the faces, the leading and tracking, the long-copy step and the
// rules that hold between the sizes. The same in both orientations and both
// regions: only the wrap changes.

import type {
  PrintFinalLook,
  PrintFinalOrientation,
  PrintFinalPiece,
} from './portal-print-final'

export type PrintFinalFamily = 'serif' | 'sans'

/** One piece's type scale, in points. */
export type PrintFinalTypeScale = Readonly<{
  /** The property name in tracked capitals when there is no logo. */
  wordmarkPt: number
  /** The page title above the headline; the Small card has none. */
  kickerPt: number | null
  headlinePt: number
  sublinePt: number
  /** The second language's headline when both languages print in full. */
  secondHeadlinePt: number
  /** The second language as one small italic line (upright tent and Small card), at the sub-line's size. */
  secondLinePt: number
  /** The back page's property name. */
  namePt: number
  headlineFamily: PrintFinalFamily
  headlineLeading: number
  headlineTrackingEm: number
}>

export const PRINT_FINAL_TYPE: Readonly<Record<PrintFinalPiece, PrintFinalTypeScale>> =
  Object.freeze({
    counter: {
      wordmarkPt: 14,
      kickerPt: 9.5,
      headlinePt: 28,
      sublinePt: 11,
      secondHeadlinePt: 15,
      secondLinePt: 11,
      namePt: 9,
      headlineFamily: 'serif',
      headlineLeading: 1.02,
      headlineTrackingEm: -0.005,
    },
    tent: {
      wordmarkPt: 11,
      kickerPt: 8,
      headlinePt: 19,
      sublinePt: 9,
      secondHeadlinePt: 12.5,
      secondLinePt: 9,
      namePt: 8,
      headlineFamily: 'serif',
      headlineLeading: 1.02,
      headlineTrackingEm: -0.005,
    },
    small: {
      wordmarkPt: 8.5,
      kickerPt: null,
      headlinePt: 15,
      sublinePt: 8,
      secondHeadlinePt: 10,
      secondLinePt: 8,
      namePt: 8,
      headlineFamily: 'sans',
      headlineLeading: 1.08,
      headlineTrackingEm: -0.01,
    },
  })

/** What every piece shares: the leading and tracking of the roles that do not change per piece. */
export const PRINT_FINAL_TYPE_SETTINGS = Object.freeze({
  wordmark: Object.freeze({ leading: 1.15, trackingEm: 0.3 }),
  kicker: Object.freeze({ leading: 1.15 }),
  subline: Object.freeze({ leading: 1.25 }),
  cue: Object.freeze({ leading: 1.12, lineGapMm: 0.3 }),
  name: Object.freeze({ leading: 1.25, trackingEm: 0.08 }),
  /** The headline is at least this many times the sub-line (rule 1.6). */
  headlineToSubline: 1.8,
  /** The second language's headline is at least this many times its own sub-line (§3, amended). */
  secondHeadlineToSubline: 1.25,
  /** Reversed type under this size is set semibold. */
  reversedRegularFloorPt: 9,
})

/**
 * How many lines a piece's words may take (§3): the headline 3, the sub-line 2,
 * on every piece. A 4-line headline reads as a paragraph, so it is refused even
 * where the group gaps would hold; the long-copy step tries a smaller size first.
 */
export const PRINT_FINAL_LINE_CAPS = Object.freeze({ headline: 3, subline: 2 })

/** The kicker's tracking: 0.16 em on Paper; on Immersive 0.30 em upright and 0.24 em wide. */
export function printFinalKickerTrackingEm(
  look: PrintFinalLook,
  orientation: PrintFinalOrientation,
): number {
  if (look === 'paper') return 0.16
  return orientation === 'upright' ? 0.3 : 0.24
}

/** The sub-line's weight: 400, except reversed under 9 pt, which turns 600 (the Immersive Small card). */
export function printFinalSublineWeight(
  piece: PrintFinalPiece,
  look: PrintFinalLook,
): 400 | 600 {
  const reversed = look === 'immersive'
  return reversed &&
    PRINT_FINAL_TYPE[piece].sublinePt < PRINT_FINAL_TYPE_SETTINGS.reversedRegularFloorPt
    ? 600
    : 400
}

// ---------------------------------------------------------------------------
// Long copy (§5.3)

/**
 * The smallest headline a piece may step down to: 1.8 × its sub-line, rounded
 * up to the half point (20 pt Counter, 16.5 pt tent, 14.5 pt Small).
 */
export function printFinalHeadlineFloorPt(piece: PrintFinalPiece): number {
  const { sublinePt } = PRINT_FINAL_TYPE[piece]
  return Math.ceil(sublinePt * PRINT_FINAL_TYPE_SETTINGS.headlineToSubline * 2) / 2
}

/** The headline sizes long copy may try, largest first: 1 pt at a time, the floor last. */
export function printFinalHeadlineSteps(piece: PrintFinalPiece): readonly number[] {
  const floor = printFinalHeadlineFloorPt(piece)
  const steps: number[] = []
  for (let pt = PRINT_FINAL_TYPE[piece].headlinePt; pt > floor; pt -= 1) steps.push(pt)
  return [...steps, floor]
}

export type PrintFinalHeadlineChoice = Readonly<{
  headlinePt: number
  /** True when even the floor does not fit every orientation: the words are too long to fit both. */
  overflows: boolean
}>

/**
 * The headline size a piece prints at. Type never grows to fill space; when the
 * words cannot fit with 4u group gaps, the headline steps down 1 pt at a time,
 * and both orientations of the piece take the same step, so `fitsAt` answers
 * for both. It never goes under the floor; at the floor the words print as they
 * fall.
 */
export function choosePrintFinalHeadline(
  piece: PrintFinalPiece,
  fitsAt: (headlinePt: number) => boolean,
): PrintFinalHeadlineChoice {
  const steps = printFinalHeadlineSteps(piece)
  const fitting = steps.find((pt) => fitsAt(pt))
  return fitting === undefined
    ? {
        headlinePt: steps[steps.length - 1] ?? PRINT_FINAL_TYPE[piece].headlinePt,
        overflows: true,
      }
    : { headlinePt: fitting, overflows: false }
}

// ---------------------------------------------------------------------------
// The rules between the sizes

export type PrintFinalTypeProblem =
  'headline_under_floor' | 'second_headline_too_small' | 'second_headline_not_smaller'

/**
 * What breaks the ratio rules: the headline at least 1.8 × the sub-line; the
 * second language's headline at least 1.25 × its own sub-line (not 1.8 ×,
 * which cannot hold at the type floors) and smaller than the first headline.
 */
export function printFinalTypeProblems(
  piece: PrintFinalPiece,
  headlinePt: number,
  secondHeadlinePt: number | null,
): readonly PrintFinalTypeProblem[] {
  const scale = PRINT_FINAL_TYPE[piece]
  const settings = PRINT_FINAL_TYPE_SETTINGS
  const problems: PrintFinalTypeProblem[] = []
  if (headlinePt < scale.sublinePt * settings.headlineToSubline) {
    problems.push('headline_under_floor')
  }
  if (secondHeadlinePt === null) return problems
  if (secondHeadlinePt < scale.sublinePt * settings.secondHeadlineToSubline) {
    problems.push('second_headline_too_small')
  }
  if (secondHeadlinePt >= headlinePt) problems.push('second_headline_not_smaller')
  return problems
}
