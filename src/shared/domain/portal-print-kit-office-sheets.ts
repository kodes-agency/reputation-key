// The Immersive office sheets (round-3 spec-delta S6; round-2 R4): cards that
// bleed for a cutter, printed on the customer's own printer. Pure and shared,
// built from the round-3 sheet parts (`portal-print-kit-size-sheets.ts`).
//
//   Immersive Table 4-up: the Paper block; one bleed runs round it and each card
//   bleeds only on its outer edges, so no card paints into its neighbour; plain
//   black crop marks outside, and a note up the left margin.
//   Immersive Large office sheet: two cards on a landscape sheet, each with its
//   own bleed and crop marks.
//
// Every mark and note stays at least 0.25 in from the sheet's edge. The board
// draws the Immersive Table note 0.125 in from the edge, which a printer would
// cut off, so it moves in to 0.27 in.

import type { PrintFaceSide, PrintKitPaper } from './portal-print-kit'
import { inToPt, mmToPt } from './portal-print-kit-measures'
import {
  PANEL_SIZE_PT,
  PRINTER_BORDER_PT,
  SHEET_PT,
  bleedAround,
  cardGeometryOf,
  type PanelBleed,
  type PrintKitPage,
  type SheetNote,
} from './portal-print-kit-sheets'
import {
  A4_SIDE_NOTE_LEFT_PT,
  TABLE_BLOCK,
  barMeasureText,
  blockMarks,
  cellsOf,
  noteUpTheSide,
  panelIn,
  type Block,
  type MarkSpans,
  type Span,
} from './portal-print-kit-size-sheets'

const TURNED_NOTE_PT = 6

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
