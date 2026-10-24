// The two final planners (final design spec §2.3), copied from the generator
// that drew the boards (`final-engine.mjs`, layoutCard): the upright stack and
// the wide block. `planPrintFinalFace` picks one and reports the gaps.

import {
  isBrandPart,
  stackPrintFinalGroup,
  type PrintFinalPlacedPart,
  type PrintFinalPlanInput,
  type PrintFinalStack,
} from './portal-print-final-parts'
import type { PrintFinalBox, PrintFinalLiveArea } from './portal-print-final-measures'

/** The spare height above the content, as a share of all the spare: 44 : 56. */
export const PRINT_FINAL_SPARE_TOP_SHARE = 0.44

/** Group gaps grow from 4u to this, never further (§2.3). */
const GROUP_GAP_MAX_UNITS = 8

/** Wide tents: the headline's cap-top stays in the upper 54 % of the face (rule 1.8). */
const TENT_HEADLINE_SHARE = 0.54

export type PlannedGroups = Readonly<{
  parts: readonly PrintFinalPlacedPart[]
  code: PrintFinalBox
  /** The gap between groups the plan settled on (upright); 4u on the wide block. */
  groupGapPt: number
  /** How far the content runs past the live height; 0 or less when it fits. */
  overflowPt: number
}>

type Align = 'centre' | 'left'

function placeStack(
  stack: PrintFinalStack,
  x: number,
  top: number,
  align: Align,
): PrintFinalPlacedPart[] {
  return stack.parts.map(({ offsetPt, ...part }) => ({
    ...part,
    xPt: align === 'centre' ? x - part.widthPt / 2 : x,
    yPt: top + offsetPt,
  }))
}

const boxAt = (
  left: number,
  top: number,
  width: number,
  height: number,
): PrintFinalBox => ({
  leftPt: left,
  topPt: top,
  rightPt: left + width,
  bottomPt: top + height,
})

function groupsOf(input: PrintFinalPlanInput, unitPt: number) {
  return {
    brand: stackPrintFinalGroup(input.parts.filter(isBrandPart), unitPt),
    message: stackPrintFinalGroup(
      input.parts.filter((part) => !isBrandPart(part)),
      unitPt,
    ),
  }
}

/**
 * Upright: brand, message and code down one centreline. The spare height is
 * shared between the group gaps up to 8u each; what is left splits 44 : 56 into
 * the top and bottom margins. Gaps under 4u leave the content starting at the
 * top margin, and the plan reports them.
 */
export function placeUprightStack(
  input: PrintFinalPlanInput,
  area: PrintFinalLiveArea,
): PlannedGroups {
  const { live, unitPt } = area
  const { brand, message } = groupsOf(input, unitPt)
  const stacks = [brand, message].filter((stack) => stack.parts.length > 0)
  const heights = [...stacks.map((stack) => stack.heightPt), input.code.heightPt]
  const gapCount = heights.length - 1
  const spare = live.bottomPt - live.topPt - heights.reduce((sum, h) => sum + h, 0)
  const even = gapCount > 0 ? spare / gapCount : 0
  const maxGap = GROUP_GAP_MAX_UNITS * unitPt
  const gap = Math.min(even, maxGap)
  const topSpare =
    even > maxGap ? PRINT_FINAL_SPARE_TOP_SHARE * (spare - gapCount * maxGap) : 0
  const axis = (live.leftPt + live.rightPt) / 2
  let y = live.topPt + topSpare
  const parts = stacks.flatMap((stack) => {
    const placed = placeStack(stack, axis, y, 'centre')
    y += stack.heightPt + gap
    return placed
  })
  const code = boxAt(
    axis - input.code.widthPt / 2,
    y,
    input.code.widthPt,
    input.code.heightPt,
  )
  return {
    parts,
    code,
    groupGapPt: gapCount > 0 ? gap : Infinity,
    overflowPt: code.bottomPt - live.bottomPt,
  }
}

/** The headline's offset from the block's top: the brand, its 4u, and the message parts above the headline. */
function headlineOffset(
  brand: PrintFinalStack,
  message: PrintFinalStack,
  unitPt: number,
) {
  const headline = message.parts.find((part) => part.key === 'headline')
  if (headline === undefined) return null
  const brandPt = brand.parts.length > 0 ? brand.heightPt + 4 * unitPt : 0
  return brandPt + headline.offsetPt
}

/**
 * Wide: the code block on the right margin line; the brand 4u above the
 * message as one flush-left block. Both centre on one horizontal line, and the
 * taller of the two is placed 44 : 56 in the live height. A tent lifts its
 * block when the headline's cap-top would fall below 54 % of the face, never
 * above the top margin.
 */
export function placeWideBlock(
  input: PrintFinalPlanInput,
  area: PrintFinalLiveArea,
  column: Readonly<{ leftPt: number }>,
): PlannedGroups {
  const { live, unitPt } = area
  const { brand, message } = groupsOf(input, unitPt)
  const hasBrand = brand.parts.length > 0
  const brandPt = hasBrand ? brand.heightPt + 4 * unitPt : 0
  const blockPt = brandPt + message.heightPt
  const codePt = input.code.heightPt
  const tallest = Math.max(codePt, blockPt)
  const liveH = live.bottomPt - live.topPt
  const centre =
    live.topPt + Math.max(0, liveH - tallest) * PRINT_FINAL_SPARE_TOP_SHARE + tallest / 2
  let blockTop = centre - blockPt / 2
  const offset =
    input.face.piece === 'tent' ? headlineOffset(brand, message, unitPt) : null
  if (offset !== null) {
    const highest = TENT_HEADLINE_SHARE * area.heightPt - offset
    if (blockTop > highest) blockTop = Math.max(live.topPt, highest)
  }
  const codeLeft = live.rightPt - input.code.widthPt
  const code = boxAt(codeLeft, centre - codePt / 2, input.code.widthPt, codePt)
  const parts = [
    ...placeStack(brand, column.leftPt, blockTop, 'left'),
    ...placeStack(message, column.leftPt, blockTop + brandPt, 'left'),
  ]
  return {
    parts,
    code,
    groupGapPt: hasBrand ? 4 * unitPt : Infinity,
    overflowPt: tallest - liveH,
  }
}
