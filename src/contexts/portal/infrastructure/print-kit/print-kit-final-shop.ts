// The final print-shop file in the PDF (final design spec §10.3, the board
// print-shop): one piece per page, from the geometry the Share tab's preview
// reads (`portal-print-final-shop.ts`). The page is the bleed box, or the trim
// plus the margin the crop marks need when they are switched on; the face sits
// at the trim and is clipped to its trim and bleed (an Immersive face's photo and
// ground run into the bleed on every edge, a Paper face's bleed is white). A
// TrimBox and a BleedBox are declared on every page, Paper's too, so a preflight
// finds the trim and the bleed without being told. A card's optional back follows
// as the next page, on the same page and with the same marks.

import {
  PRINT_FINAL_SHOP_MARK_COLOUR,
  type PrintFinalShopPage,
} from '#/shared/domain/portal-print-final-shop'
import type { FinalPreparedBack } from './print-kit-final-back'
import type { FinalPreparedFace } from './print-kit-final-immersive'
import {
  drawFinalMarks,
  drawFinalPlaced,
  type FinalDrawable,
} from './print-kit-final-sheets'

export type FinalShopInput = Readonly<{
  page: PrintFinalShopPage
  /** The face on every front page, laid out once. */
  face: FinalPreparedFace
  /** The card's back, which follows as the next page. */
  back?: FinalPreparedBack
}>

/**
 * Declares the trim and the bleed of the current page. Boxes are `[left, bottom,
 * right, top]` in PDF space, whose origin is the bottom-left of the page.
 */
function setShopPageBoxes(page: PDFKit.PDFPage, shop: PrintFinalShopPage): void {
  const box = (rect: PrintFinalShopPage['trim']): number[] => [
    rect.leftPt,
    shop.heightPt - (rect.topPt + rect.heightPt),
    rect.leftPt + rect.widthPt,
    shop.heightPt - rect.topPt,
  ]
  Object.assign(page.dictionary.data, {
    TrimBox: box(shop.trim),
    BleedBox: box(shop.bleed),
  })
}

/** One page of the file: the piece at its trim, the marks round it, its boxes declared. */
function drawShopPage(
  doc: PDFKit.PDFDocument,
  shop: PrintFinalShopPage,
  piece: FinalDrawable,
): void {
  doc.addPage({ size: [shop.widthPt, shop.heightPt], margin: 0 })
  setShopPageBoxes(doc.page, shop)
  drawFinalPlaced(doc, piece, { ...shop.trim, turnDeg: 0 })
  drawFinalMarks(doc, PRINT_FINAL_SHOP_MARK_COLOUR, shop.marks)
}

/** Adds the file's page to the document, and the back's after it where there is one. */
export function drawFinalShopPages(doc: PDFKit.PDFDocument, input: FinalShopInput): void {
  const { page, face, back } = input
  drawShopPage(doc, page, face)
  if (back !== undefined) drawShopPage(doc, page, back)
}
