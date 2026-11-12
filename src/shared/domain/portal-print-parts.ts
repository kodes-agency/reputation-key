// The parts a face is laid out from (design spec §2.3): what each
// part is, the group it belongs to, and the space before it inside its group.
// The planners (`portal-print-planners.ts`) place them; the renderer
// measures them by their ink.

import type { PrintFace } from './portal-print'
import type { PrintCodeBlock } from './portal-print-code'

export type PrintPartKey =
  | 'brand'
  | 'kicker'
  | 'headline'
  | 'subline'
  | 'rule'
  | 'headline2'
  | 'subline2'
  | 'secondLine'
  | 'name'

/** One part's ink box, as measured: width and height in points. */
export type PrintPart = Readonly<{
  key: PrintPartKey
  widthPt: number
  heightPt: number
  /** How many lines a part of words is set on; the planner holds the headline and the sub-line to their caps. */
  lines?: number
}>

/** A part placed: its ink box's top-left corner, from the trim's top-left. */
export type PrintPlacedPart = PrintPart & Readonly<{ xPt: number; yPt: number }>

export type PrintPlanInput = Readonly<{
  face: PrintFace
  /** The brand and message parts, top to bottom. */
  parts: readonly PrintPart[]
  code: PrintCodeBlock
}>

/** The brand is the logo, its plate or the wordmark; everything else above the code is the message. */
export const isBrandPart = (part: Pick<PrintPart, 'key'>): boolean => part.key === 'brand'

/**
 * The space before a part inside its group, in units: 1u, except 2u on each
 * side of the short rule before the second language, and 2u before the back
 * page's property name (§10.4). The first part of a group has none.
 */
export function printGapUnitsBefore(
  previous: PrintPartKey | null,
  key: PrintPartKey,
): number {
  if (previous === null) return 0
  return key === 'rule' || previous === 'rule' || key === 'name' ? 2 : 1
}

export type PrintStackedPart = PrintPart & Readonly<{ offsetPt: number }>

export type PrintStack = Readonly<{
  parts: readonly PrintStackedPart[]
  heightPt: number
  widthPt: number
}>

/** A group's parts stacked top to bottom with their gaps: each part's offset from the group's top. */
export function stackPrintGroup(parts: readonly PrintPart[], unitPt: number): PrintStack {
  let y = 0
  let previous: PrintPartKey | null = null
  const stacked = parts.map((part) => {
    y += printGapUnitsBefore(previous, part.key) * unitPt
    const placed = { ...part, offsetPt: y }
    y += part.heightPt
    previous = part.key
    return placed
  })
  const widthPt = parts.reduce((widest, part) => Math.max(widest, part.widthPt), 0)
  return { parts: stacked, heightPt: y, widthPt }
}
