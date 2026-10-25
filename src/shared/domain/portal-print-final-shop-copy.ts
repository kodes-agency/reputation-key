// What the Share tab says to a manager who has a print shop print the cards
// (final design spec §10.3 and §11.3; the Round 4 recommendations, "Share says
// what to order"): the line that says what to order, the note the "Copy a note
// for the print shop" button carries, the crop-marks option under More options,
// and the words under the preview of the file's page. Copy only, in one place,
// so each line is tested as written.
//
// The words in Share never say "bleed": the order line says the print margins
// are added, and the jargon (trim, bleed, TrimBox, BleedBox) lives in the note,
// which is addressed to the shop. No product names are used: the stock is named
// by its weight, and the weights are the recommendations' to be checked against
// a real catalogue before the copy is released.

import type { PrintKitPaper } from './portal-print-kit'
import {
  printFinalRegionOf,
  type PrintFinalLook,
  type PrintFinalOrientation,
  type PrintFinalPiece,
  type PrintFinalPrinter,
  type PrintFinalRegion,
} from './portal-print-final'
import {
  printFinalShopPage,
  printFinalHasShopFile,
  type PrintFinalShopPage,
  type PrintFinalShopPiece,
} from './portal-print-final-shop'
import { printFinalTileLabel } from './portal-print-final-sheet-notes'
import {
  printFinalPaperReason,
  printFinalSides,
  printFinalSizeLabel,
  printFinalStockLine,
  printFinalTrimLabel,
} from './portal-print-final-share'

/** The crop-marks option under More options: a checkbox like the spares, a choice for this print. */
export const PRINT_FINAL_SHOP_CROP_MARKS_LABEL = 'Add crop marks'

export const PRINT_FINAL_SHOP_CROP_MARKS_HELP =
  'Most shops cut from the page edge, so leave this off. Turn it on if your shop asks for crop marks: the page gets wider to show them.'

export const PRINT_FINAL_SHOP_NOTE_BUTTON = 'Copy a note for the print shop'
export const PRINT_FINAL_SHOP_NOTE_HINT = 'Paste it into the comments of your order.'
export const PRINT_FINAL_SHOP_NOTE_COPIED = 'Copied'
export const PRINT_FINAL_SHOP_NOTE_FAILED =
  'Copy failed: this browser blocked clipboard access. The note is selected; copy it by hand.'

/** What a print shop is asked for, by piece: a postcard's size, or a business card's. */
const SHOP_PRODUCT: Readonly<Record<PrintFinalShopPiece, string>> = {
  counter: 'postcards',
  small: 'business cards',
}

/** The stock a shop is asked for: a thick, matte card. Weights are the recommendations', not a catalogue's. */
const SHOP_STOCK: Readonly<Record<PrintFinalRegion, string>> = {
  us: '14–16 pt',
  eu: '300–350 g/m²',
}

/** How far a crop mark starts from the bleed, and how long it is, as the note says it. */
const SHOP_MARKS: Readonly<Record<PrintFinalRegion, string>> = {
  us: '1/16 in beyond the bleed and 3/16 in long',
  eu: '1.5 mm beyond the bleed and 4.5 mm long',
}

const BLEED: Readonly<Record<PrintFinalRegion, string>> = { us: '1/8 in', eu: '3 mm' }

/** The card a print shop prints. */
export type PrintFinalShopPrint = Readonly<{
  piece: PrintFinalShopPiece
  orientation: PrintFinalOrientation
  look: PrintFinalLook
  paper: PrintKitPaper
  /** The optional back page: both sides are printed. */
  backPage?: boolean
  cropMarks?: boolean
}>

/** What to order, in the shop's words: "Order 4 × 6 in postcards, 14–16 pt, matte, one side. Upload this PDF as it is." */
export function printFinalShopOrderLine(print: PrintFinalShopPrint): string {
  const region = printFinalRegionOf(print.paper)
  const size = printFinalTrimLabel(print.piece, print.orientation, region)
  const sides = printFinalSides(print.backPage)
  return `Order ${size} ${SHOP_PRODUCT[print.piece]}, ${SHOP_STOCK[region]}, matte, ${sides}. Upload this PDF as it is.`
}

