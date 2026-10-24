// The sheets of the print kit (spec 4.3, 4.4, 5.1 and 6): which
// pages a piece prints on, how big each page is, where each face sits on it, and
// the marks round them. Pure and shared, like the measures it is built from: the
// PDF draws these pages and the Share tab's Whole sheet preview draws the same
// ones, so the preview cannot show a sheet the file does not print.
//
// Everything is in points, with the origin at the page's top-left corner. A face
// is placed by the top-left corner of its trim; a rotated face is turned 180°
// about its own centre, so it reads upright once the sheet is folded.
//
// Paper prints on the customer's own sheet, at Actual size: no bleed, so the
// trim is the page, and the only marks are grey ticks. Immersive is for a print
// shop: one trim per page with a bleed and a slug round it for crop marks.

import type {
  PrintFaceSide,
  PrintKitPaper,
  PrintKitPiece,
  PrintKitStyle,
} from './portal-print-kit'
import {
  CARD_GRID,
  CODE_BLOCK,
  IMMERSIVE_TENT_GRID,
  TENT_FACE_GRID,
  inToPt,
  mmToPt,
  ptToIn,
  ptToMm,
} from './portal-print-kit-measures'

/** The shapes a face can take: a card, a Paper tent face or an Immersive tent panel, per paper. */
export type PanelGeometry =
  'card4x6' | 'cardA6' | 'tentFaceLetter' | 'tentFaceA5' | 'tentPanel4x6' | 'tentPanelA6'

type Size = Readonly<{ widthPt: number; heightPt: number }>

const sizeOf = (grid: Size): Size => ({ widthPt: grid.widthPt, heightPt: grid.heightPt })

/** The trim of each face shape. */
export const PANEL_SIZE_PT: Readonly<Record<PanelGeometry, Size>> = {
  card4x6: sizeOf(CARD_GRID.paper.letter),
  cardA6: sizeOf(CARD_GRID.paper.a4),
  tentFaceLetter: sizeOf(TENT_FACE_GRID.letter),
  tentFaceA5: sizeOf(TENT_FACE_GRID.a4),
  tentPanel4x6: sizeOf(IMMERSIVE_TENT_GRID.letter),
  tentPanelA6: sizeOf(IMMERSIVE_TENT_GRID.a4),
}

/** The sheets a Paper piece prints on: US Letter, 8.5 × 11 in, and A4, 210 × 297 mm. */
const SHEET_PT: Readonly<Record<PrintKitPaper, Size>> = {
  letter: { widthPt: inToPt(8.5), heightPt: inToPt(11) },
  a4: { widthPt: mmToPt(210), heightPt: mmToPt(297) },
}

/** No ink comes closer to a sheet's edge than an office printer's border. */
export const PRINTER_BORDER_PT = inToPt(0.25)

/** The grey of the cut and fold ticks, and their weight. */
export const TICK = { colour: '#A39E97', weightPt: mmToPt(0.2) } as const

/** A tick, as the rectangle it fills. */
export type PrintKitTick = Readonly<{
  xPt: number
  yPt: number
  widthPt: number
  heightPt: number
}>

/**
 * The print check in the strip under the Letter cards, which is cut away: a
 * question, a bar exactly as wide as the bar under each code, and two lines on
 * what to measure and where to cut (spec 4.3). Its text may be smaller than what
 * a guest reads, because no guest reads it.
 */
export const PRINT_CHECK = {
  /** The top of the block, and the column it is centred in. */
  topPt: inToPt(6.7),
  centreXPt: inToPt(4.25),
  widthPt: inToPt(5.5),
  /** Between the question, the bar and the lines. */
  gapPt: inToPt(0.09),
  title: { text: 'Printed at Actual size?', sizePt: 9, leading: 1.2 },
  bar: { widthPt: CODE_BLOCK.tilePt, heightPt: inToPt(0.14) },
  lines: {
    text: [
      'The bar under each code and this bar both measure 2 in (5.1 cm).',
      'Cut down on the three ticks, then across 6 in from the top edge.',
    ],
    sizePt: 8,
    leading: 1.35,
  },
} as const

/** A tile's width as the print check names it: "2 in (5.1 cm)", "1.75 in (4.4 cm)". */
function tileMeasureText(tilePt: number): string {
  const inches = Number(ptToIn(tilePt).toFixed(2))
  return `${inches} in (${(ptToMm(tilePt) / 10).toFixed(1)} cm)`
}

/**
 * The print check's two lines for a card whose code sits on a tile `tilePt`
 * wide: the bar it draws is that wide, and so is the bar under each code. Today's
 * 2 in tile gives the lines of `PRINT_CHECK`.
 */
export function printCheckLines(tilePt: number): readonly string[] {
  const [, cut = ''] = PRINT_CHECK.lines.text
  return [
    `The bar under each code and this bar both measure ${tileMeasureText(tilePt)}.`,
    cut,
  ]
}

