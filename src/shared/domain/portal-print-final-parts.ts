// The parts a final face is laid out from (final design spec §2.3): what each
// part is, the group it belongs to, and the space before it inside its group.
// The planners (`portal-print-final-planners.ts`) place them; the renderer
// measures them by their ink.

import type { PrintFinalFace } from './portal-print-final'
import type { PrintFinalCodeBlock } from './portal-print-final-code'

export type PrintFinalPartKey =
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
export type PrintFinalPart = Readonly<{
  key: PrintFinalPartKey
  widthPt: number
  heightPt: number
}>

/** A part placed: its ink box's top-left corner, from the trim's top-left. */
export type PrintFinalPlacedPart = PrintFinalPart & Readonly<{ xPt: number; yPt: number }>

export type PrintFinalPlanInput = Readonly<{
  face: PrintFinalFace
  /** The brand and message parts, top to bottom. */
  parts: readonly PrintFinalPart[]
  code: PrintFinalCodeBlock
}>

/** The brand is the logo, its plate or the wordmark; everything else above the code is the message. */
export const isBrandPart = (part: Pick<PrintFinalPart, 'key'>): boolean =>
  part.key === 'brand'

/**
 * The space before a part inside its group, in units: 1u, except 2u on each
 * side of the short rule before the second language, and 2u before the back
 * page's property name (§10.4). The first part of a group has none.
 */
export function printFinalGapUnitsBefore(
  previous: PrintFinalPartKey | null,
  key: PrintFinalPartKey,
): number {
  if (previous === null) return 0
  return key === 'rule' || previous === 'rule' || key === 'name' ? 2 : 1
}

export type PrintFinalStackedPart = PrintFinalPart & Readonly<{ offsetPt: number }>

export type PrintFinalStack = Readonly<{
  parts: readonly PrintFinalStackedPart[]
  heightPt: number
  widthPt: number
}>

/** A group's parts stacked top to bottom with their gaps: each part's offset from the group's top. */
export function stackPrintFinalGroup(
  parts: readonly PrintFinalPart[],
  unitPt: number,
): PrintFinalStack {
  let y = 0
  let previous: PrintFinalPartKey | null = null
  const stacked = parts.map((part) => {
    y += printFinalGapUnitsBefore(previous, part.key) * unitPt
    const placed = { ...part, offsetPt: y }
    y += part.heightPt
    previous = part.key
    return placed
  })
  const widthPt = parts.reduce((widest, part) => Math.max(widest, part.widthPt), 0)
  return { parts: stacked, heightPt: y, widthPt }
}
