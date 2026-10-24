// The pages of the small table tent (round-3 spec-delta S5, `tent-small-sheet`),
// Paper's 2-up office sheet and Immersive's print-shop page. Pure and shared,
// like the other sheets (`portal-print-kit-sheets.ts`).
//
//   Paper, on the customer's own printer: two 5 × 7 in flats side by side on a
//   landscape Letter sheet, at (0.5, 0.75) in, each the back face upside down
//   above the shared fold and the front face below it. Cut ticks on the outer
//   edges and on the shared middle cut, dashed fold ticks in both side margins
//   on the fold, and a 6.5 pt note in the top margin. A4 landscape takes two
//   130 × 180 mm flats the same way, at margins of 18.5 × 15 mm.
//   Immersive, for a print shop: one flat to a page with 1/8 in (3 mm) of bleed
//   on every edge but the fold, crop marks and fold marks in the slug. An
//   Immersive office sheet is not drawn (OD4), so `printKitFormatProblem`
//   refuses it.
//
// Every tick and the note stay at least 0.25 in from the sheet's edge, inside
// what an office printer prints.

import type { PrintKitPaper } from './portal-print-kit'
import { CARD_GRID, inToPt, mmToPt } from './portal-print-kit-measures'
import { NO_BLEED, bleedAround, type SheetNote } from './portal-print-kit-sheet-parts'
import {
  PANEL_SIZE_PT,
  PRINTER_BORDER_PT,
  TICK,
  immersivePage,
  type PanelGeometry,
  type PrintKitPage,
  type PrintKitPagePanel,
  type PrintKitTick,
} from './portal-print-kit-sheets'
import {
  barMeasureText,
  blockMarks,
  type Block,
  type MarkSpans,
} from './portal-print-kit-size-sheets'

/** The small tent's face on each paper. */
export const tentSmallGeometryOf = (paper: PrintKitPaper): PanelGeometry =>
  paper === 'letter' ? 'tentSmallLetter' : 'tentSmallA4'

/** The landscape sheets: Letter 11 × 8.5 in, A4 297 × 210 mm. */
const LANDSCAPE: Readonly<
  Record<PrintKitPaper, Readonly<{ widthPt: number; heightPt: number }>>
> = {
  letter: { widthPt: inToPt(11), heightPt: inToPt(8.5) },
  a4: { widthPt: mmToPt(297), heightPt: mmToPt(210) },
}

/** The two flats side by side: each a face tall twice over, folded across its middle. */
export const TENT_SMALL_BLOCK: Readonly<Record<PrintKitPaper, Block>> = {
  letter: {
    leftPt: inToPt(0.5),
    topPt: inToPt(0.75),
    cellWidthPt: inToPt(5),
    cellHeightPt: inToPt(7),
    columns: 2,
    rows: 1,
  },
  a4: {
    leftPt: mmToPt(18.5),
    topPt: mmToPt(15),
    cellWidthPt: mmToPt(130),
    cellHeightPt: mmToPt(180),
    columns: 2,
    rows: 1,
  },
}

/**
 * The cut ticks' spans: the board's 0.12–0.42 in above and below, 0.06–0.24 in
 * at the sides. A4's 15 mm top margin is narrower than Letter's 0.75 in, so its
 * ticks above and below are shorter, 0.1–0.32 in, and still clear the border.
 */
const CUT_TICKS: Readonly<Record<PrintKitPaper, MarkSpans>> = {
  letter: { down: [inToPt(0.12), inToPt(0.42)], across: [inToPt(0.06), inToPt(0.24)] },
  a4: { down: [inToPt(0.1), inToPt(0.32)], across: [inToPt(0.06), inToPt(0.24)] },
}

/**
 * Where the dashed fold ticks run in from each side edge: the board's 0.24–0.44
 * in, moved in to start at the printer's border; on A4, 7–12 mm, as the
 * Letter-half tent's A4 fold ticks start.
 */
const FOLD_TICKS: Readonly<Record<PrintKitPaper, readonly [number, number]>> = {
  letter: [PRINTER_BORDER_PT, inToPt(0.45)],
  a4: [mmToPt(7), mmToPt(12)],
}

/** A dash of a fold tick, and the gap after it: the print shop's fold-mark dash. */
const FOLD_DASH_PT = mmToPt(0.8)