/**
 * The line under "Who prints it?": the stock for the manager's own printer, and
 * for a print shop what to order, why the paper is this one, and that the file
 * carries its own print margins. A tent has no file for a shop, so it keeps the
 * stock line, which says so.
 */
export function printFinalWhoLine(
  input: Readonly<{
    piece: PrintFinalPiece
    orientation: PrintFinalOrientation
    look: PrintFinalLook
    paper: PrintKitPaper
    printer: PrintFinalPrinter
    countryPaper: PrintKitPaper
    countryCode: string | null
    backPage?: boolean
  }>,
): string {
  const { piece, printer } = input
  if (printer !== 'print_shop' || !printFinalHasShopFile(piece)) {
    return printFinalStockLine(input)
  }
  const order = printFinalShopOrderLine({ ...input, piece })
  return `${order}${printFinalPaperReason(input)} A print shop gets one card per page, with print margins added.`
}

const pageSize = (page: PrintFinalShopPage): string =>
  printFinalSizeLabel(page.widthPt, page.heightPt, page.face.region)

/**
 * The note the "Copy a note for the print shop" button carries: the technical
 * line, in the shop's words: one card per page, the trim, the bleed and where the
 * boxes are, whether the page has crop marks, the colour, and the size of the
 * code to check on a proof. `tilePt` is the code's cream square as printed.
 */
export function printFinalShopNote(print: PrintFinalShopPrint, tilePt: number): string {
  const region = printFinalRegionOf(print.paper)
  const face = {
    piece: print.piece,
    orientation: print.orientation,
    look: print.look,
    region,
  }
  const page = printFinalShopPage({ face, cropMarks: false })
  const marks = printFinalShopPage({ face, cropMarks: true })
  const trim = printFinalTrimLabel(print.piece, print.orientation, region)
  const bleed = BLEED[region]
  const ground =
    print.look === 'immersive' ? 'the photo and colour run into it' : 'it is white'
  const pages =
    print.backPage === true
      ? 'One card per page: the front on page 1, the back on page 2.'
      : 'One card per page.'
  const cropMarks =
    print.cropMarks === true
      ? `Crop marks: on, along the trim lines, ${SHOP_MARKS[region]}; the page is ${pageSize(marks)}.`
      : 'Crop marks: none; the page is the bleed box.'
  return [
    `Print-ready PDF. ${pages}`,
    `Trim ${trim} (TrimBox).`,
    `Bleed ${bleed} on every side (BleedBox ${pageSize(page)}); ${ground}.`,
    cropMarks,
    'Colour: RGB; please convert to your press profile.',
    `Print at 100%, no scaling: the cream code square measures ${printFinalTileLabel(tilePt, region)}.`,
    `Stock: ${SHOP_STOCK[region]}, matte, ${printFinalSides(print.backPage)}.`,
  ].join(' ')
}

/** Above the preview of the file's page: "Your file · page 1 of 2", or its back. */
export function printFinalShopPageHeading(
  input: Readonly<{ backPage?: boolean; side: 'front' | 'back' }>,
): string {
  const pages = input.backPage === true ? 2 : 1
  return `page ${input.side === 'back' ? 2 : 1} of ${pages}`
}

/**
 * Under the preview of the file's page: how big it is and what the margin round
 * the card is. The dashed line is where the card is cut; with crop marks on, the
 * marks stand just outside the margin.
 */
export function printFinalShopPageCaption(
  page: PrintFinalShopPage,
  backPage: boolean | undefined,
): string {
  const { face } = page
  const margin = BLEED[face.region]
  const art =
    face.look === 'immersive' ? 'The photo and colour run into it.' : 'It stays white.'
  const marks = page.cropMarks
    ? ' Crop marks stand just outside it, on the lines the card is cut along.'
    : ''
  const back = backPage === true ? ' The back is page 2.' : ''
  return `${pageSize(page)}. One card per page, with a ${margin} print margin round it.${marks} ${art} The dashed line is where the card is cut.${back}`
}
