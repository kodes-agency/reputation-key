// A card print at any size and in either style, from the request to the pages
// (round-2 spec-delta R1, R2, R4 and R5; round-3 S2, S3 and S6): the code's tile
// chosen from the address and the size (Large 1.75 in when its modules allow,
// else today's 2 in; Table and Mini refused when their tile would print the
// modules too small), every face planned on it, on Immersive the photo cropped
// once per band and bleed, and the pages of the size, style and output drawn:
// Paper's Letter 2-up with the print check and A4 4-up for Large, Table 4-up and
// Mini 10-up; Immersive's print-shop page with crop marks and the slug line, or
// an office sheet with plain black crop marks and a note.
//
// On Immersive every logo sits on the cream plate (R1); on Paper a logo too
// light for the paper sits on the field colour, as before. A band photo under
// 200 dpi is reported, and the print is still made.

import { cardTile } from '#/shared/domain/portal-print-kit-card'
import type { CardBrand } from '#/shared/domain/portal-print-kit-card-brand'
import { printKitSheetPages } from '#/shared/domain/portal-print-kit-formats'
import { OFFICE_CROP_COLOUR } from '#/shared/domain/portal-print-kit-sheet-parts'
import { printedDpi } from '#/shared/domain/portal-print-kit-measures'
import { cardBandArea } from '#/shared/domain/portal-print-kit-photo'
import { monogramLetter } from '#/shared/domain/portal-print-kit-immersive'
import {
  IMMERSIVE_LOGO_PLATE,
  immersivePrintKitPalette,
  logoNeedsPaperPlate,
  paperLogoPlate,
  paperPrintKitPalette,
  type PrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import type { PrintKitPage } from '#/shared/domain/portal-print-kit-sheets'
import type { CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import {
  PrintKitRenderRefusal,
  type PrintKitRenderInput,
} from '../../application/ports/portal-print-kit-renderer.port'
import {
  drawCardFace,
  layoutCardFace,
  type CardFaceArt,
  type CardFaceLayout,
} from './print-kit-card-face'
import { areaPhotos, type AreaOf } from './print-kit-area-photos'
import type { FaceLogo } from './print-kit-face-brand'
import { logoArt } from './print-kit-image'
import {
  drawPrintCheck,
  drawPrintShopMarks,
  drawSheetNote,
  drawTicks,
} from './print-kit-marks'
import {
  drawPrintPages,
  layoutFaces,
  panelLayouts,
  type FaceLayouts,
  type PrintKitWarning,
} from './print-kit-pages'
import { slugLinesOf } from './print-kit-immersive-document'
import { openImage } from './print-kit-pdf-image'
import type { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix, type QrMatrix } from './print-kit-qr'

type Warn = (warning: PrintKitWarning) => void

const paletteOf = (input: PrintKitRenderInput): PrintKitPalette =>
  input.style === 'paper'
    ? paperPrintKitPalette(input.accentColour)
    : immersivePrintKitPalette(input.accentColour, input.fieldColour)

/** The tile the size prints this address on; a size whose tile would print it too small is refused. */
function tileFor(input: PrintKitRenderInput, qr: QrMatrix): CodeTile {
  const choice = cardTile(input.size, input.paper, {
    text: input.qrAddress,
    symbolModules: qr.size,
  })
  if (choice.isErr()) throw new PrintKitRenderRefusal(choice.error)
  return choice.value.tile
}

/** The art every face of a print shares: its palette, its code on the tile the size allows, its brand. */
export async function cardArtOf(
  doc: PDFKit.PDFDocument,
  input: PrintKitRenderInput,
): Promise<CardFaceArt> {
  const palette = paletteOf(input)
  const qr = qrMatrix(input.qrAddress)
  const tile = tileFor(input, qr)
  const logo = input.logo === null ? null : await logoArt(input.logo)
  const plateOf = (luminance: number | null): string | null => {
    if (input.style === 'immersive') return IMMERSIVE_LOGO_PLATE
    return logoNeedsPaperPlate(luminance) ? paperLogoPlate(input.accentColour) : null
  }
  return {
    size: input.size,
    style: input.style,
    paper: input.paper,
    palette,
    qr,
    tile,
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

/** A card's band with its bleed: the area the Share tab's notice measures too. */
const bandArea: AreaOf<CardFaceLayout> = (layout, bleed) =>
  cardBandArea(layout.plan, bleed)

/** The dots per inch a face's logo prints at; null for a wordmark. */
export function logoDpi(
  layout: Readonly<{ plan: Readonly<{ brand: CardBrand }>; logo: FaceLogo | null }>,
): number | null {
  const { brand } = layout.plan
  if (brand.kind !== 'logo' || layout.logo === null) return null
  const { image, ink } = layout.logo
  return printedDpi(image.width * (ink.right - ink.left), brand.ink.widthPt)
}

/** The pages a card prints on: its size's, in its style and output. */
const pagesOf = (input: PrintKitRenderInput, tile: CodeTile): readonly PrintKitPage[] =>
  printKitSheetPages({
    piece: 'counter_card',
    size: input.size,
    style: input.style,
    output: input.output,
    languageCount: input.faces[0]?.blocks.length ?? 1,
    paper: input.paper,
    faceCount: input.faces.length,
    tilePt: tile.tilePt,
  })

/** Draws a card print in its size and style, on the sheets of its output and paper. */
export async function drawCardPrint(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: PrintKitRenderInput,
  warn: Warn,
): Promise<void> {
  const art = await cardArtOf(doc, input)
  const pages = pagesOf(input, art.tile)
  const layouts: FaceLayouts<CardFaceLayout> = layoutFaces(input.faces, pages, (face) =>
    layoutCardFace(doc, fonts, face, art),
  )
  const placed = panelLayouts(pages, layouts)
  const photoAt = await areaPhotos(doc, input.photo, placed, bandArea, warn)
  const letter = monogramLetter(input.wordmark)
  drawPrintPages(
    { doc, faces: input.faces, warn },
    pages,
    layouts,
    {
      draw: (layout, bleed) =>
        drawCardFace(
          doc,
          fonts,
          layout,
          { photo: photoAt(layout, bleed), letter },
          bleed,
        ),
      logoDpi,
    },
    sheetMarks(doc, fonts, input, art),
  )
}

/**
 * What a sheet carries round its faces: a print shop's crop marks, fold marks
 * and slug, or an office sheet's ticks (black crop marks on Immersive), its note
 * and, on the Letter Large Paper sheet, the print check at the tile's width.
 */
export function sheetMarks(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: PrintKitRenderInput,
  art: Pick<CardFaceArt, 'palette' | 'tile'>,
): (page: PrintKitPage) => void {
  const { paper } = input
  return (page) => {
    if (page.marks === 'crop') {
      drawPrintShopMarks(doc, fonts, page, paper, slugLinesOf(input, paper, page))
      return
    }
    drawTicks(
      doc,
      page.ticks,
      page.marks === 'office-crop' ? OFFICE_CROP_COLOUR : undefined,
    )
    if (page.note !== null) drawSheetNote(doc, fonts, page.note)
    if (page.printCheck && art.palette.style === 'paper') {
      drawPrintCheck(doc, fonts, art.palette, art.tile.tilePt)
    }
  }
}
