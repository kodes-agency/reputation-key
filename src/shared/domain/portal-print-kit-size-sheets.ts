// The office sheets of the round-3 sizes (round-3 spec-delta S6; round-2 R4):
// Table cards 4 to a Letter or A4 sheet, Mini cards 10 to a sheet on the
// business-card grid, and the Immersive office sheets, where the cards bleed
// for a cutter on the customer's own printer. Pure and shared, like the sheets
// they are built from (`portal-print-kit-sheets.ts`).
//
//   Paper Table 4-up: 2 × 2 abutting cards in one block, sharing their cut
//   lines (3 cuts down, 3 across), grey ticks in the margins, a note under it.
//   Immersive Table 4-up: the same block; one bleed runs round it and each card
//   bleeds only on its outer edges, so no card paints into its neighbour; plain
//   black crop marks outside, and a note up the left margin.
//   Paper Mini 10-up: 2 × 5 landscape cells of the business-card grid (Avery
//   5371 on Letter), the portrait Mini turned a quarter in each.
//   Immersive Large office sheet: two cards on a landscape sheet, each with its
//   own bleed and crop marks.
//
// Every mark and every note stays at least 0.25 in from the sheet's edge, inside
// what an office printer prints. The board draws the Immersive Table note 0.125
// in from the edge, which a printer would cut off, so it moves in to 0.27 in.

import type { PrintFaceSide, PrintKitPaper } from './portal-print-kit'
import { inToPt, mmToPt, ptToIn, ptToMm } from './portal-print-kit-measures'
import {
  PANEL_SIZE_PT,
  PRINTER_BORDER_PT,
  SHEET_PT,
  SIDES,
  TICK,
  bleedAround,
  cardGeometryOf,
  paperPage,
  swapColumns,
  type PanelBleed,
  type PrintKitPage,
  type PrintKitPagePanel,
  type PrintKitTick,
  type SheetNote,
} from './portal-print-kit-sheets'

type Span = readonly [number, number]

/** A block of abutting cells: its top-left corner, its cell, and how many across and down. */
type Block = Readonly<{
  leftPt: number
  topPt: number
  cellWidthPt: number
  cellHeightPt: number
  columns: number
  rows: number
}>

/** How far a block's marks stand off its edge: above and below, and left and right. */
type MarkSpans = Readonly<{ down: Span; across: Span }>

/** The cut lines of a block: down at each column edge, across at each row edge. */
function cutLines(block: Block): Readonly<{ xs: number[]; ys: number[] }> {
  const xs = Array.from(
    { length: block.columns + 1 },
    (_, i) => block.leftPt + i * block.cellWidthPt,
  )
  const ys = Array.from(
    { length: block.rows + 1 },
    (_, i) => block.topPt + i * block.cellHeightPt,
  )
  return { xs, ys }
}

/**
 * The marks on a block's cut lines, outside it: a short line above and below it
 * on every cut down, and left and right of it on every cut across, each as the
 * rectangle it fills, centred on its line.
 */
export function blockMarks(block: Block, spans: MarkSpans): readonly PrintKitTick[] {
  const { xs, ys } = cutLines(block)
  const right = block.leftPt + block.columns * block.cellWidthPt
  const bottom = block.topPt + block.rows * block.cellHeightPt
  const half = TICK.weightPt / 2
  const [downFrom, downTo] = spans.down
  const [acrossFrom, acrossTo] = spans.across
  const downLength = downTo - downFrom
  const acrossLength = acrossTo - acrossFrom
  return [
    ...xs.flatMap((x) => [
      {
        xPt: x - half,
        yPt: block.topPt - downTo,
        widthPt: TICK.weightPt,
        heightPt: downLength,
      },
      {
        xPt: x - half,
        yPt: bottom + downFrom,
        widthPt: TICK.weightPt,
        heightPt: downLength,
      },
    ]),
    ...ys.flatMap((y) => [
      {
        xPt: block.leftPt - acrossTo,
        yPt: y - half,
        widthPt: acrossLength,
        heightPt: TICK.weightPt,
      },
      {
        xPt: right + acrossFrom,
        yPt: y - half,
        widthPt: acrossLength,
        heightPt: TICK.weightPt,
      },
    ]),
  ]
}

