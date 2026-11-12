// The print kit's print-shop file (design spec §10.3, the board
// print-shop): one piece per page, the trim plus the bleed (1/8 in, or 3 mm) all
// round, its TrimBox and BleedBox declared, and crop marks that are off unless
// the manager asks for them.
//
//   - Marks off: the page is the bleed box, 4.25 × 6.25 in for the Counter card.
//   - Marks on: the page is the trim plus 0.375 in on each side, 4.75 × 6.75 in.
//     The marks run along the trim lines, 3/16 in long, starting 1/16 in beyond
//     the bleed, so each ends at the page's edge and none touches the art.
//   - Europe keeps the same shape in millimetres, as the bleed does (1/8 in, or
//     3 mm): a 3 mm bleed, marks that start 1.5 mm beyond it and run 4.5 mm,
//     a 9 mm margin.
//   - Immersive runs its photo and ground into the bleed on every edge. Paper's
//     bleed is white (it has nothing to run off the edge), and its file still
//     declares a bleed box.
//   - Counter cards and Small cards only: shops sell tents pre-scored from 4 × 6 in,
//     so tents stay office-only (Round 4, O1) and Share offers Counter cards.
//
// Pure and shared: the PDF draws this page and the Share tab's preview draws the
// same one. Stored in points, y down from the page's top-left corner. The marks
// are the office sheets' kind of mark (`PrintSheetMark`), drawn as ticks are,
// in plain black: a shop's marks are black, and `printTickRect` is the one
// place a tick's weight turns into a rectangle.

import type { PrintFace, PrintPiece } from './portal-print'
import type { PrintBleed } from './portal-print-layers'
import { inPt, mmPt, PRINT_DISTANCES, printLiveArea } from './portal-print-measures'
import { PRINT_SHEET_MARKS, type PrintSheetMark } from './portal-print-sheet-marks'

/** The pieces a print shop prints: the cards. A tent stays office-only. */
export type PrintShopPiece = Exclude<PrintPiece, 'tent'>

export const printHasShopFile = (piece: PrintPiece): piece is PrintShopPiece =>
  piece !== 'tent'

/** How far a crop mark starts beyond the bleed, and how long it is: 1/16 in and 3/16 in, 1.5 mm and 4.5 mm. */
const MARK_SPAN = Object.freeze({
  us: Object.freeze({ gapPt: inPt(1 / 16), lengthPt: inPt(3 / 16) }),
  eu: Object.freeze({ gapPt: mmPt(1.5), lengthPt: mmPt(4.5) }),
})

/** A shop's crop marks are plain black, at the weight of an office sheet's ticks. */
export const PRINT_SHOP_MARK_COLOUR = '#000000'

/** The paper round the card, as the preview shows the page: the shop's sheet is white. */
export const PRINT_SHOP_PAGE_COLOUR = '#FFFFFF'

type Rect = Readonly<{ leftPt: number; topPt: number; widthPt: number; heightPt: number }>

export type PrintShopPage = Readonly<{
  face: PrintFace
  cropMarks: boolean
  widthPt: number
  heightPt: number
  /** Where the finished piece is on the page (the TrimBox). */
  trim: Rect
  /** The art runs this far past the trim on every edge (the BleedBox). */
  bleedPt: number
  /** The bleed box on the page. */
  bleed: Rect
  /** Crop marks at the four corners of the trim, two each; none when they are off. */
  marks: readonly PrintSheetMark[]
}>

const grown = (rect: Rect, by: number): Rect => ({
  leftPt: rect.leftPt - by,
  topPt: rect.topPt - by,
  widthPt: rect.widthPt + 2 * by,
  heightPt: rect.heightPt + 2 * by,
})

/** The stretch a mark covers on one axis: past the trim's edge `at`, in the direction `out`, from `nearPt` to `farPt` beyond it. */
function stretch(
  at: number,
  out: 1 | -1,
  reach: Readonly<{ nearPt: number; farPt: number }>,
): Readonly<{ from: number; to: number }> {
  return out === 1
    ? { from: at + reach.nearPt, to: at + reach.farPt }
    : { from: at - reach.farPt, to: at - reach.nearPt }
}

/** The marks at one corner of the trim: one along its horizontal edge's line, one along its vertical's. */
function cornerMarks(
  trim: Rect,
  corner: Readonly<{ right: boolean; bottom: boolean }>,
  reach: Readonly<{ nearPt: number; farPt: number }>,
): readonly PrintSheetMark[] {
  const x = corner.right ? trim.leftPt + trim.widthPt : trim.leftPt
  const y = corner.bottom ? trim.topPt + trim.heightPt : trim.topPt
  const across = stretch(x, corner.right ? 1 : -1, reach)
  const down = stretch(y, corner.bottom ? 1 : -1, reach)
  return [
    { kind: 'tick', x0Pt: across.from, y0Pt: y, x1Pt: across.to, y1Pt: y },
    { kind: 'tick', x0Pt: x, y0Pt: down.from, x1Pt: x, y1Pt: down.to },
  ]
}

/**
 * The page of a print-shop file: the bleed box when the marks are off, the trim
 * plus the margin the marks need when they are on. A tent has none.
 */
export function printShopPage(
  input: Readonly<{ face: PrintFace; cropMarks: boolean }>,
): PrintShopPage {
  const { face, cropMarks } = input
  if (!printHasShopFile(face.piece)) {
    throw new RangeError('A print shop takes no tents: they print from an office sheet')
  }
  const { widthPt, heightPt } = printLiveArea(face)
  const bleedPt = PRINT_DISTANCES.bleedPt[face.region]
  const { gapPt, lengthPt } = MARK_SPAN[face.region]
  const reach = { nearPt: bleedPt + gapPt, farPt: bleedPt + gapPt + lengthPt }
  const marginPt = cropMarks ? reach.farPt : bleedPt
  const trim: Rect = { leftPt: marginPt, topPt: marginPt, widthPt, heightPt }
  return {
    face,
    cropMarks,
    widthPt: widthPt + 2 * marginPt,
    heightPt: heightPt + 2 * marginPt,
    trim,
    bleedPt,
    bleed: grown(trim, bleedPt),
    marks: cropMarks
      ? [false, true].flatMap((bottom) =>
          [false, true].flatMap((right) => cornerMarks(trim, { right, bottom }, reach)),
        )
      : [],
  }
}

/** How far the face's art runs past its trim on a shop's page: the bleed on every edge. */
export function printShopFaceBleed(page: Pick<PrintShopPage, 'bleedPt'>): PrintBleed {
  const { bleedPt } = page
  return { leftPt: bleedPt, topPt: bleedPt, rightPt: bleedPt, bottomPt: bleedPt }
}

/** A mark's weight, for a preview that draws it as a line. */
export const PRINT_SHOP_MARK_WEIGHT_PT = PRINT_SHEET_MARKS.tickWeightPt
