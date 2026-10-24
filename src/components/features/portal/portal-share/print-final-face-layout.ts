// A final face in the Share tab's preview, laid out by the function the PDF
// lays it out with (`layoutPrintFinalFace`): the same planner, the same long-copy
// step, the same second-language form. The preview cannot measure the guest
// fonts, so it estimates them: advances from the width tables
// (`portal-print-kit-text-widths.ts`, which err wide), and ink from each face's
// tallest and deepest glyphs, so a line's ink box is never smaller than the
// file's. Its faces therefore crowd no less than the file's: the preview takes a
// long-copy step no later and never sets a line larger.
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

/**
 * Each family's vertical measures, in ems, read from the files the PDF embeds:
 * the line box's ascender and descender (where a browser puts the baseline),
 * and the ink of the tallest and deepest glyphs, for plain ASCII and for
 * anything else (accented capitals reach up to the ascender).
 */
export const PRINT_FINAL_FONT_METRICS: Readonly<
  Record<
    PrintFinalFamily,
    Readonly<{
      ascender: number
      descender: number
      inkAscentAscii: number
      inkAscent: number
      inkDescent: number
    }>
  >
> = Object.freeze({
  serif: {
    ascender: 0.924,
    descender: -0.287,
    inkAscentAscii: 0.74,
    inkAscent: 0.924,
    inkDescent: 0.29,
  },
  sans: {
    ascender: 1.054,
    descender: -0.289,
    inkAscentAscii: 0.78,
    inkAscent: 1.054,
    inkDescent: 0.29,
  },
})

/** How far below its baseline a line with no descender reaches: the overshoot of round letters. */
const OVERSHOOT_EM = 0.02

const PLAIN_ASCII = /^[\x20-\x7E]*$/u
/** Characters that reach below the baseline, in both families (and the serif's figures, to be safe). */
const DESCENDERS = /[gjpqyQ(),;[\]{}|_/@$\\]/u
const SERIF_DESCENDERS = /[0-9]/u

function inkDescentEm(text: string, family: PrintFinalFamily): number {
  const deep =
    !PLAIN_ASCII.test(text) ||
    DESCENDERS.test(text) ||
    (family === 'serif' && SERIF_DESCENDERS.test(text))
  return deep ? PRINT_FINAL_FONT_METRICS[family].inkDescent : OVERSHOOT_EM
}

const estimatedFaceOf = (style: PrintFinalTextStyle): EstimatedFace => {
  if (style.family === 'serif') return 'display'
  return style.italic ? 'italic' : 'text'
}

const advanceOf = (text: string, style: PrintFinalTextStyle) =>
  estimatedLineWidthPt(text, estimatedFaceOf(style), style.sizePt, style.trackingEm)

/** The preview's measures: estimated advances, and ink from the whole advance and the family's extremes. */
export const previewFinalMeasurer: PrintFinalTextMeasurer = {
  advancePt: advanceOf,
  ink: (text, style) => {
    const metrics = PRINT_FINAL_FONT_METRICS[style.family]
    const ascent = PLAIN_ASCII.test(text) ? metrics.inkAscentAscii : metrics.inkAscent
    return {
      leftPt: 0,
      rightPt: advanceOf(text, style),
      ascentPt: ascent * style.sizePt,
      descentPt: inkDescentEm(text, style.family) * style.sizePt,
    }
  },
}

/** A wide badge's proportions, which a logo is planned at until its picture has loaded. */
const PREVIEW_LOGO_ASPECT = 2

/** The brand the preview plans with: the logo as its whole picture (never on a plate on Paper), or the wordmark. */
export function previewFinalBrand(
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
  const { ascender, descender } = PRINT_FINAL_FONT_METRICS[style.family]
  return baselinePt - style.sizePt * (style.leading / 2 + (ascender + descender) / 2)
}