/** A tile's width as a note names it: "1.4 in (3.6 cm)" on Letter, "36 mm (3.6 cm)" on A4. */
export function barMeasureText(tilePt: number, paper: PrintKitPaper): string {
  const cm = (ptToMm(tilePt) / 10).toFixed(1)
  if (paper === 'a4') return `${Math.round(ptToMm(tilePt))} mm (${cm} cm)`
  return `${Number(ptToIn(tilePt).toFixed(2))} in (${cm} cm)`
}

/** The 2 × 2 block of Table cards on each paper, and the 2 × 5 grid of Mini cells. */
const TABLE_BLOCK: Readonly<Record<PrintKitPaper, Block>> = {
  letter: {
    leftPt: inToPt(0.75),
    topPt: inToPt(0.5),
    cellWidthPt: inToPt(3.5),
    cellHeightPt: inToPt(5),
    columns: 2,
    rows: 2,
  },
  a4: {
    leftPt: mmToPt(15),
    topPt: mmToPt(18.5),
    cellWidthPt: mmToPt(90),
    cellHeightPt: mmToPt(130),
    columns: 2,
    rows: 2,
  },
}
const MINI_BLOCK: Readonly<Record<PrintKitPaper, Block>> = {
  letter: {
    leftPt: inToPt(0.75),
    topPt: inToPt(0.5),
    cellWidthPt: inToPt(3.5),
    cellHeightPt: inToPt(2),
    columns: 2,
    rows: 5,
  },
  a4: {
    leftPt: mmToPt(20),
    topPt: mmToPt(11),
    cellWidthPt: mmToPt(85),
    cellHeightPt: mmToPt(55),
    columns: 2,
    rows: 5,
  },
}

/**
 * The Paper ticks' spans: the boards' 0.06–0.24 in above and below, 0.12–0.42 in
 * at the sides. A4's margins are narrower, so its spans are shorter and still
 * clear the printer's border: 0.12–0.32 in at the sides of the Table block, and
 * 0.06–0.17 in above and below the Mini grid, whose margin is 11 mm.
 */
const PAPER_TICKS: Readonly<
  Record<'table' | 'mini', Readonly<Record<PrintKitPaper, MarkSpans>>>
> = {
  table: {
    letter: { down: [inToPt(0.06), inToPt(0.24)], across: [inToPt(0.12), inToPt(0.42)] },
    a4: { down: [inToPt(0.06), inToPt(0.24)], across: [inToPt(0.12), inToPt(0.32)] },
  },
  mini: {
    letter: { down: [inToPt(0.06), inToPt(0.24)], across: [inToPt(0.12), inToPt(0.42)] },
    a4: { down: [inToPt(0.06), inToPt(0.17)], across: [inToPt(0.12), inToPt(0.28)] },
  },
}

/** The crop marks round an Immersive office block, outside its bleed. */
const OFFICE_CROP: Readonly<Record<PrintKitPaper, MarkSpans>> = {
  // The boards' Table marks: short above and below, so they end 0.26 in from the edge.
  letter: { down: [inToPt(0.15), inToPt(0.24)], across: [inToPt(0.175), inToPt(0.355)] },
  a4: { down: [mmToPt(4), mmToPt(9)], across: [mmToPt(4), mmToPt(8)] },
}

/** The bleed an Immersive office sheet gives its cards: 1/8 in on Letter, 3 mm on A4. */
const OFFICE_BLEED_PT: Readonly<Record<PrintKitPaper, number>> = {
  letter: inToPt(0.125),
  a4: mmToPt(3),
}

const NOTE_PT = 6.5
const TURNED_NOTE_PT = 6

