// An Immersive final face in the PDF (final design spec §4 and §6): the photo
// read and cropped, the logo read for how light it is, the face laid out and
// painted by the shared planner (`layoutPrintFinalImmersiveFace`) with the
// guest fonts' own measures, then drawn: the art first, the words, marks and
// code over it.

import type { PrintFinalRenderInput } from '../../application/ports/portal-print-final-renderer.port'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import type { PrintFinalFaceLayout } from '#/shared/domain/portal-print-final-face'
import { printFinalFramingOf } from '#/shared/domain/portal-print-final-framing'
import {
  PRINT_FINAL_NO_BLEED,
  type PrintFinalBleed,
} from '#/shared/domain/portal-print-final-layers'
import type { PrintFinalColours } from '#/shared/domain/portal-print-final-colours'
import type { PrintFinalImmersivePalette } from '#/shared/domain/portal-print-final-immersive'
import {
  layoutPrintFinalImmersiveFace,
  type PrintFinalImmersiveBrand,
  type PrintFinalImmersiveFace,
} from '#/shared/domain/portal-print-final-immersive-face'
import { drawFinalArt, grainTile, scrimImages } from './print-kit-final-art'
import {
  drawFinalFace,
  finalLogoInkSize,
  pdfFinalMeasurer,
  type FinalFaceLogo,
} from './print-kit-final-face'
import { finalLogoTone, finalPhotoImage, finalScenePhoto } from './print-kit-final-photo'
import type { PrintKitFonts } from './print-kit-pdf-text'
import type { QrMatrix } from './print-kit-qr'

/** What a face is painted in, which its back page takes up so both sides agree. */
export type FinalFaceLook = Readonly<{
  colours: PrintFinalColours
  /** The Immersive palette (the ground the back stands on); null on Paper. */
  palette: PrintFinalImmersivePalette | null
  /** The logo sits on its cream plate. */
  logoOnPlate: boolean
}>

export type FinalPreparedFace = Readonly<{
  layout: PrintFinalFaceLayout
  look: FinalFaceLook
  /** How far its art runs past each trim edge: none on a lone piece, the bleed on an Immersive sheet's. */
  bleed: PrintFinalBleed
  /** Draws the face on the current page. */
  draw: () => void
}>

type Common = Readonly<{
  input: PrintFinalRenderInput
  tile: PrintFinalTile
  qr: QrMatrix
  logo: FinalFaceLogo | null
  /** The bleed its art runs into; none by default. */
  bleed?: PrintFinalBleed
}>

async function brandOf(common: Common): Promise<PrintFinalImmersiveBrand> {
  const { input, logo } = common
  if (logo === null || input.logo === null)
    return { kind: 'wordmark', text: input.wordmark }
  return {
    kind: 'logo',
    ...finalLogoInkSize(logo),
    medianInkLuminance: await finalLogoTone(input.logo),
  }
}

/** Reads the photo and the logo, lays the face out and paints it, ready to draw once its page is added. */
export async function prepareFinalImmersiveFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  common: Common,
): Promise<FinalPreparedFace & Readonly<{ immersive: PrintFinalImmersiveFace }>> {
  const { input, tile, qr, logo } = common
  const bleed = common.bleed ?? PRINT_FINAL_NO_BLEED
  const framing = printFinalFramingOf(input.framings, input.face)
  const scene = input.photo === null ? null : await finalScenePhoto(input.photo, framing)
  const immersive = layoutPrintFinalImmersiveFace({
    face: input.face,
    blocks: input.blocks,
    brand: await brandOf(common),
    tile,
    measurer: pdfFinalMeasurer(doc, fonts),
    accentColour: input.accentColour,
    fieldColour: input.fieldColour,
    photo: scene,
    bleed,
  })
  const { art } = immersive
  const photo =
    scene === null || art.photo === null || input.photo === null
      ? null
      : await finalPhotoImage(doc, input.photo.bytes, scene, art.photo)
  // A sheet draws one face many times: its images are made once.
  const images = { photo, grain: grainTile(doc), scrims: scrimImages(doc, art) }
  return {
    layout: immersive.layout,
    look: {
      colours: immersive.colours,
      palette: immersive.palette,
      logoOnPlate: immersive.logoOnPlate,
    },
    bleed,
    immersive,
    draw: () => {
      drawFinalArt(doc, art, images)
      drawFinalFace(doc, fonts, immersive.layout, {
        colours: immersive.colours,
        qr,
        logo,
        wordmark: input.wordmark,
      })
    },
  }
}
