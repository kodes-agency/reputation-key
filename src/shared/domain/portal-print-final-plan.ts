// The final print's layout (final design spec §2.3): two planners, one per
// orientation, shared by the PDF and the Share tab's preview. Each takes the
// parts of a face measured by their ink (type by its glyph bounds, the logo by
// its drawn pixels, the plate, the rule and the code block by their boxes) and
// returns where each part's ink goes, in points from the trim's top-left corner.
// The renderer turns an ink position into a drawing position with the offsets
// it measured; the planner never sees a font.
//
// Three groups: brand (the logo, its plate or the wordmark), message (stars,
// kicker, headline, sub-line, second language) and code (tile and bar). Inside a
// group, 1u; round the rule before the second language, 2u.
//   - Upright: the groups down one centreline. Group gaps grow equally from 4u
//     to 8u; whatever is left splits 44 : 56 into the top and bottom margins.
//   - Wide: the code block on the right margin line; the brand 4u above the
//     message as one flush-left block. Both are centred on one line, and the
//     taller of the two is placed 44 : 56 in the live height. On a tent, a
//     headline whose cap-top would fall below 54 % of the face lifts the block,
//     never above the top margin.
// Type never grows to fill space. A face whose gaps fall under 4u says so
// (`fits`), and the long-copy step (`choosePrintFinalHeadline`) tries a smaller
// headline.

import type { PrintFinalFace } from './portal-print-final'
import type {
  PrintFinalPlacedPart,
  PrintFinalPlanInput,
} from './portal-print-final-parts'
import {
  mmPt,
  printFinalLiveArea,
  type PrintFinalBox,
} from './portal-print-final-measures'
import {
  placeUprightStack,
  placeWideBlock,
  type PlannedGroups,
} from './portal-print-final-planners'

export type PrintFinalProblem = 'gap_under_4u' | 'taller_than_live'

export type PrintFinalPlan = Readonly<{
  face: PrintFinalFace
  widthPt: number
  heightPt: number
  unitPt: number
  marginPt: number
  live: PrintFinalBox
  foldStripPt: number
  /** The column the words wrap in. */
  column: Readonly<{ leftPt: number; rightPt: number }>
  parts: readonly PrintFinalPlacedPart[]
  /** The code block's outer box (the Paper outline included). */
  code: PrintFinalBox
  /** Each group's ink span; null for a group with no parts. */
  groups: Readonly<{
    brand: PrintFinalBox | null
    message: PrintFinalBox | null
    code: PrintFinalBox
  }>
  /**
   * Upright: the two group gaps. Wide: the brand to the message, the gutter from
   * the ragged-right words to the code block, and from the brand to the code
   * block (a wordmark can be wider than the words).
   */
  gapsPt: Readonly<{
    brandToMessage: number | null
    messageToCode: number
    brandToCode: number | null
  }>
  fits: boolean
  problems: readonly PrintFinalProblem[]
}>

/** A gap counts as 4u unless it is short by more than this (§5.3: the strict 4u). */
const PRINT_FINAL_GAP_TOLERANCE_PT = mmPt(0.05)

/**
 * The column the words wrap in: the live width upright; wide, from the left
 * margin to one M short of the tile (the gutter is at least 4u).
 */
export function printFinalTextColumn(
  face: PrintFinalFace,
  tilePt: number,
): Readonly<{ leftPt: number; rightPt: number }> {
  const area = printFinalLiveArea(face)
  const { leftPt, rightPt } = area.live
  return face.orientation === 'upright'
    ? { leftPt, rightPt }
    : { leftPt, rightPt: rightPt - tilePt - area.marginPt }
}

function spanOf(parts: readonly PrintFinalPlacedPart[]): PrintFinalBox | null {
  if (parts.length === 0) return null
  return {
    leftPt: Math.min(...parts.map((p) => p.xPt)),
    topPt: Math.min(...parts.map((p) => p.yPt)),
    rightPt: Math.max(...parts.map((p) => p.xPt + p.widthPt)),
    bottomPt: Math.max(...parts.map((p) => p.yPt + p.heightPt)),
  }
}

function gapsOf(
  face: PrintFinalFace,
  brand: PrintFinalBox | null,
  message: PrintFinalBox | null,
  code: PrintFinalBox,
): PrintFinalPlan['gapsPt'] {
  const brandToMessage = brand && message ? message.topPt - brand.bottomPt : null
  const words = message ?? brand
  if (words === null) return { brandToMessage, messageToCode: 0, brandToCode: null }
  if (face.orientation === 'upright') {
    return {
      brandToMessage,
      messageToCode: code.topPt - words.bottomPt,
      brandToCode: null,
    }
  }
  return {
    brandToMessage,
    messageToCode: code.leftPt - words.rightPt,
    brandToCode: brand ? code.leftPt - brand.rightPt : null,
  }
}

function problemsOf(
  planned: PlannedGroups,
  gaps: PrintFinalPlan['gapsPt'],
  unitPt: number,
): readonly PrintFinalProblem[] {
  const least = 4 * unitPt - PRINT_FINAL_GAP_TOLERANCE_PT
  const problems: PrintFinalProblem[] = []
  const short = [gaps.brandToMessage, gaps.messageToCode, gaps.brandToCode].some(
    (gap) => gap !== null && gap < least,
  )
  if (short || planned.groupGapPt < least) problems.push('gap_under_4u')
  if (planned.overflowPt > PRINT_FINAL_GAP_TOLERANCE_PT) problems.push('taller_than_live')
  return problems
}

/** Lay out one face: the upright stack or the wide block, by the face's orientation. */
export function planPrintFinalFace(input: PrintFinalPlanInput): PrintFinalPlan {
  const { face, code } = input
  const area = printFinalLiveArea(face)
  const column = printFinalTextColumn(face, code.tilePt)
  const planned =
    face.orientation === 'upright'
      ? placeUprightStack(input, area)
      : placeWideBlock(input, area, column)
  const brand = spanOf(planned.parts.filter((p) => p.key === 'brand'))
  const message = spanOf(planned.parts.filter((p) => p.key !== 'brand'))
  const gapsPt = gapsOf(face, brand, message, planned.code)
  const problems = problemsOf(planned, gapsPt, area.unitPt)
  return {
    face,
    widthPt: area.widthPt,
    heightPt: area.heightPt,
    unitPt: area.unitPt,
    marginPt: area.marginPt,
    live: area.live,
    foldStripPt: area.foldStripPt,
    column,
    parts: planned.parts,
    code: planned.code,
    groups: { brand, message, code: planned.code },
    gapsPt,
    fits: problems.length === 0,
    problems,
  }
}
