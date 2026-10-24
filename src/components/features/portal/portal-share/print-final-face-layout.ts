// A final face in the Share tab's preview, laid out by the function the PDF
// lays it out with (`layoutPrintFinalFace`): the same planner, the same long-copy
// step, the same second-language form. The preview cannot measure the guest
// fonts, so it estimates them: advances from the width tables
// (`portal-print-kit-text-widths.ts`) and each line's reach above and below its
// baseline from its characters' (`print-final-ink-estimates.ts`), both erring
// large, so a line's ink box is never smaller than the file's. Its faces
// therefore crowd no less than the file's: the preview takes a long-copy step no
// later and never sets a line larger.
//
// The preview cannot read a logo's alpha either, so its drawing is the whole
// image, at the picture's own proportions once it has loaded.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import {
  layoutPrintFinalFace,
  type PrintFinalBrandInput,
  type PrintFinalFaceLayout,
} from '#/shared/domain/portal-print-final-face'
import type { PrintFinalFamily } from '#/shared/domain/portal-print-final-type'
import type {
  PrintFinalTextMeasurer,
  PrintFinalTextStyle,
} from '#/shared/domain/portal-print-final-text'
import {
  estimatedLineWidthPt,
  type EstimatedFace,
} from '#/shared/domain/portal-print-kit-text-widths'
import { estimatedLineReachEm } from './print-final-ink-estimates'

/**
 * Each family's line box, in ems, from the files the PDF embeds: its ascender
 * and descender, which decide where a browser puts the baseline in a line box.
 */
const PRINT_FINAL_LINE_BOX: Readonly<
  Record<PrintFinalFamily, Readonly<{ ascender: number; descender: number }>>
> = Object.freeze({
  serif: { ascender: 0.924, descender: -0.287 },
  sans: { ascender: 1.054, descender: -0.289 },
})

const estimatedFaceOf = (style: PrintFinalTextStyle): EstimatedFace => {
  if (style.family === 'serif') return 'display'
  return style.italic ? 'italic' : 'text'
}

const advanceOf = (text: string, style: PrintFinalTextStyle) =>
  estimatedLineWidthPt(text, estimatedFaceOf(style), style.sizePt, style.trackingEm)

/** The preview's measures: estimated advances, and ink across the whole advance and as high and deep as the line's characters reach. */
export const previewFinalMeasurer: PrintFinalTextMeasurer = {
  advancePt: advanceOf,
  ink: (text, style) => {
    const reach = estimatedLineReachEm(style.family, text)
    return {
      leftPt: 0,
      rightPt: advanceOf(text, style),
      ascentPt: reach.up * style.sizePt,
      descentPt: reach.down * style.sizePt,
    }
  },
}

/** A wide badge's proportions, which a logo is planned at until its picture has loaded. */
const PREVIEW_LOGO_ASPECT = 2

/** The brand the preview plans with: the logo as its whole picture (never on a plate on Paper), or the wordmark. */
function previewFinalBrand(
  look: PortalPrintKitView['look'],
  face: PrintFinalFace,
  logoAspect: number | null,
): PrintFinalBrandInput {
  if (look.logoUrl === null) return { kind: 'wordmark', text: look.wordmark }
  return {
    kind: 'logo',
    inkWidth: logoAspect ?? PREVIEW_LOGO_ASPECT,
    inkHeight: 1,
    onPlate: face.look === 'immersive',
  }
}

export type PreviewFinalFaceInput = Readonly<{
  face: PrintFinalFace
  blocks: readonly PrintTextBlock[]
  look: PortalPrintKitView['look']
  tile: PrintFinalTile
  /** The logo picture's width over its height, once it has loaded. */
  logoAspect: number | null
}>

/** Where everything on a final face goes, as the file places it. */
export function previewFinalFaceLayout(
  input: PreviewFinalFaceInput,
): PrintFinalFaceLayout {
  return layoutPrintFinalFace({
    face: input.face,
    blocks: input.blocks,
    brand: previewFinalBrand(input.look, input.face, input.logoAspect),
    tile: input.tile,
    measurer: previewFinalMeasurer,
  })
}

/** Where a line box's top goes for its baseline to sit at `baselinePt`, as a browser centres the content area in the line box. */
export function previewLineTopPt(style: PrintFinalTextStyle, baselinePt: number): number {
  const { ascender, descender } = PRINT_FINAL_LINE_BOX[style.family]
  return baselinePt - style.sizePt * (style.leading / 2 + (ascender + descender) / 2)
}
