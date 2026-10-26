// The final print kit as a PDF (final design spec, slices 3 to 6, 10 and 11):
// single pieces, one face per page at its trim, office sheets in both looks, and
// a print shop's file (one card per page with its bleed, boxes and optional crop
// marks), drawn with PDFKit; a card's optional back page follows its front, and a
// sheet's reverse follows the sheet. Paper is vectors (the code is rectangles, the type
// is the guest fonts embedded as subsets; only a logo is raster). Immersive adds
// its art under them: the ground and washes as vectors, the photo with its scrims
// baked in and its fade as a soft mask, the grain (`print-kit-final-immersive.ts`); on an
// office sheet or a print shop's page each piece's art runs into its bleed.
//
// The tile follows the symbol the address makes (`choosePrintFinalTile`): a
// piece whose module would print under 0.85 mm is refused before any page is
// drawn, and so is a pair of languages whose cues would not keep their padding
// in the bar (`cue_does_not_fit`), and so are words the face cannot hold at the
// smallest headline (`words_do_not_fit`). PDFKit is imported lazily, as for
// today's kit.

import {
  PrintFinalRenderRefusal,
  type PortalPrintFinalRenderer,
  type PrintFinalRenderInput,
  type PrintFinalShopInput,
  type PrintFinalSheetsInput,
} from '../../application/ports/portal-print-final-renderer.port'
import {
  choosePrintFinalTile,
  type PrintFinalTile,
} from '#/shared/domain/portal-print-final-code'
import { printFinalCuesFit } from '#/shared/domain/portal-print-final-cue'
import { printFinalPaperOf } from '#/shared/domain/portal-print-final'
import { printFinalHasBack } from '#/shared/domain/portal-print-final-back'
import {
  printFinalSheet,
  printFinalSheetFaceBleed,
} from '#/shared/domain/portal-print-final-immersive-sheets'
import {
  PRINT_FINAL_NO_BLEED,
  type PrintFinalBleed,
} from '#/shared/domain/portal-print-final-layers'
import { PRINT_FINAL_MEASURES } from '#/shared/domain/portal-print-final-measures'
import {
  printFinalShopFaceBleed,
  printFinalShopPage,
} from '#/shared/domain/portal-print-final-shop'
import {
  PRINT_FINAL_MAX_QUANTITY,
  printFinalPieceCount,
} from '#/shared/domain/portal-print-final-offer'
import { printFinalPaperColours } from '#/shared/domain/portal-print-final-colours'
import { paperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { prepareFinalBack, type FinalPreparedBack } from './print-kit-final-back'
import {
  drawFinalFace,
  layoutFinalFace,
  pdfFinalMeasurer,
  type FinalFaceArt,
  type FinalFaceLogo,
} from './print-kit-final-face'
import {
  prepareFinalImmersiveFace,
  type FinalPreparedFace,
} from './print-kit-final-immersive'
import { drawFinalShopPages } from './print-kit-final-shop'
import { drawFinalSheets } from './print-kit-final-sheets'
import { logoArt } from './print-kit-image'
import { openImage } from './print-kit-pdf-image'
import { PrintKitFonts } from './print-kit-pdf-text'
import { qrMatrix, type QrMatrix } from './print-kit-qr'

export type PdfKitPrintFinalRendererDeps = Readonly<{
  /** The clock the document's creation date reads. */
  now: () => Date
  /** Streams compress by default; a test turns it off to read what was drawn. */
  compress?: boolean
}>

function preparePaperFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  common: Readonly<{
    input: PrintFinalRenderInput
    tile: PrintFinalTile
    qr: QrMatrix
    logo: FinalFaceLogo | null
  }>,
): FinalPreparedFace {
  const { input, tile, qr, logo } = common
  const art: FinalFaceArt = {
    colours: printFinalPaperColours(paperPrintKitPalette(input.accentColour)),
    qr,
    wordmark: input.wordmark,
    logo,
  }
  const layout = layoutFinalFace(doc, fonts, {
    face: input.face,
    blocks: input.blocks,
    tile,
    art,
  })
  return {
    layout,
    look: { colours: art.colours, palette: null, logoOnPlate: false },
    bleed: PRINT_FINAL_NO_BLEED,
    draw: () => drawFinalFace(doc, fonts, layout, art),
  }
}

type PreparedPrint = Readonly<{
  prepared: FinalPreparedFace
  /** The card's back, where one was asked for. */
  back: FinalPreparedBack | null
  tile: PrintFinalTile
  fonts: PrintKitFonts
}>

