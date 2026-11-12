// The print kit as a PDF (design spec, slices 3 to 6, 10 and 11):
// single pieces, one face per page at its trim, office sheets in both looks, and
// a print shop's file (one card per page with its bleed, boxes and optional crop
// marks), drawn with PDFKit; a card's optional back page follows its front, and a
// sheet's reverse follows the sheet. Paper is vectors (the code is rectangles, the type
// is the guest fonts embedded as subsets; only a logo is raster). Immersive adds
// its art under them: the ground and washes as vectors, the photo with its scrims
// baked in and its fade as a soft mask, the grain (`print-kit-immersive.ts`); on an
// office sheet or a print shop's page each piece's art runs into its bleed.
//
// The tile follows the symbol the address makes (`choosePrintTile`): a
// piece whose module would print under 0.85 mm is refused before any page is
// drawn, and so is a pair of languages whose cues would not keep their padding
// in the bar (`cue_does_not_fit`), and so are words the face cannot hold at the
// smallest headline (`words_do_not_fit`). PDFKit is imported lazily, as for
// today's kit.

import {
  PrintRenderRefusal,
  type PortalPrintRenderer,
  type PrintRenderInput,
  type PrintShopInput,
  type PrintSheetsInput,
} from '../../application/ports/portal-print-renderer.port'
import { choosePrintTile, type PrintTile } from '#/shared/domain/portal-print-code'
import { printCuesFit } from '#/shared/domain/portal-print-cue'
import { printPaperOf } from '#/shared/domain/portal-print'
import { printHasBack } from '#/shared/domain/portal-print-back'
import {
  printSheet,
  printSheetFaceBleed,
} from '#/shared/domain/portal-print-immersive-sheets'
import { PRINT_NO_BLEED, type PrintBleed } from '#/shared/domain/portal-print-layers'
import { PRINT_MEASURES } from '#/shared/domain/portal-print-measures'
import { printShopFaceBleed, printShopPage } from '#/shared/domain/portal-print-shop'
import { PRINT_MAX_QUANTITY, printPieceCount } from '#/shared/domain/portal-print-offer'
import { printPaperColours } from '#/shared/domain/portal-print-colours'
import { paperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { prepareBack, type PreparedBack } from './print-kit-back'
import {
  drawFace,
  layoutFace,
  pdfMeasurer,
  type FaceArt,
  type FaceLogo,
} from './print-kit-face'
import { prepareImmersiveFace, type PreparedFace } from './print-kit-immersive'
import { drawShopPages } from './print-kit-shop'
import { drawPrintSheets } from './print-kit-sheets'
import { logoArt } from './print-kit-image'
import { openImage } from './print-kit-pdf-image'
import { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix, type QrMatrix } from './print-kit-qr'

export type PdfKitPrintRendererDeps = Readonly<{
  /** The clock the document's creation date reads. */
  now: () => Date
  /** Streams compress by default; a test turns it off to read what was drawn. */
  compress?: boolean
}>

function preparePaperFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  common: Readonly<{
    input: PrintRenderInput
    tile: PrintTile
    qr: QrMatrix
    logo: FaceLogo | null
  }>,
): PreparedFace {
  const { input, tile, qr, logo } = common
  const art: FaceArt = {
    colours: printPaperColours(paperPrintKitPalette(input.accentColour)),
    qr,
    wordmark: input.wordmark,
    logo,
  }
  const layout = layoutFace(doc, fonts, {
    face: input.face,
    blocks: input.blocks,
    tile,
    art,
  })
  return {
    layout,
    look: { colours: art.colours, palette: null, logoOnPlate: false },
    bleed: PRINT_NO_BLEED,
    draw: () => drawFace(doc, fonts, layout, art),
  }
}

type PreparedPrint = Readonly<{
  prepared: PreparedFace
  /** The card's back, where one was asked for. */
  back: PreparedBack | null
  tile: PrintTile
  fonts: PrintKitFonts
}>

/**
 * Reads the code and the logo and lays the face out; every refusal comes here,
 * before any page is added. An Immersive face's art runs into `bleed` (Paper has
 * nothing to run off the edge).
 */
async function prepareFace(
  doc: PDFKit.PDFDocument,
  input: PrintRenderInput,
  bleed: PrintBleed = PRINT_NO_BLEED,
): Promise<PreparedPrint> {
  const { face } = input
  if (input.back !== undefined && !printHasBack(face.piece)) {
    throw new RangeError('A tent has no back page: it prints its front on both faces')
  }
  const qr = qrMatrix(input.qrAddress)
  const tile = choosePrintTile({
    ...face,
    address: input.address,
    symbolModules: qr.size,
  })
  if (tile.isErr()) throw new PrintRenderRefusal(tile.error)
  const art = input.logo === null ? null : await logoArt(input.logo)
  const logo = art === null ? null : { image: openImage(doc, art.bytes), ink: art.ink }
  const fonts = new PrintKitFonts(doc)
  const common = { input, tile: tile.value, qr, logo, bleed }
  const prepared =
    face.look === 'paper'
      ? preparePaperFace(doc, fonts, common)
      : await prepareImmersiveFace(doc, fonts, common)
  const { cuePt } = PRINT_MEASURES[face.region][face.piece]
  const cueLines = prepared.layout.cues.map((cue) => cue.text)
  const measurer = pdfMeasurer(doc, fonts)
  if (!printCuesFit(cueLines, tile.value.tilePt, cuePt, measurer)) {
    throw new PrintRenderRefusal({ code: 'cue_does_not_fit', moduleMm: null })
  }
  // The headline is at its floor and the words still crowd the face (a group gap
  // under 4u, ink past the live area, a headline over 3 lines or a sub-line over
  // 2): refused, as the Share tab holds the print back before it asks.
  if (prepared.layout.overflows) {
    throw new PrintRenderRefusal({ code: 'words_do_not_fit', moduleMm: null })
  }
  const back =
    input.back === undefined
      ? null
      : prepareBack(doc, fonts, {
          input,
          propertyName: input.back.propertyName,
          front: prepared,
          logo,
        })
  return { prepared, back, tile: tile.value, fonts }
}