/** Under a block, from 16.5 pt in, as wide as its first cell less 6 pt, down to the printer's border. */
function noteUnder(block: Block, paper: PrintKitPaper, text: string): SheetNote {
  const top = block.topPt + block.rows * block.cellHeightPt + 2
  const left = block.leftPt + 16.5
  return {
    text,
    sizePt: NOTE_PT,
    leftPt: left,
    topPt: top,
    widthPt: block.leftPt + block.cellWidthPt - 6 - left,
    heightPt: SHEET_PT[paper].heightPt - PRINTER_BORDER_PT - top,
    turned: false,
  }
}

type Slot = Readonly<{
  leftPt: number
  topPt: number
  side: PrintFaceSide
  bleed: PanelBleed
}>

/** A card's face in a slot, upright or turned a quarter. */
const panelIn = (
  slot: Slot,
  geometry: PrintKitPagePanel['geometry'],
  turned: boolean,
): PrintKitPagePanel => ({
  side: slot.side,
  leftPt: slot.leftPt,
  topPt: slot.topPt,
  rotated: false,
  turned,
  geometry,
  bleed: slot.bleed,
})

const NO_EDGE_BLEED = bleedAround(0)

/** The cells of a block, row by row, as slots of one side with no bleed. */
const cellsOf = (block: Block, side: PrintFaceSide): readonly Slot[] =>
  Array.from({ length: block.rows * block.columns }, (_, index) => ({
    side,
    leftPt: block.leftPt + (index % block.columns) * block.cellWidthPt,
    topPt: block.topPt + Math.floor(index / block.columns) * block.cellHeightPt,
    bleed: NO_EDGE_BLEED,
  }))

/** Paper sheets: a sheet of fronts and, with a second face, a sheet of backs for a long-edge flip. */
function paperBlockPages(
  block: Block,
  faceCount: number,
  paper: PrintKitPaper,
  face: Readonly<{
    geometry: PrintKitPagePanel['geometry']
    turned: boolean
    ticks: MarkSpans
    note: string
  }>,
): readonly PrintKitPage[] {
  return SIDES.slice(0, faceCount).map((side) => {
    const cells = cellsOf(block, side)
    const flipped = side === 'front' ? cells : swapSlots(cells)
    const front = side === 'front'
    return paperPage(paper, {
      ticks: front ? blockMarks(block, face.ticks) : [],
      note: front ? noteUnder(block, paper, face.note) : null,
      printCheck: false,
      foldAtPt: null,
      panels: flipped.map((slot) => panelIn(slot, face.geometry, face.turned)),
    })
  })
}

/** The backs' slots: each row read right to left, as a long-edge flip mirrors it. */
function swapSlots(slots: readonly Slot[]): readonly Slot[] {
  const corners = swapColumns(slots.map((slot) => [slot.leftPt, slot.topPt] as const))
  return slots.map((slot, index) => {
    const [leftPt = slot.leftPt, topPt = slot.topPt] = corners[index] ?? []
    return { ...slot, leftPt, topPt }
  })
}

/** Paper Table cards, 4 to a sheet. */
export function paperTablePages(
  faceCount: number,
  paper: PrintKitPaper,
  tilePt: number,
): readonly PrintKitPage[] {
  return paperBlockPages(TABLE_BLOCK[paper], faceCount, paper, {
    geometry: cardGeometryOf('table', paper),
    turned: false,
    ticks: PAPER_TICKS.table[paper],
    note: `Print at Actual size (100%). The bar under each code measures ${barMeasureText(tilePt, paper)}. Cut on the ticks: 3 cuts down, 3 across.`,
  })
}

/**
 * Paper Mini cards, 10 to a sheet: each portrait card turned a quarter in its
 * landscape cell, its trim's corner set so its centre is the cell's.
 */
