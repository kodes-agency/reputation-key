// A Large card print in either style, from the request to the pages (round-2
// spec-delta R1, R2 and R5; round-3 S2 and S3): the code's tile chosen from the
// address (1.75 in when its modules allow, else today's 2 in), every face
// planned on it, on Immersive the photo cropped once per band with its bleed,
// and the pages drawn on the sheets already on main: Paper's Letter 2-up with
// the print check and A4 4-up, Immersive's print-shop page with crop marks and
// the slug line.
//
// On Immersive every logo sits on the cream plate (R1); on Paper a logo too
// light for the paper sits on the field colour, as before.

import { largeCardTile } from '#/shared/domain/portal-print-kit-card'
import { printedDpi } from '#/shared/domain/portal-print-kit-measures'
import { monogramLetter } from '#/shared/domain/portal-print-kit-immersive'
import {
  IMMERSIVE_LOGO_PLATE,
  immersivePrintKitPalette,
  logoNeedsPaperPlate,
  paperLogoPlate,
  paperPrintKitPalette,
  type PrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { printKitPages } from '#/shared/domain/portal-print-kit-sheets'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import {
  drawCardFace,
  layoutCardFace,
  type CardFaceArt,
  type CardFaceLayout,
} from './print-kit-card-face'
import { bandPhotoJpeg, logoArt } from './print-kit-image'
import { drawPrintCheck, drawPrintShopMarks, drawTicks } from './print-kit-marks'
import {
  drawPrintPages,
  layoutFaces,
  type FaceLayouts,
  type PrintKitWarning,
} from './print-kit-pages'
import { slugLinesOf } from './print-kit-immersive-document'
import { openImage, type OpenedImage } from './print-kit-pdf-image'
import { cropPhotoOnce } from './print-kit-photo-crops'
import type { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix } from './print-kit-qr'

type Warn = (warning: PrintKitWarning) => void

const paletteOf = (input: PrintKitRenderInput): PrintKitPalette =>
  input.style === 'paper'
    ? paperPrintKitPalette(input.accentColour)
    : immersivePrintKitPalette(input.accentColour, input.fieldColour)

async function cardArtOf(
  doc: PDFKit.PDFDocument,
  input: PrintKitRenderInput,
): Promise<CardFaceArt> {
  const palette = paletteOf(input)
  const qr = qrMatrix(input.qrAddress)
  const logo = input.logo === null ? null : await logoArt(input.logo)
  const plateOf = (luminance: number | null): string | null => {
    if (input.style === 'immersive') return IMMERSIVE_LOGO_PLATE
    return logoNeedsPaperPlate(luminance) ? paperLogoPlate(input.accentColour) : null
  }
  return {
    style: input.style,
    paper: input.paper,
    palette,
    qr,
    tile: largeCardTile(input.paper, { text: input.qrAddress, symbolModules: qr.size }),
    wordmark: input.wordmark,
    propertyName: input.propertyName,
    logo:
      logo === null
        ? null
        : {
            image: openImage(doc, logo.bytes),
            ink: logo.ink,
            plate: plateOf(logo.ink.luminance),
          },
  }
}

/** A band's size with its bleed, to the hundredth of a point: bands of one size share a crop. */
const bandKey = (layout: CardFaceLayout, bleedPt: number): string | null =>
  layout.plan.bandPt === null
    ? null
    : `${(layout.plan.widthPt + 2 * bleedPt).toFixed(2)}x${(layout.plan.bandPt + bleedPt).toFixed(2)}`

/** The photo cropped for every band the layouts made, with its bleed, each embedded once. */
function bandPhotos(
  doc: PDFKit.PDFDocument,
  input: PrintKitRenderInput,
  layouts: FaceLayouts<CardFaceLayout>,
  bleedPt: number,
  warn: Warn,
): Promise<ReadonlyMap<string, OpenedImage>> {
  const { photo } = input
  if (photo === null) return Promise.resolve(new Map())
  return cropPhotoOnce(
    doc,
    layouts.values(),
    (layout) => {
      const key = bandKey(layout, bleedPt)
      const { bandPt, widthPt } = layout.plan
      if (key === null || bandPt === null) return null
      const crop = () =>
        bandPhotoJpeg(photo.bytes, {
          widthPt: widthPt + 2 * bleedPt,
          heightPt: bandPt + bleedPt,
          focalX: photo.focalX,
          focalY: photo.focalY,
        })
      return { key, crop }
    },
    warn,
  )
}

/** The dots per inch a card's logo prints at; null for a wordmark. */
function logoDpi(layout: CardFaceLayout): number | null {
  const { brand } = layout.plan
  if (brand.kind !== 'logo' || layout.logo === null) return null
  const { image, ink } = layout.logo
  return printedDpi(image.width * (ink.right - ink.left), brand.ink.widthPt)
}

/** Draws a Large card print in its style, on the sheets of its paper. */
export async function drawCardPrint(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: PrintKitRenderInput,
  warn: Warn,
): Promise<void> {
  const { style, paper } = input
  const art = await cardArtOf(doc, input)
  const pages = printKitPages('counter_card', input.faces.length, style, paper)
  const layouts = layoutFaces(input.faces, pages, (face) =>
    layoutCardFace(doc, fonts, face, art),
  )
  const bleedPt = pages[0]?.bleedPt ?? 0
  const photos = await bandPhotos(doc, input, layouts, bleedPt, warn)
  const letter = monogramLetter(input.wordmark)
  drawPrintPages(
    { doc, faces: input.faces, warn },
    pages,
    layouts,
    {
      draw: (layout, bleed) => {
        const key = bandKey(layout, bleedPt)
        const photo = key === null ? null : (photos.get(key) ?? null)
        drawCardFace(doc, fonts, layout, { photo, letter }, bleed)
      },
      logoDpi,
    },
    (page) => {
      if (style === 'immersive') {
        drawPrintShopMarks(doc, fonts, page, paper, slugLinesOf(input, paper, page))
        return
      }
      drawTicks(doc, page.ticks)
      if (page.printCheck && art.palette.style === 'paper') {
        drawPrintCheck(doc, fonts, art.palette, art.tile.tilePt)
      }
    },
  )
}
