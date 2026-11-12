// An Immersive face in the PDF (design spec §4 and §6): the photo
// read and cropped, the logo read for how light it is, the face laid out and
// painted by the shared planner (`layoutPrintImmersiveFace`) with the
// guest fonts' own measures, then drawn: the art first, the words, marks and
// code over it.

import type { PrintRenderInput } from '../../application/ports/portal-print-renderer.port'
import type { PrintTile } from '#/shared/domain/portal-print-code'
import type { PrintFaceLayout } from '#/shared/domain/portal-print-face'
import { printFramingOf } from '#/shared/domain/portal-print-framing'
import { PRINT_NO_BLEED, type PrintBleed } from '#/shared/domain/portal-print-layers'
import type { PrintColours } from '#/shared/domain/portal-print-colours'
import type { PrintImmersivePalette } from '#/shared/domain/portal-print-immersive'
import {
  layoutPrintImmersiveFace,
  type PrintImmersiveBrand,
  type PrintImmersiveFace,
} from '#/shared/domain/portal-print-immersive-face'
import { drawArt, grainTile } from './print-kit-art'
import { drawFace, logoInkSize, pdfMeasurer, type FaceLogo } from './print-kit-face'
import { logoTone, photoImage, scenePhoto } from './print-kit-photo'
import type { PrintKitFonts } from './print-kit-pdf-text'
import type { QrMatrix } from './print-kit-qr'

/** What a face is painted in, which its back page takes up so both sides agree. */
export type FaceLook = Readonly<{
  colours: PrintColours
  /** The Immersive palette (the ground the back stands on); null on Paper. */
  palette: PrintImmersivePalette | null
  /** The logo sits on its cream plate. */
  logoOnPlate: boolean
}>

export type PreparedFace = Readonly<{
  layout: PrintFaceLayout
  look: FaceLook
  /** How far its art runs past each trim edge: none on a lone piece, the bleed on an Immersive sheet's. */
  bleed: PrintBleed
  /** Draws the face on the current page. */
  draw: () => void
}>

type Common = Readonly<{
  input: PrintRenderInput
  tile: PrintTile
  qr: QrMatrix
  logo: FaceLogo | null
  /** The bleed its art runs into; none by default. */
  bleed?: PrintBleed
}>

async function brandOf(common: Common): Promise<PrintImmersiveBrand> {
  const { input, logo } = common
  if (logo === null || input.logo === null)
    return { kind: 'wordmark', text: input.wordmark }
  return {
    kind: 'logo',
    ...logoInkSize(logo),
    medianInkLuminance: await logoTone(input.logo),
  }
}

/** Reads the photo and the logo, lays the face out and paints it, ready to draw once its page is added. */
export async function prepareImmersiveFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  common: Common,
): Promise<PreparedFace & Readonly<{ immersive: PrintImmersiveFace }>> {
  const { input, tile, qr, logo } = common
  const bleed = common.bleed ?? PRINT_NO_BLEED
  const framing = printFramingOf(input.framings, input.face)
  const scene = input.photo === null ? null : await scenePhoto(input.photo, framing)
  const immersive = layoutPrintImmersiveFace({
    face: input.face,
    blocks: input.blocks,
    brand: await brandOf(common),
    tile,
    measurer: pdfMeasurer(doc, fonts),
    accentColour: input.accentColour,
    fieldColour: input.fieldColour,
    photo: scene,
    bleed,
  })
  const { art } = immersive
  const photo =
    scene === null || input.photo === null
      ? null
      : await photoImage(doc, input.photo.bytes, scene, art)
  // A sheet draws one face many times: its images are made once.
  const images = { photo, grain: grainTile(doc) }
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
      drawArt(doc, art, images)
      drawFace(doc, fonts, immersive.layout, {
        colours: immersive.colours,
        qr,
        logo,
        wordmark: input.wordmark,
      })
    },
  }
}