export function paperMiniPages(
  faceCount: number,
  paper: PrintKitPaper,
  tilePt: number,
): readonly PrintKitPage[] {
  const block = MINI_BLOCK[paper]
  const geometry = cardGeometryOf('mini', paper)
  const { widthPt, heightPt } = PANEL_SIZE_PT[geometry]
  const centred: Block = {
    ...block,
    leftPt: block.leftPt + (block.cellWidthPt - widthPt) / 2,
    topPt: block.topPt + (block.cellHeightPt - heightPt) / 2,
  }
  const stock = paper === 'letter' ? '3.5 × 2 in' : '85 × 55 mm'
  const pages = paperBlockPages(centred, faceCount, paper, {
    geometry,
    turned: true,
    ticks: PAPER_TICKS.mini[paper],
    note: `Print at Actual size (100%), or on ${stock} business-card stock. The bar under each code measures ${barMeasureText(tilePt, paper)}.`,
  })
  // The ticks and the note follow the cells, not the turned cards' trims. A4's
  // 11 mm foot holds one line, so its note runs up the 20 mm side margin.
  return pages.map((page) => {
    if (page.note === null) return page
    const text = page.note.text
    const note =
      paper === 'letter'
        ? noteUnder(block, paper, text)
        : noteUpTheSide(block, {
            text,
            sizePt: NOTE_PT,
            leftPt: A4_SIDE_NOTE_LEFT_PT,
            runPt: block.rows * block.cellHeightPt - 2 * mmToPt(4),
            footPt: mmToPt(4),
          })
    return { ...page, ticks: blockMarks(block, PAPER_TICKS.mini[paper]), note }
  })
}

/** Which outer edges a cell of a block bleeds on: only the block's own edges. */
function outerBleed(block: Block, index: number, bleedPt: number): PanelBleed {
  const column = index % block.columns
  const row = Math.floor(index / block.columns)
  return {
    topPt: row === 0 ? bleedPt : 0,
    rightPt: column === block.columns - 1 ? bleedPt : 0,
    bottomPt: row === block.rows - 1 ? bleedPt : 0,
    leftPt: column === 0 ? bleedPt : 0,
  }
}

/** The page of an Immersive office sheet: the whole sheet is the trim, with no boxes for a print shop. */
const officePage = (
  sheet: Readonly<{ widthPt: number; heightPt: number }>,
  rest: Pick<PrintKitPage, 'ticks' | 'note' | 'panels'>,
): PrintKitPage => ({
  ...sheet,
  trim: { leftPt: 0, topPt: 0, ...sheet },
  bleedPt: 0,
  marks: 'office-crop',
  printCheck: false,
  foldAtPt: null,
  ...rest,
})

/**
 * A note turned to run up the left margin, from 4 mm (or 6 pt) above the
 * block's foot, between the printer's border and the marks at the block's side.
 */
function noteUpTheSide(
  block: Block,
  note: Readonly<{
    text: string
    sizePt: number
    leftPt: number
    runPt: number
    footPt: number
  }>,
): SheetNote {
  return {
    text: note.text,
    sizePt: note.sizePt,
    leftPt: note.leftPt,
    topPt: block.topPt + block.rows * block.cellHeightPt - note.footPt,
    widthPt: note.runPt,
    heightPt: note.sizePt * 1.25,
    turned: true,
  }
}

/** Just inside the printer's border on A4, whose side margins are narrow. */
const A4_SIDE_NOTE_LEFT_PT = PRINTER_BORDER_PT + mmToPt(0.3)

/**
 * The Immersive Table note: Letter's up its 0.75 in margin, clear of the crop
 * marks; A4's between two cut lines, where no mark crosses its 15 mm margin.
 */
function tableOfficeNote(block: Block, paper: PrintKitPaper, text: string): SheetNote {
  return paper === 'letter'
    ? noteUpTheSide(block, {
        text,
        sizePt: TURNED_NOTE_PT,
        leftPt: inToPt(0.27),
        runPt: inToPt(6),
        footPt: 6,
      })
    : noteUpTheSide(block, {
        text,
        sizePt: TURNED_NOTE_PT,
        leftPt: A4_SIDE_NOTE_LEFT_PT,
        runPt: block.cellHeightPt - 2 * mmToPt(4),
        footPt: mmToPt(4),
      })
}

/**
 * Immersive Table cards, 4 to a sheet: the Paper block, the cards abutting.
 * With a second face the top row prints the front and the bottom row the back,
 * because a full-bleed sheet backed up on an office printer does not register.
 */
