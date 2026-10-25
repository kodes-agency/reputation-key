// The final print kit's office sheets (final design spec §10.1 and §10.2): one
// geometry table per look, piece × orientation × paper, holding the page, the
// cells each piece or tent flat fills, and how each is turned. This file holds
// the shapes both looks share and the Paper table; the Immersive table, with its
// bleed and gaps, is `portal-print-final-immersive-sheets.ts`. Pure and shared,
// so the PDF and the Share tab's preview place the same pieces in the same cells.
//
// The numbers are the design's own, copied from the generator that drew and
// measured the boards (`final-sheets.mjs`, `layoutFor`), in the units the spec
// states them in: inches on Letter, millimetres on A4. Stored in points, with
// y down from the page's top-left corner.
//
//   - The grid turns with the piece: Counter and Small grids turn a quarter
//     between orientations and the page turns from portrait to landscape. A
//     piece never turns inside its cell, except the third card on the Letter
//     Counter sheet, which lies across the lower strip.
//   - A tent folds from a flat: a wide face from a quarter (4.25 × 5.5 in, or an
//     A6 quarter), an upright face from a strip (2.75 × 8.5 in, 74.25 × 210 mm).
//     On each flat the back face sits upside down above the fold, the front below.
//   - Paper cells share their cuts and may touch the sheet's edge: the guard is
//     in each face's own margins (`printFinalLiveArea`), so ink stays 0.5 in from
//     the paper's short edges and 0.34 in from its long edges.

import type { PrintKitPaper } from './portal-print-kit'
import type {
  PrintFinalLook,
  PrintFinalOrientation,
  PrintFinalPiece,
} from './portal-print-final'
import { inPt, mmPt } from './portal-print-final-measures'

export type PrintFinalSheetKey = Readonly<{
  piece: PrintFinalPiece
  orientation: PrintFinalOrientation
  paper: PrintKitPaper
}>

/**
 * How a sheet is cut: `cards` are cut piece by piece on grey ticks; `quarters`
 * and `strips` carry no cut marks, because their cuts are the sheet's halves,
 * or the halves of halves.
 */
export type PrintFinalSheetKind = 'cards' | 'quarters' | 'strips'

/** The box one piece, or one tent flat, fills on the sheet. */
export type PrintFinalSheetCell = Readonly<{
  leftPt: number
  topPt: number
  widthPt: number
  heightPt: number
  /** The card lies a quarter turn across its cell. */
  turned: boolean
}>

export type PrintFinalSheet = Readonly<
  PrintFinalSheetKey & {
    look: PrintFinalLook
    /** How far each piece's art runs past its trim: none on Paper, the paper's bleed on Immersive. */
    bleedPt: number
    widthPt: number
    heightPt: number
    landscape: boolean
    kind: PrintFinalSheetKind
    /** Each cell is a tent flat: two faces joined at a fold, dashed marks on the fold line. */
    folds: boolean
    cells: readonly PrintFinalSheetCell[]
  }
>

/** x, y, width, height and whether the card is turned, in the paper's unit. */
export type Row = readonly [x: number, y: number, w: number, h: number, turned?: true]

export type SheetRows = Readonly<{
  landscape: boolean
  kind: PrintFinalSheetKind
  rows: readonly Row[]
}>

export type Rows = Readonly<
  Record<PrintFinalPiece, Readonly<Record<PrintFinalOrientation, SheetRows>>>
>

/** `cols` × `rows` equal cells, `gap` apart (none: abutting), row by row from `origin`. */
export function grid(
  cell: readonly [w: number, h: number],
  cols: number,
  rows: number,
  origin: readonly [x: number, y: number],
  gap = 0,
): readonly Row[] {
  const [w, h] = cell
  return Array.from({ length: cols * rows }, (_, index): Row => {
    const col = index % cols
    const row = Math.floor(index / cols)
    return [origin[0] + col * (w + gap), origin[1] + row * (h + gap), w, h]
  })
}

/** Letter, in inches. */
const LETTER: Rows = {
  counter: {
    upright: {
      landscape: false,
      kind: 'cards',
      rows: [
        [0.25, 0.45, 4, 6],
        [4.25, 0.45, 4, 6],
        [1.25, 6.7, 6, 4, true],
      ],
    },
    wide: {
      landscape: true,
      kind: 'cards',
      rows: [
        [0.45, 0.25, 6, 4],
        [0.45, 4.25, 6, 4],
        [6.7, 1.25, 4, 6, true],
      ],
    },
  },
  tent: {
    wide: { landscape: false, kind: 'quarters', rows: grid([4.25, 5.5], 2, 2, [0, 0]) },
    upright: { landscape: true, kind: 'strips', rows: grid([2.75, 8.5], 4, 1, [0, 0]) },
  },
  small: {
    wide: { landscape: false, kind: 'cards', rows: grid([3.5, 2], 2, 5, [0.75, 0.5]) },
    upright: { landscape: true, kind: 'cards', rows: grid([2, 3.5], 5, 2, [0.5, 0.75]) },
  },
}

