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
  layoutPrintFinalBack,
  type PrintFinalBackLayout,
} from '#/shared/domain/portal-print-final-back'
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
  layoutPrintFinalImmersiveFace,
  type PrintFinalImmersiveBrand,
  type PrintFinalImmersiveFace,
} from '#/shared/domain/portal-print-final-immersive-face'
import {
  PRINT_FINAL_DEFAULT_FRAMING,
  type PrintFinalFraming,
} from '#/shared/domain/portal-print-final-framing'
import type { PrintFinalBleed } from '#/shared/domain/portal-print-final-layers'
import {
  estimatedLineWidthPt,
  type EstimatedFace,
} from '#/shared/domain/portal-print-kit-text-widths'
import { estimatedLineReachEm } from './print-final-ink-estimates'
import type { PreviewFinalLogo, PreviewFinalPhoto } from './use-print-final-pictures'

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

export type PreviewFinalImmersiveInput = Readonly<{
  face: PrintFinalFace
  blocks: readonly PrintTextBlock[]
  look: PortalPrintKitView['look']
  tile: PrintFinalTile
  /** The logo once decoded; null until then, or with no logo. */
  logo: PreviewFinalLogo | null
  /** The photo once decoded; null with no photo (or one the browser could not read). */
  photo: PreviewFinalPhoto | null
  framing?: PrintFinalFraming
  /** How far the art runs past the trim: on a sheet, the sheet's bleed; none on its own. */
  bleed?: PrintFinalBleed
}>

/** The brand the preview plans an Immersive face with: the logo as its whole picture, read for its ink; or the wordmark. */
function previewImmersiveBrand(
  input: PreviewFinalImmersiveInput,
): PrintFinalImmersiveBrand {
  if (input.look.logoUrl === null) return { kind: 'wordmark', text: input.look.wordmark }
  return {
    kind: 'logo',
    inkWidth: input.logo?.aspect ?? PREVIEW_LOGO_ASPECT,
    inkHeight: 1,
    medianInkLuminance: input.logo?.medianInkLuminance ?? null,
  }
}

/** An Immersive face as the file lays it out and paints it, from the preview's measures and its decode of the photo. */
export function previewFinalImmersiveFace(
  input: PreviewFinalImmersiveInput,
): PrintFinalImmersiveFace {
  const { look, photo } = input
  return layoutPrintFinalImmersiveFace({
    face: input.face,
    blocks: input.blocks,
    brand: previewImmersiveBrand(input),
    tile: input.tile,
    measurer: previewFinalMeasurer,
    accentColour: look.accentColour,
    fieldColour: look.fieldColour,
    bleed: input.bleed,
    photo:
      photo === null
        ? null
        : {
            ...photo,
            focal: look.heroFocal ?? { x: 0.5, y: 0.5 },
            framing: input.framing ?? PRINT_FINAL_DEFAULT_FRAMING,
          },
  })
}

export type PreviewFinalBackInput = Readonly<{
  face: PrintFinalFace
  look: PortalPrintKitView['look']
  /** The logo picture's width over its height, once it has loaded. */
  logoAspect: number | null
  /** The front put the logo on its cream plate: the back follows it. */
  onPlate: boolean
}>

/** A card's back page as the file lays it out, from the preview's measures: the logo or the wordmark, and the property's name. */
export function previewFinalBackLayout(
  input: PreviewFinalBackInput,
): PrintFinalBackLayout {
  const { face, look } = input
  return layoutPrintFinalBack({
    face,
    brand:
      look.logoUrl === null
        ? { kind: 'wordmark', text: look.wordmark }
        : {
            kind: 'logo',
            inkWidth: input.logoAspect ?? PREVIEW_LOGO_ASPECT,
            inkHeight: 1,
            onPlate: input.onPlate,
          },
    propertyName: look.propertyName,
    measurer: previewFinalMeasurer,
  })
}