async function drawPiece(
  doc: PDFKit.PDFDocument,
  input: PrintRenderInput,
): Promise<void> {
  const { prepared, back } = await prepareFace(doc, input)
  const { plan } = prepared.layout
  doc.addPage({ size: [plan.widthPt, plan.heightPt], margin: 0 })
  prepared.draw()
  if (back === null) return
  doc.addPage({ size: [plan.widthPt, plan.heightPt], margin: 0 })
  back.draw()
}

/** How many pieces a sheets request prints: the quantity, or every cell of the last sheet when it is filled with spares. */
function pieceCountOf(sheets: PrintSheetsInput, perSheet: number): number {
  const { quantity, fillSpares } = sheets
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > PRINT_MAX_QUANTITY) {
    throw new RangeError(
      `A print makes 1 to ${PRINT_MAX_QUANTITY} pieces, not ${quantity}`,
    )
  }
  return printPieceCount(quantity, perSheet, fillSpares)
}

async function drawSheets(
  doc: PDFKit.PDFDocument,
  input: PrintRenderInput,
  sheets: PrintSheetsInput,
): Promise<void> {
  const { face } = input
  const sheet = printSheet({
    piece: face.piece,
    orientation: face.orientation,
    look: face.look,
    paper: printPaperOf(face.region),
  })
  const perSheet = sheets.perSheet ?? sheet.cells.length
  if (!Number.isInteger(perSheet) || perSheet < 1 || perSheet > sheet.cells.length) {
    throw new RangeError(
      `A sheet carries 1 to ${sheet.cells.length} pieces, not ${perSheet}`,
    )
  }
  const pieceCount = pieceCountOf(sheets, perSheet)
  const { prepared, back, tile, fonts } = await prepareFace(
    doc,
    input,
    printSheetFaceBleed(sheet),
  )
  drawPrintSheets(doc, fonts, {
    sheet,
    ...(input.personalName ? { personalName: input.personalName } : {}),
    face: prepared,
    ...(back === null ? {} : { back }),
    tilePt: tile.tilePt,
    pieceCount,
    perSheet,
  })
}

/**
 * A print shop's file: the page the crop marks decide (the bleed box without
 * them), the face and its back drawn into it with their bleed. A tent is refused
 * by the page: shops sell tents pre-scored from 4 x 6 in, so they stay office-only.
 */
async function drawShop(
  doc: PDFKit.PDFDocument,
  input: PrintRenderInput,
  shop: PrintShopInput,
): Promise<void> {
  const page = printShopPage({ face: input.face, cropMarks: shop.cropMarks })
  const { prepared, back, fonts } = await prepareFace(
    doc,
    input,
    printShopFaceBleed(page),
  )
  drawShopPages(doc, {
    page,
    ...(input.personalName ? { personalName: input.personalName, fonts } : {}),
    face: prepared,
    ...(back === null ? {} : { back }),
  })
}

/** The pages the request asks for: office sheets, a print shop's file, or the lone piece. */
async function drawPages(
  doc: PDFKit.PDFDocument,
  input: PrintRenderInput,
): Promise<void> {
  const { sheets, shop } = input
  if (sheets !== undefined && shop !== undefined) {
    throw new RangeError('A print is office sheets or a print shop’s file, not both')
  }
  if (sheets !== undefined) return drawSheets(doc, input, sheets)
  if (shop !== undefined) return drawShop(doc, input, shop)
  return drawPiece(doc, input)
}

export function createPdfKitPrintRenderer(
  deps: PdfKitPrintRendererDeps,
): PortalPrintRenderer {
  return {
    render: async (input) => {
      const { default: PDFDocument } = await import('pdfkit')
      const doc = new PDFDocument({
        autoFirstPage: false,
        // The tile's clip and the outline's ring want nothing past PDF 1.4, which
        // today's kit writes too.
        pdfVersion: '1.4',
        // No default font: every line is set in an embedded guest font.
        font: '',
        compress: deps.compress ?? true,
        info: {
          Title: input.title,
          Author: 'Reputation Key',
          CreationDate: deps.now(),
        },
      })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      const finished = new Promise<void>((resolve, reject) => {
        doc.on('end', resolve)
        doc.on('error', reject)
      })
      await drawPages(doc, input)
      doc.end()
      await finished
      return new Uint8Array(Buffer.concat(chunks))
    },
  }
}