/** A4, in millimetres. The Counter card's quarters sit 0.5 mm in from the sheet's top, since 2 × 148 mm leaves 1 mm over. */
const A4: Rows = {
  counter: {
    upright: {
      landscape: false,
      kind: 'quarters',
      rows: grid([105, 148], 2, 2, [0, 0.5]),
    },
    wide: { landscape: true, kind: 'quarters', rows: grid([148, 105], 2, 2, [0.5, 0]) },
  },
  tent: {
    wide: { landscape: false, kind: 'quarters', rows: grid([105, 148.5], 2, 2, [0, 0]) },
    upright: { landscape: true, kind: 'strips', rows: grid([74.25, 210], 4, 1, [0, 0]) },
  },
  small: {
    wide: { landscape: false, kind: 'cards', rows: grid([85, 54], 2, 5, [20, 13.5]) },
    upright: { landscape: true, kind: 'cards', rows: grid([54, 85], 5, 2, [13.5, 20]) },
  },
}

/** The paper's own size, portrait. */
export const PAGES: Readonly<
  Record<PrintKitPaper, Readonly<{ widthPt: number; heightPt: number }>>
> = Object.freeze({
  letter: { widthPt: inPt(8.5), heightPt: inPt(11) },
  a4: { widthPt: mmPt(210), heightPt: mmPt(297) },
})

export const toCell =
  (unit: (value: number) => number) =>
  ([x, y, w, h, turned]: Row): PrintFinalSheetCell => ({
    leftPt: unit(x),
    topPt: unit(y),
    widthPt: unit(w),
    heightPt: unit(h),
    turned: turned === true,
  })

/** The sheet a table row makes: the page, turned to landscape where the piece turns it, and its cells. */
export function sheetOf(
  key: PrintFinalSheetKey,
  look: PrintFinalLook,
  bleedPt: number,
  { landscape, kind, rows }: SheetRows,
): PrintFinalSheet {
  const letter = key.paper === 'letter'
  const portrait = PAGES[key.paper]
  return {
    ...key,
    look,
    bleedPt,
    widthPt: landscape ? portrait.heightPt : portrait.widthPt,
    heightPt: landscape ? portrait.widthPt : portrait.heightPt,
    landscape,
    kind,
    folds: key.piece === 'tent',
    cells: rows.map(toCell(letter ? inPt : mmPt)),
  }
}

/** One Paper sheet: pieces that share their cuts and have no bleed. */
export function printFinalPaperSheet(key: PrintFinalSheetKey): PrintFinalSheet {
  const table = key.paper === 'letter' ? LETTER : A4
  return sheetOf(key, 'paper', 0, table[key.piece][key.orientation])
}

/** One face's place on the sheet: the box it fills and how it is turned to fill it. */
export type PrintFinalSheetPlacement = Readonly<{
  leftPt: number
  topPt: number
  widthPt: number
  heightPt: number
  /**
   * The face's turn in degrees, positive clockwise as CSS and PDFKit turn: a
   * quarter turn counter-clockwise (-90), or upside down (180). The box is the
   * turned face's.
   */
  turnDeg: 0 | 180 | -90
}>

/** The faces a cell holds: a card, or a tent flat's back face (upside down, above the fold) and front face. */
export function printFinalCellPlacements(
  sheet: Pick<PrintFinalSheet, 'folds'>,
  cell: PrintFinalSheetCell,
): readonly PrintFinalSheetPlacement[] {
  const { leftPt, topPt, widthPt, heightPt } = cell
  if (!sheet.folds) {
    return [{ leftPt, topPt, widthPt, heightPt, turnDeg: cell.turned ? -90 : 0 }]
  }
  const half = heightPt / 2
  return [
    { leftPt, topPt, widthPt, heightPt: half, turnDeg: 180 },
    { leftPt, topPt: topPt + half, widthPt, heightPt: half, turnDeg: 0 },
  ]
}

/** A line within this of the sheet's edge is the sheet's edge, not a cut (1 mm and a hair). */
const EDGE_PT = mmPt(1.05)
/** Two edges this close are one line. */
const SAME_LINE_PT = 0.07

const isInside = (value: number, max: number) =>
  value >= EDGE_PT && value <= max - EDGE_PT

function distinctInside(values: readonly number[], max: number): readonly number[] {
  const inside = [...values].filter((value) => isInside(value, max)).sort((a, b) => a - b)
  return inside.filter(
    (value, index) => index === 0 || value - (inside[index - 1] ?? value) > SAME_LINE_PT,
  )
}

/** The cuts: the x of every vertical line and the y of every horizontal one that is not the sheet's own edge. */
export type PrintFinalSheetCuts = Readonly<{
  xsPt: readonly number[]
  ysPt: readonly number[]
}>

export function printFinalSheetCuts(
  sheet: Pick<PrintFinalSheet, 'widthPt' | 'heightPt'>,
  cells: readonly PrintFinalSheetCell[],
): PrintFinalSheetCuts {
  return {
    xsPt: distinctInside(
      cells.flatMap((c) => [c.leftPt, c.leftPt + c.widthPt]),
      sheet.widthPt,
    ),
    ysPt: distinctInside(
      cells.flatMap((c) => [c.topPt, c.topPt + c.heightPt]),
      sheet.heightPt,
    ),
  }
}

/**
 * How many pieces each sheet carries: every cell on all but the last sheet,
 * which carries what is left (exact N). The remaining cells print nothing.
 */
export function printFinalSheetFills(
  perSheet: number,
  pieceCount: number,
): readonly number[] {
  return Array.from({ length: Math.ceil(pieceCount / perSheet) }, (_, sheet) =>
    Math.min(perSheet, pieceCount - sheet * perSheet),
  )
}
