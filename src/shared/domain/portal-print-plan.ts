// The print's layout (design spec §2.3): two planners, one per
// orientation, shared by the PDF and the Share tab's preview. Each takes the
// parts of a face measured by their ink (type by its glyph bounds, the logo by
// its drawn pixels, the plate, the rule and the code block by their boxes) and
// returns where each part's ink goes, in points from the trim's top-left corner.
// The renderer turns an ink position into a drawing position with the offsets
// it measured; the planner never sees a font.
//
// Three groups: brand (the logo, its plate or the wordmark), message (kicker,
// headline, sub-line, second language) and code (tile and bar). Inside a
// group, 1u; round the rule before the second language, 2u.
//   - Upright: the groups down one centreline. Group gaps grow equally from 4u
//     to 8u; whatever is left splits 44 : 56 into the top and bottom margins.
//   - Wide: the code block on the right margin line; the brand 4u above the
//     message as one flush-left block. Both are centred on one line, and the
//     taller of the two is placed 44 : 56 in the live height. On a tent, a
//     headline whose cap-top would fall below 54 % of the face lifts the block,
//     never above the top margin.
// Type never grows to fill space. A face whose gaps fall under 4u, whose ink
// runs past the live area, or whose headline takes more than 3 lines or sub-line
// more than 2 says so (`fits`), and the long-copy step (`choosePrintHeadline`)
// tries a smaller headline.

import type { PrintFace } from './portal-print'
import type { PrintPlacedPart, PrintPlanInput } from './portal-print-parts'
import { mmPt, printBoxFits, printLiveArea, type PrintBox } from './portal-print-measures'
import { PRINT_LINE_CAPS } from './portal-print-type'
import {
  placeUprightStack,
  placeWideBlock,
  type PlannedGroups,
} from './portal-print-planners'

export type PrintProblem =
  | 'gap_under_4u'
  | 'taller_than_live'
  | 'outside_live_area'
  | 'headline_over_cap'
  | 'subline_over_cap'

export type PrintPlan = Readonly<{
  face: PrintFace
  widthPt: number
  heightPt: number
  unitPt: number
  marginPt: number
  live: PrintBox
  foldStripPt: number
  /** The column the words wrap in. */
  column: Readonly<{ leftPt: number; rightPt: number }>
  parts: readonly PrintPlacedPart[]
  /** The code block's outer box (the Paper outline included). */
  code: PrintBox
  /** Each group's ink span; null for a group with no parts. */
  groups: Readonly<{
    brand: PrintBox | null
    message: PrintBox | null
    code: PrintBox
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
  problems: readonly PrintProblem[]
}>

/** A gap counts as 4u unless it is short by more than this (§5.3: the strict 4u). */
const PRINT_GAP_TOLERANCE_PT = mmPt(0.05)

/**
 * The column the words wrap in: the live width upright; wide, from the left
 * margin to one M short of the tile (the gutter is at least 4u).
 */
export function printTextColumn(
  face: PrintFace,
  tilePt: number,
): Readonly<{ leftPt: number; rightPt: number }> {
  const area = printLiveArea(face)
  const { leftPt, rightPt } = area.live
  return face.orientation === 'upright'
    ? { leftPt, rightPt }
    : { leftPt, rightPt: rightPt - tilePt - area.marginPt }
}

function spanOf(parts: readonly PrintPlacedPart[]): PrintBox | null {
  if (parts.length === 0) return null
  return {
    leftPt: Math.min(...parts.map((p) => p.xPt)),
    topPt: Math.min(...parts.map((p) => p.yPt)),
    rightPt: Math.max(...parts.map((p) => p.xPt + p.widthPt)),
    bottomPt: Math.max(...parts.map((p) => p.yPt + p.heightPt)),
  }
}

function gapsOf(
  face: PrintFace,
  brand: PrintBox | null,
  message: PrintBox | null,
  code: PrintBox,
): PrintPlan['gapsPt'] {
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

/** A part of words over its line cap: the headline over 3 lines, the sub-line over 2. */
function lineCapProblems(parts: readonly PrintPlacedPart[]): readonly PrintProblem[] {
  const over = (key: 'headline' | 'subline') =>
    parts.some((part) => part.key === key && (part.lines ?? 0) > PRINT_LINE_CAPS[key])
  return [
    ...(over('headline') ? (['headline_over_cap'] as const) : []),
    ...(over('subline') ? (['subline_over_cap'] as const) : []),
  ]
}

function problemsOf(
  planned: PlannedGroups,
  gaps: PrintPlan['gapsPt'],
  unitPt: number,
  live: PrintBox,
): readonly PrintProblem[] {
  const least = 4 * unitPt - PRINT_GAP_TOLERANCE_PT
  const problems: PrintProblem[] = []
  const short = [gaps.brandToMessage, gaps.messageToCode, gaps.brandToCode].some(
    (gap) => gap !== null && gap < least,
  )
  if (short || planned.groupGapPt < least) problems.push('gap_under_4u')
  if (planned.overflowPt > PRINT_GAP_TOLERANCE_PT) problems.push('taller_than_live')
  const boxes = [
    planned.code,
    ...planned.parts.map((part) => ({
      leftPt: part.xPt,
      topPt: part.yPt,
      rightPt: part.xPt + part.widthPt,
      bottomPt: part.yPt + part.heightPt,
    })),
  ]
  if (boxes.some((box) => !printBoxFits(box, live))) problems.push('outside_live_area')
  return [...problems, ...lineCapProblems(planned.parts)]
}

/** Lay out one face: the upright stack or the wide block, by the face's orientation. */
export function planPrintFace(input: PrintPlanInput): PrintPlan {
  const { face, code } = input
  const area = printLiveArea(face)
  const column = printTextColumn(face, code.tilePt)
  const planned =
    face.orientation === 'upright'
      ? placeUprightStack(input, area)
      : placeWideBlock(input, area, column)
  const brand = spanOf(planned.parts.filter((p) => p.key === 'brand'))
  const message = spanOf(planned.parts.filter((p) => p.key !== 'brand'))
  const gapsPt = gapsOf(face, brand, message, planned.code)
  const problems = problemsOf(planned, gapsPt, area.unitPt, area.live)
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