/**
 * Reads the code and the logo and lays the face out; every refusal comes here,
 * before any page is added. An Immersive face's art runs into `bleed` (Paper has
 * nothing to run off the edge).
 */
async function prepareFace(
  doc: PDFKit.PDFDocument,
  input: PrintFinalRenderInput,
  bleed: PrintFinalBleed = PRINT_FINAL_NO_BLEED,
): Promise<PreparedPrint> {
  const { face } = input
  if (input.back !== undefined && !printFinalHasBack(face.piece)) {
    throw new RangeError('A tent has no back page: it prints its front on both faces')
  }
  const qr = qrMatrix(input.qrAddress)
  const tile = choosePrintFinalTile({
    ...face,
    address: input.address,
    symbolModules: qr.size,
  })
  if (tile.isErr()) throw new PrintFinalRenderRefusal(tile.error)
  const art = input.logo === null ? null : await logoArt(input.logo)
  const logo = art === null ? null : { image: openImage(doc, art.bytes), ink: art.ink }
  const fonts = new PrintKitFonts(doc)
  const common = { input, tile: tile.value, qr, logo, bleed }
  const prepared =
    face.look === 'paper'
      ? preparePaperFace(doc, fonts, common)
      : await prepareFinalImmersiveFace(doc, fonts, common)
  const { cuePt } = PRINT_FINAL_MEASURES[face.region][face.piece]
  const cueLines = prepared.layout.cues.map((cue) => cue.text)
  const measurer = pdfFinalMeasurer(doc, fonts)
  if (!printFinalCuesFit(cueLines, tile.value.tilePt, cuePt, measurer)) {
    throw new PrintFinalRenderRefusal({ code: 'cue_does_not_fit', moduleMm: null })
  }
  // The headline is at its floor and the words still crowd the face (a group gap
  // under 4u, ink past the live area, a headline over 3 lines or a sub-line over
  // 2): refused, as the Share tab holds the print back before it asks.
  if (prepared.layout.overflows) {
    throw new PrintFinalRenderRefusal({ code: 'words_do_not_fit', moduleMm: null })
  }
  const back =
    input.back === undefined
      ? null
      : prepareFinalBack(doc, fonts, {
          input,
          propertyName: input.back.propertyName,
          front: prepared,
          logo,
        })
  return { prepared, back, tile: tile.value, fonts }
}

async function drawPiece(
  doc: PDFKit.PDFDocument,
  input: PrintFinalRenderInput,
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
function pieceCountOf(sheets: PrintFinalSheetsInput, perSheet: number): number {
  const { quantity, fillSpares } = sheets
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > PRINT_FINAL_MAX_QUANTITY
  ) {
    throw new RangeError(
      `A print makes 1 to ${PRINT_FINAL_MAX_QUANTITY} pieces, not ${quantity}`,
    )
  }
  return printFinalPieceCount(quantity, perSheet, fillSpares)
}

async function drawSheets(
  doc: PDFKit.PDFDocument,
  input: PrintFinalRenderInput,
  sheets: PrintFinalSheetsInput,
): Promise<void> {
  const { face } = input
  const sheet = printFinalSheet({
    piece: face.piece,
    orientation: face.orientation,
    look: face.look,
    paper: printFinalPaperOf(face.region),
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
    printFinalSheetFaceBleed(sheet),
  )
  drawFinalSheets(doc, fonts, {
    sheet,
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
  input: PrintFinalRenderInput,
  shop: PrintFinalShopInput,
): Promise<void> {
  const page = printFinalShopPage({ face: input.face, cropMarks: shop.cropMarks })
  const { prepared, back } = await prepareFace(doc, input, printFinalShopFaceBleed(page))
  drawFinalShopPages(doc, { page, face: prepared, ...(back === null ? {} : { back }) })
}

/** The pages the request asks for: office sheets, a print shop's file, or the lone piece. */
async function drawPages(
  doc: PDFKit.PDFDocument,
  input: PrintFinalRenderInput,
): Promise<void> {
  const { sheets, shop } = input
  if (sheets !== undefined && shop !== undefined) {
    throw new RangeError('A print is office sheets or a print shop’s file, not both')
  }
  if (sheets !== undefined) return drawSheets(doc, input, sheets)
  if (shop !== undefined) return drawShop(doc, input, shop)
  return drawPiece(doc, input)
}

export function createPdfKitPrintFinalRenderer(
  deps: PdfKitPrintFinalRendererDeps,
): PortalPrintFinalRenderer {
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
