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
  layoutPrintFinalImmersiveFace,
  type PrintFinalImmersiveBrand,
  type PrintFinalImmersiveFace,
} from '#/shared/domain/portal-print-final-immersive-face'
import { drawFinalArt, grainTile } from './print-kit-final-art'
import {
  drawFinalFace,
  finalLogoInkSize,
  pdfFinalMeasurer,
  type FinalFaceLogo,
} from './print-kit-final-face'
import { finalLogoTone, finalPhotoImage, finalScenePhoto } from './print-kit-final-photo'
import type { PrintKitFonts } from './print-kit-pdf-text'
import type { QrMatrix } from './print-kit-qr'

export type FinalPreparedFace = Readonly<{
  layout: PrintFinalFaceLayout
  /** Draws the face on the current page. */
  draw: () => void
}>

type Common = Readonly<{
  input: PrintFinalRenderInput
  tile: PrintFinalTile
  qr: QrMatrix
  logo: FinalFaceLogo | null
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
  })
  const { art } = immersive
  const photo =
    scene === null || art.photo === null || input.photo === null
      ? null
      : await finalPhotoImage(doc, input.photo.bytes, scene, art.photo)
  return {
    layout: immersive.layout,
    immersive,
    draw: () => {
      drawFinalArt(doc, art, { photo, grain: grainTile(doc) })
      drawFinalFace(doc, fonts, immersive.layout, {
        colours: immersive.colours,
        qr,
        logo,
        wordmark: input.wordmark,
      })
    },
  }
}