export type PrintKitPagePanel = Readonly<{
  side: PrintFaceSide
  /** The top-left corner of the face's trim on the page. */
  leftPt: number
  topPt: number
  /** Printed upside down, so it reads upright after the fold. */
  rotated: boolean
  geometry: PanelGeometry
}>

export type PrintKitPage = Readonly<{
  widthPt: number
  heightPt: number
  /** Where the finished piece is on the page: the whole page on Paper. */
  trim: Readonly<{ leftPt: number; topPt: number; widthPt: number; heightPt: number }>
  /** Art past the trim for a cutter: 0 on Paper, 1/8 in or 3 mm on Immersive. */
  bleedPt: number
  /** Grey ticks on Paper, crop marks for a print shop on Immersive. */
  marks: 'ticks' | 'crop'
  ticks: readonly PrintKitTick[]
  /** Whether the page carries the Letter card sheet's print check. */
  printCheck: boolean
  /** Where the sheet folds, down the page; null for a flat card. */
  foldAtPt: number | null
  panels: readonly PrintKitPagePanel[]
}>

const SIDES: readonly PrintFaceSide[] = ['front', 'back']
const tick = (xPt: number, yPt: number, widthPt: number, heightPt: number) => ({
  xPt,
  yPt,
  widthPt,
  heightPt,
})

/** A vertical tick on the line `x`, centred on it, from `top` to `bottom`. */
const downTick = (x: number, top: number, bottom: number) =>
  tick(x - TICK.weightPt / 2, top, TICK.weightPt, bottom - top)
/** A horizontal tick on the line `y`, centred on it, from `left` to `right`. */
const acrossTick = (y: number, left: number, right: number) =>
  tick(left, y - TICK.weightPt / 2, right - left, TICK.weightPt)

/**
 * Letter: two 4 × 6 in cards side by side at the top, at 0.25 in from each side.
 * Three ticks on the down cuts, in the strip under the cards: ticks beside the
 * cards would be inside the printer's border. The outer two sit just inside
 * their line, their outer edge on it, for the same reason.
 */
const LETTER_CARD_SLOTS = [inToPt(0.25), inToPt(4.25)] as const
const LETTER_CARD_TICKS: readonly PrintKitTick[] = [
  tick(inToPt(0.25), inToPt(6), TICK.weightPt, inToPt(0.3)),
  downTick(inToPt(4.25), inToPt(6), inToPt(6.3)),
  tick(inToPt(8.25) - TICK.weightPt, inToPt(6), TICK.weightPt, inToPt(0.3)),
]

/**
 * A4: four A6 cards at the quarters, so the sheet's factory edges are the outer
 * card edges and two cuts make four cards. The ticks lie on the cut lines inside
 * the cards' own margin, where the cut takes them away, and clear the printer's
 * border.
 */
const A4_CARD_SLOTS: readonly (readonly [number, number])[] = [
  [0, mmToPt(0.5)],
  [mmToPt(105), mmToPt(0.5)],
  [0, mmToPt(148.5)],
  [mmToPt(105), mmToPt(148.5)],
]
const A4_CARD_TICKS: readonly PrintKitTick[] = [
  downTick(mmToPt(105), mmToPt(7), mmToPt(11)),
  downTick(mmToPt(105), mmToPt(286), mmToPt(290)),
  acrossTick(mmToPt(148.5), mmToPt(7), mmToPt(11)),
  acrossTick(mmToPt(148.5), mmToPt(199), mmToPt(203)),
  acrossTick(mmToPt(148.5), mmToPt(102.5), mmToPt(107.5)),
  downTick(mmToPt(105), mmToPt(146), mmToPt(151)),
]

/** The fold ticks of a Paper tent, at the sheet's two sides and clear of its border. */
const TENT_FOLD_TICKS: Readonly<
  Record<PrintKitPaper, readonly (readonly [number, number])[]>
> = {
  letter: [
    [inToPt(0.3), inToPt(0.45)],
    [inToPt(8.05), inToPt(8.2)],
  ],
  a4: [
    [mmToPt(7), mmToPt(11)],
    [mmToPt(199), mmToPt(203)],
  ],
}

const paperPage = (
  paper: PrintKitPaper,
  rest: Omit<PrintKitPage, 'widthPt' | 'heightPt' | 'trim' | 'bleedPt' | 'marks'>,
): PrintKitPage => ({
  ...SHEET_PT[paper],
  trim: { leftPt: 0, topPt: 0, ...SHEET_PT[paper] },
  bleedPt: 0,
  marks: 'ticks',
  ...rest,
})

/**
 * Paper counter cards: a sheet of fronts, and with two languages a sheet of
 * backs for duplex on the long edge. A long-edge flip mirrors the sheet left to
 * right, so the backs' columns are swapped and stay at the top. The backs carry
 * no ticks and no print check: the cuts are made from the fronts.
 */