/** A dashed tick across the line `y`, from `from` to `to`: whole dashes, centred in the span. */
function dashedAcross(y: number, from: number, to: number): readonly PrintKitTick[] {
  const count = Math.floor((to - from + FOLD_DASH_PT) / (2 * FOLD_DASH_PT))
  const run = count * FOLD_DASH_PT + (count - 1) * FOLD_DASH_PT
  const start = from + (to - from - run) / 2
  return Array.from({ length: count }, (_, index) => ({
    xPt: start + 2 * index * FOLD_DASH_PT,
    yPt: y - TICK.weightPt / 2,
    widthPt: FOLD_DASH_PT,
    heightPt: TICK.weightPt,
  }))
}

const NOTE_PT = 6.5

const NOTE_TEXT: Readonly<Record<PrintKitPaper, (bar: string) => string>> = {
  letter: (bar) =>
    `Print at Actual size (100%) on 80–100 lb cover. The bar under each code measures ${bar}. Cut on the ticks, score and fold on the dashed line: each tent stands about 3.4 in tall.`,
  a4: (bar) =>
    `Print at Actual size (100%) on 220–270 g/m² card. The bar under each code measures ${bar}. Cut on the ticks, score and fold on the dashed line: each tent stands about 8.7 cm tall.`,
}

/**
 * The note in the top margin: from the printer's border down to 4 pt above the
 * block, across the first flat between its outer cut tick and the middle one,
 * kept 0.3125 in (Letter) or 8 mm (A4) clear of each, as the board sets it.
 */
function topNote(paper: PrintKitPaper, tilePt: number): SheetNote {
  const block = TENT_SMALL_BLOCK[paper]
  const inset = paper === 'letter' ? inToPt(0.3125) : mmToPt(8)
  return {
    text: NOTE_TEXT[paper](barMeasureText(tilePt, paper)),
    sizePt: NOTE_PT,
    leftPt: block.leftPt + inset,
    topPt: PRINTER_BORDER_PT,
    widthPt: block.cellWidthPt - 2 * inset,
    heightPt: block.topPt - 4 - PRINTER_BORDER_PT,
    turned: false,
  }
}

/** One flat: the back face upside down above the fold, the front face under it. */
function flatPanels(
  leftPt: number,
  topPt: number,
  paper: PrintKitPaper,
  bleed: PrintKitPagePanel['bleed'],
): readonly PrintKitPagePanel[] {
  const geometry = tentSmallGeometryOf(paper)
  const faceHeight = PANEL_SIZE_PT[geometry].heightPt
  const face = { leftPt, rotated: false, turned: false, geometry, bleed }
  return [
    { ...face, side: 'back', topPt, rotated: true },
    { ...face, side: 'front', topPt: topPt + faceHeight },
  ]
}

/** Two Paper tents on one landscape sheet, both faces of each on the same side. */
export function paperSmallTentPage(paper: PrintKitPaper, tilePt: number): PrintKitPage {
  const block = TENT_SMALL_BLOCK[paper]
  const sheet = LANDSCAPE[paper]
  const foldAtPt = block.topPt + block.cellHeightPt / 2
  const right = sheet.widthPt
  const [from, to] = FOLD_TICKS[paper]
  return {
    ...sheet,
    trim: { leftPt: 0, topPt: 0, ...sheet },
    bleedPt: 0,
    marks: 'ticks',
    ticks: [
      ...blockMarks(block, CUT_TICKS[paper]),
      ...dashedAcross(foldAtPt, from, to),
      ...dashedAcross(foldAtPt, right - to, right - from),
    ],
    note: topNote(paper, tilePt),
    printCheck: false,
    foldAtPt,
    panels: [0, 1].flatMap((column) =>
      flatPanels(block.leftPt + column * block.cellWidthPt, block.topPt, paper, NO_BLEED),
    ),
  }
}

/** One Immersive tent to a page for a print shop: bleed on every edge but the fold. */
export function printShopSmallTentPage(paper: PrintKitPaper): PrintKitPage {
  const grid = CARD_GRID.immersive[paper]
  const { widthPt, heightPt } = PANEL_SIZE_PT[tentSmallGeometryOf(paper)]
  const origin = grid.trimOriginPt
  return immersivePage(
    grid,
    { widthPt, heightPt: 2 * heightPt },
    {
      foldAtPt: origin + heightPt,
      panels: flatPanels(origin, origin, paper, {
        ...bleedAround(grid.bleedPt),
        topPt: 0,
      }),
    },
  )
}
