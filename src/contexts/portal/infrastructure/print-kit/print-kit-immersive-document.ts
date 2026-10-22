// An Immersive print, from the request to the pages (spec 5 and 6): the faces
// laid out on their print-shop pages, the photo cropped once for each window the
// layout made (the 4 × 6 in and A6 windows differ, and so does a window the fit
// has shrunk), and the pages drawn with their crop marks, fold marks and slug.
//
// A dark logo sits on a cream plate, the photo is dimmed by how light its crop
// is, and a soft logo or photo is reported without stopping the print.

import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import {
  PHOTO_MIN_DPI,
  monogramLetter,
  printShopSlugLines,
} from '#/shared/domain/portal-print-kit-immersive'
import {
  IMMERSIVE_LOGO_PLATE,
  immersivePrintKitPalette,
  logoNeedsCreamPlate,
} from '#/shared/domain/portal-print-kit-palette'
import { printKitPages, type PrintKitPage } from '#/shared/domain/portal-print-kit-sheets'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import { brandDpi } from './print-kit-face-brand'
import { logoArt, windowPhotoJpeg } from './print-kit-image'
import {
  drawImmersiveFace,
  layoutImmersiveFace,
  type ImmersiveFaceArt,
  type ImmersiveFaceLayout,
} from './print-kit-immersive-face'
import { drawPrintShopMarks } from './print-kit-marks'
import {
  drawStyledPages,
  layoutFaces,
  type FaceLayouts,
  type PrintKitWarning,
} from './print-kit-pages'
import { openImage, type OpenedImage } from './print-kit-pdf-image'
import type { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix } from './print-kit-qr'

type Warn = (warning: PrintKitWarning) => void

/** A window's picture size, to the hundredth of a point: windows of one size share a crop. */
const pictureKey = (layout: ImmersiveFaceLayout): string | null => {
  const picture = layout.window?.picture
  return picture === undefined
    ? null
    : `${picture.widthPt.toFixed(2)}x${picture.heightPt.toFixed(2)}`
}

/** The photo cropped and dimmed for every window size the layouts made, each embedded once. */
async function windowPhotos(
  doc: PDFKit.PDFDocument,
  input: PrintKitRenderInput,
  layouts: FaceLayouts<ImmersiveFaceLayout>,
  field: string,
  warn: Warn,
): Promise<ReadonlyMap<string, OpenedImage>> {
  const photos = new Map<string, OpenedImage>()
  const { photo } = input
  if (photo === null) return photos
  let lowestDpi = Number.POSITIVE_INFINITY
  for (const layout of layouts.values()) {
    const key = pictureKey(layout)
    const picture = layout.window?.picture
    if (key === null || picture === undefined || photos.has(key)) continue
    const crop = await windowPhotoJpeg(photo.bytes, {
      widthPt: picture.widthPt,
      heightPt: picture.heightPt,
      focalX: photo.focalX,
      focalY: photo.focalY,
      field,
    })
    lowestDpi = Math.min(lowestDpi, crop.dpi)
    photos.set(key, openImage(doc, crop.bytes))
  }
  if (lowestDpi < PHOTO_MIN_DPI) {
    warn({
      message: 'The print kit photo prints below the resolution a print needs',
      context: { dpi: Math.round(lowestDpi), minimumDpi: PHOTO_MIN_DPI },
    })
  }
  return photos
}

async function faceArtOf(
  doc: PDFKit.PDFDocument,
  input: PrintKitRenderInput,
): Promise<ImmersiveFaceArt> {
  const palette = immersivePrintKitPalette(input.accentColour, input.fieldColour)
  const logo = input.logo === null ? null : await logoArt(input.logo)
  return {
    palette,
    qr: qrMatrix(input.qrAddress),
    brand: {
      wordmark: input.wordmark,
      colour: palette.headline,
      logo:
        logo === null
          ? null
          : {
              image: openImage(doc, logo.bytes),
              ink: logo.ink,
              plate: logoNeedsCreamPlate(logo.ink.luminance)
                ? IMMERSIVE_LOGO_PLATE
                : null,
            },
    },
  }
}

/** What a page's slug line may say: the brand, the front's place label, the piece and which face. */
function slugLinesOf(
  input: PrintKitRenderInput,
  paper: PrintKitPaper,
  page: PrintKitPage,
): readonly string[] {
  const [front] = input.faces
  const [panel] = page.panels
  const cardWithBack = input.piece === 'counter_card' && input.faces.length > 1
  return printShopSlugLines(input.piece, paper, {
    brand: input.wordmark,
    place: front?.blocks[0]?.kicker ?? '',
    side: cardWithBack && panel !== undefined ? panel.side : null,
  })
}

/** Draws an Immersive print on the size family of `paper`: 4 × 6 in on Letter, A6 on A4. */
export async function drawImmersivePrint(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: PrintKitRenderInput,
  paper: PrintKitPaper,
  warn: Warn,
): Promise<void> {
  const art = await faceArtOf(doc, input)
  const pages = printKitPages(input.piece, input.faces.length, 'immersive', paper)
  const layouts = layoutFaces(input.faces, pages, (face, geometry) =>
    layoutImmersiveFace(doc, fonts, face, art, geometry),
  )
  const photos = await windowPhotos(doc, input, layouts, art.palette.field, warn)
  const letter = monogramLetter(input.wordmark)
  drawStyledPages(
    { doc, faces: input.faces, warn },
    pages,
    layouts,
    {
      draw: (layout, bleed) => {
        const key = pictureKey(layout)
        const photo = key === null ? null : (photos.get(key) ?? null)
        drawImmersiveFace(
          doc,
          fonts,
          layout,
          { palette: art.palette, photo, letter },
          bleed,
        )
      },
      logoDpi: (layout) => brandDpi(layout.brand.plan),
    },
    (page) =>
      drawPrintShopMarks(doc, fonts, page, paper, slugLinesOf(input, paper, page)),
  )
}
