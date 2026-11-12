// A face in the Share tab's preview, laid out by the function the PDF
// lays it out with (`layoutPrintFace`): the same planner, the same long-copy
// step, the same second-language form. The preview cannot measure the guest
// fonts, so it estimates them: advances from the width tables
// (`portal-print-kit-text-widths.ts`) and each line's reach above and below its
// baseline from its characters' (`print-ink-estimates.ts`), both erring
// large, so a line's ink box is never smaller than the file's. Its faces
// therefore crowd no less than the file's: the preview takes a long-copy step no
// later and never sets a line larger.
//
// The preview cannot read a logo's alpha either, so its drawing is the whole
// image, at the picture's own proportions once it has loaded.

// A face in the Share tab's preview, laid out by the function the PDF
// lays it out with (`layoutPrintFace`): the same planner, the same long-copy
// step, the same second-language form. The preview cannot measure the guest
// fonts, so it estimates them: advances from the width tables
// (`portal-print-kit-text-widths.ts`) and each line's reach above and below its
// baseline from its characters' (`print-ink-estimates.ts`), both erring
// large, so a line's ink box is never smaller than the file's. Its faces
// therefore crowd no less than the file's: the preview takes a long-copy step no
// later and never sets a line larger.
//
// The preview cannot read a logo's alpha either, so its drawing is the whole
// image, at the picture's own proportions once it has loaded.
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFace } from '#/shared/domain/portal-print'
import type { PrintTile } from '#/shared/domain/portal-print-code'
import { layoutPrintBack, type PrintBackLayout } from '#/shared/domain/portal-print-back'
import {
  layoutPrintFace,
  type PrintBrandInput,
  type PrintFaceLayout,
} from '#/shared/domain/portal-print-face'
import type { PrintFamily } from '#/shared/domain/portal-print-type'
import type { PrintTextMeasurer, PrintTextStyle } from '#/shared/domain/portal-print-text'
import {
  layoutPrintImmersiveFace,
  type PrintImmersiveBrand,
  type PrintImmersiveFace,
} from '#/shared/domain/portal-print-immersive-face'
import {
  PRINT_DEFAULT_FRAMING,
  type PrintFraming,
} from '#/shared/domain/portal-print-framing'
import type { PrintBleed } from '#/shared/domain/portal-print-layers'
import {
  estimatedLineWidthPt,
  type EstimatedFace,
} from '#/shared/domain/portal-print-kit-text-widths'
import { estimatedLineReachEm } from './print-ink-estimates'
import type { PreviewLogo, PreviewPhoto } from './use-print-pictures'

/**
 * Each family's line box, in ems, from the files the PDF embeds: its ascender
 * and descender, which decide where a browser puts the baseline in a line box.
 */
const PRINT_LINE_BOX: Readonly<
  Record<PrintFamily, Readonly<{ ascender: number; descender: number }>>
> = Object.freeze({
  serif: { ascender: 0.924, descender: -0.287 },
  sans: { ascender: 1.054, descender: -0.289 },
})

const estimatedFaceOf = (style: PrintTextStyle): EstimatedFace => {
  if (style.family === 'serif') return 'display'
  return style.italic ? 'italic' : 'text'
}

const advanceOf = (text: string, style: PrintTextStyle) =>
  estimatedLineWidthPt(text, estimatedFaceOf(style), style.sizePt, style.trackingEm)

/** The preview's measures: estimated advances, and ink across the whole advance and as high and deep as the line's characters reach. */
export const previewMeasurer: PrintTextMeasurer = {
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
function previewBrand(
  look: PortalPrintKitView['look'],
  face: PrintFace,
  logoAspect: number | null,
): PrintBrandInput {
  if (look.logoUrl === null) return { kind: 'wordmark', text: look.wordmark }
  return {
    kind: 'logo',
    inkWidth: logoAspect ?? PREVIEW_LOGO_ASPECT,
    inkHeight: 1,
    onPlate: face.look === 'immersive',
  }
}

export type PreviewFaceInput = Readonly<{
  face: PrintFace
  blocks: readonly PrintTextBlock[]
  look: PortalPrintKitView['look']
  tile: PrintTile
  /** The logo picture's width over its height, once it has loaded. */
  logoAspect: number | null
  /** Step the headline for this orientation alone (Share's fit check); the print steps both. */
  ownStepOnly?: boolean
}>

/** Where everything on a face goes, as the file places it. */
export function previewFaceLayout(input: PreviewFaceInput): PrintFaceLayout {
  return layoutPrintFace({
    face: input.face,
    blocks: input.blocks,
    brand: previewBrand(input.look, input.face, input.logoAspect),
    tile: input.tile,
    measurer: previewMeasurer,
    ownStepOnly: input.ownStepOnly,
  })
}

/** Where a line box's top goes for its baseline to sit at `baselinePt`, as a browser centres the content area in the line box. */
export function previewLineTopPt(style: PrintTextStyle, baselinePt: number): number {
  const { ascender, descender } = PRINT_LINE_BOX[style.family]
  return baselinePt - style.sizePt * (style.leading / 2 + (ascender + descender) / 2)
}

export type PreviewImmersiveInput = Readonly<{
  face: PrintFace
  blocks: readonly PrintTextBlock[]
  look: PortalPrintKitView['look']
  tile: PrintTile
  /** The logo once decoded; null until then, or with no logo. */
  logo: PreviewLogo | null
  /** The photo once decoded; null with no photo (or one the browser could not read). */
  photo: PreviewPhoto | null
  framing?: PrintFraming
  /** How far the art runs past the trim: on a sheet, the sheet's bleed; none on its own. */
  bleed?: PrintBleed
}>

/** The brand the preview plans an Immersive face with: the logo as its whole picture, read for its ink; or the wordmark. */
function previewImmersiveBrand(input: PreviewImmersiveInput): PrintImmersiveBrand {
  if (input.look.logoUrl === null) return { kind: 'wordmark', text: input.look.wordmark }
  return {
    kind: 'logo',
    inkWidth: input.logo?.aspect ?? PREVIEW_LOGO_ASPECT,
    inkHeight: 1,
    medianInkLuminance: input.logo?.medianInkLuminance ?? null,
  }
}

/** An Immersive face as the file lays it out and paints it, from the preview's measures and its decode of the photo. */
export function previewImmersiveFace(input: PreviewImmersiveInput): PrintImmersiveFace {
  const { look, photo } = input
  return layoutPrintImmersiveFace({
    face: input.face,
    blocks: input.blocks,
    brand: previewImmersiveBrand(input),
    tile: input.tile,
    measurer: previewMeasurer,
    accentColour: look.accentColour,
    fieldColour: look.fieldColour,
    bleed: input.bleed,
    photo:
      photo === null
        ? null
        : {
            ...photo,
            focal: look.heroFocal ?? { x: 0.5, y: 0.5 },
            framing: input.framing ?? PRINT_DEFAULT_FRAMING,
          },
  })
}

export type PreviewBackInput = Readonly<{
  face: PrintFace
  look: PortalPrintKitView['look']
  /** The logo picture's width over its height, once it has loaded. */
  logoAspect: number | null
  /** The front put the logo on its cream plate: the back follows it. */
  onPlate: boolean
}>

/** A card's back page as the file lays it out, from the preview's measures: the logo or the wordmark, and the property's name. */
export function previewBackLayout(input: PreviewBackInput): PrintBackLayout {
  const { face, look } = input
  return layoutPrintBack({
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
    measurer: previewMeasurer,
  })
}