function paperCardPages(
  faceCount: number,
  paper: PrintKitPaper,
): readonly PrintKitPage[] {
  const geometry: PanelGeometry = paper === 'letter' ? 'card4x6' : 'cardA6'
  const slots: readonly (readonly [number, number])[] =
    paper === 'letter'
      ? LETTER_CARD_SLOTS.map((left) => [left, 0] as const)
      : A4_CARD_SLOTS
  return SIDES.slice(0, faceCount).map((side) => {
    const ordered = side === 'front' ? slots : swapColumns(slots)
    return paperPage(paper, {
      ticks:
        side === 'front' ? (paper === 'letter' ? LETTER_CARD_TICKS : A4_CARD_TICKS) : [],
      printCheck: side === 'front' && paper === 'letter',
      foldAtPt: null,
      panels: ordered.map(([leftPt, topPt]) => ({
        side,
        leftPt,
        topPt,
        rotated: false,
        geometry,
      })),
    })
  })
}

/** The slots of a row read right to left: what a long-edge flip makes of the columns. */
function swapColumns(
  slots: readonly (readonly [number, number])[],
): readonly (readonly [number, number])[] {
  const rows = [...new Set(slots.map(([, top]) => top))]
  return rows.flatMap((top) => slots.filter(([, y]) => y === top).reverse())
}

/**
 * A Paper tent: one sheet folded across the middle. The back face, which leads
 * with the second language, is in the top half upside down; the front is in the
 * bottom half. The top edge of each face is the fold.
 */
function paperTentPage(paper: PrintKitPaper): PrintKitPage {
  const geometry: PanelGeometry = paper === 'letter' ? 'tentFaceLetter' : 'tentFaceA5'
  const fold = PANEL_SIZE_PT[geometry].heightPt
  return paperPage(paper, {
    ticks: TENT_FOLD_TICKS[paper].map(([left, right]) => acrossTick(fold, left, right)),
    printCheck: false,
    foldAtPt: fold,
    panels: [
      { side: 'back', leftPt: 0, topPt: 0, rotated: true, geometry },
      { side: 'front', leftPt: 0, topPt: fold, rotated: false, geometry },
    ],
  })
}

/** An Immersive page: the trim inside its bleed and slug, which hold the crop marks. */
function immersivePage(
  grid: Readonly<{ trimOriginPt: number; bleedPt: number }>,
  trim: Size,
  rest: Pick<PrintKitPage, 'foldAtPt' | 'panels'>,
): PrintKitPage {
  const origin = grid.trimOriginPt
  return {
    widthPt: trim.widthPt + 2 * origin,
    heightPt: trim.heightPt + 2 * origin,
    trim: { leftPt: origin, topPt: origin, ...trim },
    bleedPt: grid.bleedPt,
    marks: 'crop',
    ticks: [],
    printCheck: false,
    ...rest,
  }
}

/**
 * Immersive cards print one face to a page; the tent is two card-size panels on
 * one flat page, folded across the middle, the back panel upside down.
 */
function immersivePages(
  piece: PrintKitPiece,
  faceCount: number,
  paper: PrintKitPaper,
): readonly PrintKitPage[] {
  if (piece === 'table_tent') {
    const grid = IMMERSIVE_TENT_GRID[paper]
    const geometry: PanelGeometry = paper === 'letter' ? 'tentPanel4x6' : 'tentPanelA6'
    const origin = grid.trimOriginPt
    return [
      immersivePage(
        grid,
        { widthPt: grid.widthPt, heightPt: 2 * grid.heightPt },
        {
          foldAtPt: origin + grid.heightPt,
          panels: [
            { side: 'back', leftPt: origin, topPt: origin, rotated: true, geometry },
            {
              side: 'front',
              leftPt: origin,
              topPt: origin + grid.heightPt,
              rotated: false,
              geometry,
            },
          ],
        },
      ),
    ]
  }
  const grid = CARD_GRID.immersive[paper]
  const geometry: PanelGeometry = paper === 'letter' ? 'card4x6' : 'cardA6'
  return SIDES.slice(0, faceCount).map((side) =>
    immersivePage(grid, sizeOf(grid), {
      foldAtPt: null,
      panels: [
        {
          side,
          leftPt: grid.trimOriginPt,
          topPt: grid.trimOriginPt,
          rotated: false,
          geometry,
        },
      ],
    }),
  )
}

/**
 * The pages of a piece in a style on a paper. `faceCount` is how many faces the
 * piece has (`printKitFaces`): a counter card has a back only with a second
 * language; a tent always has two faces on its one sheet.
 */
export function printKitPages(
  piece: PrintKitPiece,
  faceCount: number,
  style: PrintKitStyle,
  paper: PrintKitPaper,
): readonly PrintKitPage[] {
  if (style === 'immersive') return immersivePages(piece, faceCount, paper)
  return piece === 'table_tent'
    ? [paperTentPage(paper)]
    : paperCardPages(faceCount, paper)
}
