import { drawLine, type PrintKitFonts } from './print-kit-pdf-text'
// The print-shop file in the PDF (design spec §10.3, the board
// print-shop): one piece per page, from the geometry the Share tab's preview
// reads (`portal-print-shop.ts`). The page is the bleed box, or the trim
// plus the margin the crop marks need when they are switched on; the face sits
// at the trim and is clipped to its trim and bleed (an Immersive face's photo and
// ground run into the bleed on every edge, a Paper face's bleed is white). A
// TrimBox and a BleedBox are declared on every page, Paper's too, so a preflight
// finds the trim and the bleed without being told. A card's optional back follows
// as the next page, on the same page and with the same marks.

import {
  PRINT_SHOP_MARK_COLOUR,
  type PrintShopPage,
} from '#/shared/domain/portal-print-shop'
import type { PreparedBack } from './print-kit-back'
import type { PreparedFace } from './print-kit-immersive'
import { drawMarks, drawPlaced, type Drawable } from './print-kit-sheets'

export type ShopInput = Readonly<{
  personalName?: string
  fonts?: PrintKitFonts
  page: PrintShopPage
  /** The face on every front page, laid out once. */
  face: PreparedFace
  /** The card's back, which follows as the next page. */
  back?: PreparedBack
}>

/**
 * Declares the trim and the bleed of the current page. Boxes are `[left, bottom,
 * right, top]` in PDF space, whose origin is the bottom-left of the page.
 */
function setShopPageBoxes(page: PDFKit.PDFPage, shop: PrintShopPage): void {
  const box = (rect: PrintShopPage['trim']): number[] => [
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
  shop: PrintShopPage,
  piece: Drawable,
): void {
  doc.addPage({ size: [shop.widthPt, shop.heightPt], margin: 0 })
  setShopPageBoxes(doc.page, shop)
  drawPlaced(doc, piece, { ...shop.trim, turnDeg: 0 })
  drawMarks(doc, PRINT_SHOP_MARK_COLOUR, shop.marks)
}

/** Adds the file's page to the document, and the back's after it where there is one. */
export function drawShopPages(doc: PDFKit.PDFDocument, input: ShopInput): void {
  const { page, face, back } = input
  drawShopPage(doc, page, face)
  if (input.personalName && input.fonts && page.cropMarks)
    drawMarginName(doc, input.fonts, page, input.personalName)
  if (back !== undefined) {
    drawShopPage(doc, page, back)
    if (input.personalName && input.fonts && page.cropMarks)
      drawMarginName(doc, input.fonts, page, input.personalName)
  }
}

function drawMarginName(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  page: PrintShopPage,
  name: string,
) {
  doc.save().rect(page.trim.leftPt, 0, page.trim.widthPt, page.bleed.topPt).clip()
  drawLine(
    doc,
    fonts,
    `For ${name}`,
    {
      face: 'body',
      size: 6,
      spacing: 0,
      colour: PRINT_SHOP_MARK_COLOUR,
      opacity: 1,
    },
    { x: page.trim.leftPt, middleY: page.bleed.topPt / 2 },
  )
  doc.restore()
}