export function immersiveTableOfficePages(
  faceCount: number,
  paper: PrintKitPaper,
  tilePt: number,
): readonly PrintKitPage[] {
  const block = TABLE_BLOCK[paper]
  const bleedPt = OFFICE_BLEED_PT[paper]
  const bleedText = paper === 'letter' ? '1/8 in' : '3 mm'
  const slots = cellsOf(block, 'front').map((slot, index) => ({
    ...slot,
    side:
      faceCount > 1 && index >= block.columns ? ('back' as const) : ('front' as const),
    bleed: outerBleed(block, index, bleedPt),
  }))
  const note = `Actual size (100%) · the bar under each code measures ${barMeasureText(tilePt, paper)} · cut on the crop marks: the colour runs ${bleedText} past the outer edge`
  return [
    officePage(SHEET_PT[paper], {
      ticks: blockMarks(block, OFFICE_CROP[paper]),
      note: tableOfficeNote(block, paper, note),
      panels: slots.map((slot) => panelIn(slot, cardGeometryOf('table', paper), false)),
    }),
  ]
}

/** The Immersive Large office sheet's two trims, on a landscape sheet (round-2 R4). */
const LARGE_OFFICE: Readonly<
  Record<
    PrintKitPaper,
    Readonly<{ lefts: Span; topPt: number; across: Span; noteTopPt: number }>
  >
> = {
  letter: {
    lefts: [inToPt(1.125), inToPt(5.875)],
    topPt: inToPt(1.25),
    across: [inToPt(0.175), inToPt(0.355)],
    noteTopPt: inToPt(7.86),
  },
  // A6 cards in bleed boxes of 111 × 154 mm, 12 mm apart, margins 31.5 × 28 mm;
  // the marks in the gap stop 1 mm apart.
  a4: {
    lefts: [mmToPt(34.5), mmToPt(157.5)],
    topPt: mmToPt(31),
    across: [mmToPt(4), mmToPt(8.5)],
    noteTopPt: mmToPt(190),
  },
}

/**
 * Immersive Large cards, 2 to a landscape sheet, each with its own bleed and
 * crop marks. With a second face the second card is the back: the sheet holds
 * the card in both languages' order.
 */
export function immersiveLargeOfficePages(
  faceCount: number,
  paper: PrintKitPaper,
  tilePt: number,
): readonly PrintKitPage[] {
  const layout = LARGE_OFFICE[paper]
  const sheet = { widthPt: SHEET_PT[paper].heightPt, heightPt: SHEET_PT[paper].widthPt }
  const geometry = cardGeometryOf('large', paper)
  const trim = PANEL_SIZE_PT[geometry]
  const bleed = bleedAround(OFFICE_BLEED_PT[paper])
  const down = OFFICE_CROP[paper].across
  const ticks = layout.lefts.flatMap((leftPt) =>
    blockMarks(
      {
        leftPt,
        topPt: layout.topPt,
        cellWidthPt: trim.widthPt,
        cellHeightPt: trim.heightPt,
        columns: 1,
        rows: 1,
      },
      { down, across: layout.across },
    ),
  )
  const sides: readonly PrintFaceSide[] =
    faceCount > 1 ? ['front', 'back'] : ['front', 'front']
  const [first = 0, second = 0] = layout.lefts
  const bleedText = paper === 'letter' ? '1/8 in' : '3 mm'
  const noteLeft = first
  return [
    officePage(sheet, {
      ticks,
      note: {
        text: `Print at Actual size (100%) on 100–110 lb cover if your printer takes it. The bar under each code measures ${barMeasureText(tilePt, paper)}. Cut on the crop marks: the colour runs ${bleedText} past them, so no white edge shows.`,
        sizePt: 7,
        leftPt: noteLeft,
        topPt: layout.noteTopPt,
        widthPt: second + trim.widthPt - noteLeft,
        heightPt: sheet.heightPt - PRINTER_BORDER_PT - layout.noteTopPt,
        turned: false,
      },
      panels: [first, second].map((leftPt, index) =>
        panelIn(
          { leftPt, topPt: layout.topPt, side: sides[index] ?? 'front', bleed },
          geometry,
          false,
        ),
      ),
    }),
  ]
}
