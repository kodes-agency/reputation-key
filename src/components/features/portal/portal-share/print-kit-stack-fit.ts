// The scale the preview sets a face's words at. The PDF picks the largest scale
// at which the stack of words fits above the code (`fitStack`); the preview runs
// the same search with the same type sizes, line heights and gaps, on widths it
// estimates, since it cannot measure the fonts. The estimates err wide, so the
// preview never sets the words larger than the file prints them.

import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import {
  PANEL_WIDTH_MM,
  SIDE_MARGIN_MM,
  SINGLE_LANGUAGE_SCALE,
  STACK_FIT,
  STACK_GAP_MM,
  STACK_LEADING,
  TYPE_PT,
} from '#/shared/domain/portal-print-kit-layout'
import { wrapWords } from '#/shared/domain/portal-print-kit-text'
import { previewKicker } from './print-kit-art-layout'

const POINTS_PER_MM = 72 / 25.4
const ptToMm = (points: number) => points / POINTS_PER_MM
const TEXT_WIDTH_PT = (PANEL_WIDTH_MM - 2 * SIDE_MARGIN_MM) * POINTS_PER_MM

/**
 * The average advance of a character, in ems, of the display face (the call to
 * action) and of the body face (the line under it). Wider than either face's
 * real average, so a line that wraps in the file wraps here too.
 */
const DISPLAY_ADVANCE_EM = 0.5
const BODY_ADVANCE_EM = 0.52

/** The height, in millimetres, of `text` wrapped to the panel at `sizePt`. */
function linesHeightMm(
  text: string,
  sizePt: number,
  advanceEm: number,
  leading: number,
): number {
  const lines = wrapWords(text, TEXT_WIDTH_PT, (line) => line.length * sizePt * advanceEm)
  return lines.length * ptToMm(sizePt * leading)
}

function firstBlockHeightMm(block: PrintTextBlock, scale: number): number {
  const kicker = previewKicker(block.kicker, scale)
  return (
    kicker.lines.length * ptToMm(kicker.size * STACK_LEADING.kicker) +
    STACK_GAP_MM.belowKicker * scale +
    linesHeightMm(
      block.headline,
      TYPE_PT.headline * scale,
      DISPLAY_ADVANCE_EM,
      STACK_LEADING.headline,
    ) +
    STACK_GAP_MM.belowHeadline * scale +
    linesHeightMm(
      block.subline,
      TYPE_PT.subline * scale,
      BODY_ADVANCE_EM,
      STACK_LEADING.subline,
    )
  )
}

function secondBlockHeightMm(block: PrintTextBlock, scale: number): number {
  return (
    (STACK_GAP_MM.aboveRule + STACK_GAP_MM.belowRule) * scale +
    linesHeightMm(
      block.headline,
      TYPE_PT.secondHeadline * scale,
      DISPLAY_ADVANCE_EM,
      STACK_LEADING.secondHeadline,
    ) +
    STACK_GAP_MM.belowSecondHeadline * scale +
    linesHeightMm(
      block.subline,
      TYPE_PT.secondSubline * scale,
      BODY_ADVANCE_EM,
      STACK_LEADING.subline,
    )
  )
}

/** The estimated height of a face's words at `scale`, as the PDF lays them out. */
export function previewStackHeightMm(
  blocks: readonly PrintTextBlock[],
  scale: number,
): number {
  const [first, second] = blocks
  return (
    (first ? firstBlockHeightMm(first, scale) : 0) +
    (second ? secondBlockHeightMm(second, scale) : 0)
  )
}

/** The largest scale, from the stack's full one down to the floor, at which the words fit `roomMm`. */
export function previewStackScale(
  blocks: readonly PrintTextBlock[],
  roomMm: number,
): number {
  let scale = blocks.length === 1 ? SINGLE_LANGUAGE_SCALE : 1
  while (previewStackHeightMm(blocks, scale) > roomMm && scale > STACK_FIT.minScale) {
    scale = Math.max(STACK_FIT.minScale, scale - STACK_FIT.step)
  }
  return scale
}
