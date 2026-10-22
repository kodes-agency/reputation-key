// What the Immersive preview needs that the PDF finds by measuring: which fit
// step a face is set at (spec 2.5), whether it keeps its window, and the field's
// CSS. The PDF measures every step with the fonts; the preview makes the same
// choice from the widths it estimates (`estimatedStackHeight`), which err wide,
// so it never keeps a window or a type size the file gives up. Within a step the
// window grows and shrinks by itself, as the boards' flex-grow of 1000 makes it.
//
// Every measure is read from the files the PDF reads.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { parseHexColour } from '#/shared/domain/portal-field-colour'
import type {
  PrintFace,
  PrintKitPaper,
  PrintKitPiece,
} from '#/shared/domain/portal-print-kit'
import {
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from '#/shared/domain/portal-print-kit-code-block'
import {
  WINDOW_FRAME_PT,
  immersiveBrandSize,
  immersiveFitSteps,
  immersiveGridOf,
  isTentPanel,
  wantsWindow,
  windowPictureRangePt,
  type ImmersiveFitStep,
  type ImmersiveGeometry,
} from '#/shared/domain/portal-print-kit-immersive'
import { WORDMARK } from '#/shared/domain/portal-print-kit-measures'
import {
  PRINT_KIT_WASH_ALPHA,
  type ImmersivePrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { brandInkPt } from './print-kit-face-brand-art'
import { estimatedStackHeight } from './print-kit-paper-art-layout'

export type PreviewImmersiveFit = ImmersiveFitStep &
  Readonly<{ wordmarkPt: number; logoHeightPt: number; window: boolean }>

/**
 * The step an Immersive face is set at in the preview: the first that keeps the
 * window at its floor, else, with the window dropped, the first whose words fit.
 */
export function previewImmersiveFit(
  face: PrintFace,
  geometry: ImmersiveGeometry,
  look: PortalPrintKitView['look'],
): PreviewImmersiveFit {
  const grid = immersiveGridOf(geometry)
  const languages = face.blocks.length
  const code = planCodeBlock(
    cueLinesFor(face.blocks.map((block) => block.locale)),
    estimatedCueWidthPt,
  )
  const range = windowPictureRangePt(geometry)
  const tries = immersiveFitSteps(languages, isTentPanel(geometry)).map((step) => {
    const brand = immersiveBrandSize(geometry, languages, step.brand)
    const brandHeight =
      look.logoUrl === null ? brand.wordmarkPt * WORDMARK.lineBoxEm : brand.logoHeightPt
    const fixed =
      (grid.ridgePt ?? 0) +
      2 * grid.marginPt -
      brandInkPt(look, brand.wordmarkPt) +
      brandHeight +
      estimatedStackHeight(
        face,
        step.scale,
        grid.widthPt - 2 * grid.sidePt,
        step.placeToHeadPt,
      ) +
      code.heightPt
    return { ...step, ...brand, spare: grid.heightPt - fixed }
  })
  const withWindow = wantsWindow(geometry, languages)
    ? tries.find(
        (attempt) =>
          attempt.spare - 3 * attempt.gapPt - 2 * WINDOW_FRAME_PT >= range.minPt,
      )
    : undefined
  if (withWindow !== undefined) return { ...withWindow, window: true }
  const words =
    tries.find((attempt) => attempt.spare >= 2 * attempt.gapPt) ?? tries[tries.length - 1]
  if (words === undefined) throw new Error('A face has at least one way to be set')
  return { ...words, window: false }
}

const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = parseHexColour(hex) ?? [0, 0, 0]
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** The field and its two washes, as the board paints them and the PDF draws them. */
export function immersiveBackground(palette: ImmersivePrintKitPalette): string {
  const wash = (colour: string, shape: string) =>
    `radial-gradient(${shape}, ${rgba(colour, PRINT_KIT_WASH_ALPHA)}, ${rgba(colour, 0)} 72%)`
  return [
    wash(palette.warm, '72% 46% at 0% 100%'),
    wash(palette.cool, '64% 42% at 100% 56%'),
    palette.field,
  ].join(', ')
}

/** The board's stand-in for the dim the PDF measures from the crop: the field at 10%. */
export const previewPhotoDim = (palette: ImmersivePrintKitPalette): string =>
  rgba(palette.field, 0.1)

/**
 * What an Immersive Whole sheet preview shows, for its label: "4 × 6 in counter
 * card for a print shop · page 1 of 2, front".
 */
export function printKitPrintShopLabel(
  piece: PrintKitPiece,
  paper: PrintKitPaper,
  page: Readonly<{ index: number; count: number }>,
): string {
  const size = paper === 'letter' ? '4 × 6 in' : 'A6'
  if (piece === 'table_tent') {
    const flat = paper === 'letter' ? '4 × 12 in' : '105 × 296 mm'
    return `${size} table tent for a print shop, ${flat} flat with bleed and crop marks`
  }
  const side = page.index === 0 ? 'front' : 'back'
  return `${size} counter card for a print shop, with bleed and crop marks · page ${page.index + 1} of ${page.count}, ${side}`
}
