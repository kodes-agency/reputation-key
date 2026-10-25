import { describe, expect, it } from 'vitest'
import sheets from './__fixtures__/portal-print-final-immersive-sheets.json'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  printFinalRegionOf,
} from './portal-print-final'
import {
  printFinalImmersiveSheet,
  printFinalSheet,
  printFinalSheetFaceBleed,
} from './portal-print-final-immersive-sheets'
import { inPt, mmPt } from './portal-print-final-measures'
import { PRINT_FINAL_PER_SHEET } from './portal-print-final-offer'
import {
  printFinalCellPlacements,
  printFinalPaperSheet,
  printFinalSheetCuts,
  type PrintFinalSheet,
  type PrintFinalSheetCell,
} from './portal-print-final-sheets'
import type { PrintKitPaper } from './portal-print-kit'

// The Immersive office sheets against the final design's generator
// (final-design-2026-10-25, `final-sheets.mjs`, look `imm`): the page, every
// cell and every cut, for a full sheet and for sheets only partly filled, to a
// thousandth of an inch; then the rules of §10.1 the table must hold: the
// counts, a bleed that never runs onto the next piece, the trim's distance from
// the paper's edges, and that the abutting Table 4-up is never made.

type Layout = (typeof sheets.layouts)[number]

const PAPERS: readonly PrintKitPaper[] = ['letter', 'a4']
const KEYS = PRINT_FINAL_PIECES.flatMap((piece) =>
  PRINT_FINAL_ORIENTATIONS.flatMap((orientation) =>
    PAPERS.map((paper) => ({ piece, orientation, paper })),
  ),
)
const nameOf = (key: { piece: string; orientation: string; paper: string }) =>
  `${key.piece} ${key.orientation} on ${key.paper}`

const inches = (pt: number) => pt / 72
const near = (actual: number, expected: number, tolerance = 0.001) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)

const sheetOf = (layout: Layout): PrintFinalSheet =>
  printFinalImmersiveSheet({
    piece: layout.piece as PrintFinalSheet['piece'],
    orientation: layout.orientation as PrintFinalSheet['orientation'],
    paper: layout.paper as PrintKitPaper,
  })

const LAYOUTS = sheets.layouts.map((layout) => [nameOf(layout), layout] as const)

describe('the Immersive sheets against the generator', () => {
  it('covers every piece, orientation and paper', () => {
    expect(sheets.layouts).toHaveLength(12)
    expect(KEYS).toHaveLength(12)
  })

  it.each(LAYOUTS)(
    '%s: the page, the bleed and the cells are the generator’s',
    (_, layout) => {
      const sheet = sheetOf(layout)
      near(inches(sheet.widthPt), layout.width)
      near(inches(sheet.heightPt), layout.height)
      expect(sheet.landscape).toBe(layout.landscape)
      expect(sheet.look).toBe('immersive')
      expect(sheet.kind).toBe('cards')
      expect(sheet.folds).toBe(layout.flat)
      near(inches(sheet.bleedPt), layout.bleed)
      expect(sheet.cells).toHaveLength(layout.cells.length)
      layout.cells.forEach((cell, index) => {
        const mine = sheet.cells[index]
        near(inches(mine?.leftPt ?? NaN), cell.x)
        near(inches(mine?.topPt ?? NaN), cell.y)
        near(inches(mine?.widthPt ?? NaN), cell.w)
        near(inches(mine?.heightPt ?? NaN), cell.h)
      })
    },
  )

  it.each(LAYOUTS)(
    '%s: the cuts are the generator’s with every cell filled and with fewer',
    (_, layout) => {
      const sheet = sheetOf(layout)
      for (const filled of layout.filled) {
        const cuts = printFinalSheetCuts(sheet, sheet.cells.slice(0, filled.n))
        const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b)
        expect(cuts.xsPt).toHaveLength(filled.cuts.xs.length)
        expect(cuts.ysPt).toHaveLength(filled.cuts.ys.length)
        sorted(filled.cuts.xs).forEach((x, i) => near(inches(cuts.xsPt[i] ?? NaN), x))
        sorted(filled.cuts.ys).forEach((y, i) => near(inches(cuts.ysPt[i] ?? NaN), y))
      }
    },
  )
})

describe('fixed rule Y: the counts', () => {
  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: the cells are the pieces a sheet carries',
    (_, key) => {
      expect(printFinalImmersiveSheet(key).cells).toHaveLength(
        PRINT_FINAL_PER_SHEET[key.piece].immersive[key.paper],
      )
    },
  )

  it('carries 2 Counter cards, 2 tents and 8 Small cards on Letter, and 9 Small cards on A4', () => {
    const count = (piece: PrintFinalSheet['piece'], paper: PrintKitPaper) =>
      printFinalImmersiveSheet({ piece, orientation: 'wide', paper }).cells.length
    expect([count('counter', 'letter'), count('counter', 'a4')]).toEqual([2, 2])
    expect([count('tent', 'letter'), count('tent', 'a4')]).toEqual([2, 2])
    expect([count('small', 'letter'), count('small', 'a4')]).toEqual([8, 9])
  })
})

describe('turns and flats', () => {
  it('never turns a piece in its cell', () => {
    for (const key of KEYS) {
      expect(printFinalImmersiveSheet(key).cells.some((cell) => cell.turned)).toBe(false)
    }
  })

  it('turns the page with the piece: the grid turns a quarter between orientations', () => {
    const landscape = (
      piece: PrintFinalSheet['piece'],
      orientation: PrintFinalSheet['orientation'],
      paper: PrintKitPaper,
    ) => printFinalImmersiveSheet({ piece, orientation, paper }).landscape
    expect([
      landscape('counter', 'upright', 'letter'),
      landscape('counter', 'wide', 'letter'),
    ]).toEqual([true, false])
    expect([
      landscape('tent', 'wide', 'letter'),
      landscape('tent', 'upright', 'letter'),
    ]).toEqual([true, false])
    expect([
      landscape('small', 'wide', 'letter'),
      landscape('small', 'upright', 'letter'),
    ]).toEqual([false, true])
    expect([
      landscape('small', 'wide', 'a4'),
      landscape('small', 'upright', 'a4'),
    ]).toEqual([true, false])
  })

  it.each([
    ['wide on Letter', 'wide', 'letter', inPt(4.25), inPt(5.5)],
    ['upright on Letter', 'upright', 'letter', inPt(2.75), inPt(8.5)],
    ['wide on A4', 'wide', 'a4', mmPt(105), mmPt(148.5)],
    ['upright on A4', 'upright', 'a4', mmPt(74.25), mmPt(210)],
  ] as const)(
    'folds a %s tent from its flat, a quarter (wide) or a strip (upright)',
    (_, orientation, paper, widthPt, heightPt) => {
      const { cells } = printFinalImmersiveSheet({ piece: 'tent', orientation, paper })
      for (const cell of cells) {
        expect(cell.widthPt).toBeCloseTo(widthPt, 3)
        expect(cell.heightPt).toBeCloseTo(heightPt, 3)
      }
    },
  )

  it('places a tent flat’s back face upside down above the fold and its front below', () => {
    const sheet = printFinalImmersiveSheet({
      piece: 'tent',
      orientation: 'wide',
      paper: 'letter',
    })
    const [cell] = sheet.cells
    if (cell === undefined) throw new Error('no cell')
    const [back, front] = printFinalCellPlacements(sheet, cell)
    expect([back?.turnDeg, front?.turnDeg]).toEqual([180, 0])
    expect(back?.topPt).toBeCloseTo(cell.topPt, 6)
    expect(front?.topPt).toBeCloseTo(cell.topPt + cell.heightPt / 2, 6)
  })
})

describe('bleed and gaps', () => {
  const boxesOf = (sheet: PrintFinalSheet) =>
    sheet.cells.map((cell: PrintFinalSheetCell) => ({
      left: cell.leftPt - sheet.bleedPt,
      top: cell.topPt - sheet.bleedPt,
      right: cell.leftPt + cell.widthPt + sheet.bleedPt,
      bottom: cell.topPt + cell.heightPt + sheet.bleedPt,
    }))

  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: carries its own bleed, 1/8 in (3 mm on A4), and no two bleeds overlap',
    (_, key) => {
      const sheet = printFinalImmersiveSheet(key)
      expect(sheet.bleedPt).toBeCloseTo(key.paper === 'letter' ? inPt(1 / 8) : mmPt(3), 6)
      const boxes = boxesOf(sheet)
      boxes.forEach((a, i) =>
        boxes.slice(i + 1).forEach((b) => {
          const across = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          expect(across <= 1e-6 || down <= 1e-6).toBe(true)
        }),
      )
    },
  )

  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: never makes the abutting 4-up: every cell has a gap to the next',
    (_, key) => {
      const sheet = printFinalImmersiveSheet(key)
      sheet.cells.forEach((a, i) =>
        sheet.cells.slice(i + 1).forEach((b) => {
          const across =
            Math.max(a.leftPt, b.leftPt) -
            Math.min(a.leftPt + a.widthPt, b.leftPt + b.widthPt)
          const down =
            Math.max(a.topPt, b.topPt) -
            Math.min(a.topPt + a.heightPt, b.topPt + b.heightPt)
          expect(Math.max(across, down)).toBeGreaterThanOrEqual(2 * sheet.bleedPt - 1e-6)
        }),
      )
    },
  )

  it('keeps a 6 mm gap between the A4 Small cards, exactly two bleeds', () => {
    const sheet = printFinalImmersiveSheet({
      piece: 'small',
      orientation: 'upright',
      paper: 'a4',
    })
    const [first, second] = sheet.cells
    expect(
      (second?.leftPt ?? 0) - ((first?.leftPt ?? 0) + (first?.widthPt ?? 0)),
    ).toBeCloseTo(mmPt(6), 6)
    expect(mmPt(6)).toBeCloseTo(2 * sheet.bleedPt, 6)
  })

  it('bleeds a tent on its left, right and bottom, and not at its fold', () => {
    const tent = printFinalSheetFaceBleed(
      printFinalImmersiveSheet({ piece: 'tent', orientation: 'wide', paper: 'letter' }),
    )
    expect(tent).toEqual({
      leftPt: inPt(1 / 8),
      rightPt: inPt(1 / 8),
      bottomPt: inPt(1 / 8),
      topPt: 0,
    })
  })

  it('bleeds a card on every edge, and Paper on none', () => {
    for (const piece of ['counter', 'small'] as const) {
      const sheet = printFinalImmersiveSheet({ piece, orientation: 'wide', paper: 'a4' })
      const bleed = printFinalSheetFaceBleed(sheet)
      expect(Object.values(bleed)).toEqual([mmPt(3), mmPt(3), mmPt(3), mmPt(3)])
    }
    const paper = printFinalSheetFaceBleed(
      printFinalPaperSheet({ piece: 'tent', orientation: 'wide', paper: 'a4' }),
    )
    expect(Object.values(paper)).toEqual([0, 0, 0, 0])
  })
})

describe('the trim keeps the Paper ink’s distances from the paper’s edges', () => {
  /** How far the cells' trims, then their colour, come to the paper's short and long edges. */
  function distancesIn(sheet: PrintFinalSheet, by: number) {
    const gaps = sheet.cells.map((cell) => ({
      x: Math.min(cell.leftPt - by, sheet.widthPt - (cell.leftPt + cell.widthPt + by)),
      y: Math.min(cell.topPt - by, sheet.heightPt - (cell.topPt + cell.heightPt + by)),
    }))
    const x = Math.min(...gaps.map((g) => g.x))
    const y = Math.min(...gaps.map((g) => g.y))
    return {
      shortIn: inches(sheet.landscape ? x : y),
      longIn: inches(sheet.landscape ? y : x),
    }
  }

  it.each(LAYOUTS)(
    '%s: trim 0.5 in from the short edges and 0.34 in from the long ones',
    (_, layout) => {
      const trim = distancesIn(sheetOf(layout), 0)
      expect(trim.shortIn).toBeGreaterThanOrEqual(0.5 - 1e-6)
      expect(trim.longIn).toBeGreaterThanOrEqual(0.34 - 1e-6)
    },
  )

  it.each(LAYOUTS)(
    '%s: the trim and the colour sit where the spec table says',
    (_, layout) => {
      const sheet = sheetOf(layout)
      const trim = distancesIn(sheet, 0)
      const colour = distancesIn(sheet, sheet.bleedPt)
      near(trim.shortIn, layout.stats.trimToShortIn, 0.006)
      near(trim.longIn, layout.stats.trimToLongIn, 0.006)
      near(colour.shortIn, layout.stats.colourToShortIn ?? NaN, 0.006)
      near(colour.longIn, layout.stats.colourToLongIn ?? NaN, 0.006)
    },
  )

  it('runs the A4 Small 9-up’s colour 0.47 in from the short edges, into the inkjet band', () => {
    const sheet = printFinalImmersiveSheet({
      piece: 'small',
      orientation: 'upright',
      paper: 'a4',
    })
    const { shortIn } = distancesIn(sheet, sheet.bleedPt)
    near(shortIn, 0.47, 0.006)
    expect(shortIn).toBeLessThan(0.5)
  })

  it('cuts each sheet 6 times, and the Small card sheets 12', () => {
    for (const key of KEYS) {
      const sheet = printFinalImmersiveSheet(key)
      const cuts = printFinalSheetCuts(sheet, sheet.cells)
      expect(cuts.xsPt.length + cuts.ysPt.length).toBe(key.piece === 'small' ? 12 : 6)
    }
  })
})

describe('the one table of office sheets', () => {
  it('hands each look its own sheet for the same piece, orientation and paper', () => {
    const key = { piece: 'counter', orientation: 'upright', paper: 'letter' } as const
    expect(printFinalSheet({ ...key, look: 'paper' })).toEqual(printFinalPaperSheet(key))
    expect(printFinalSheet({ ...key, look: 'immersive' })).toEqual(
      printFinalImmersiveSheet(key),
    )
    expect(printFinalSheet({ ...key, look: 'immersive' }).cells).toHaveLength(2)
    expect(printFinalSheet({ ...key, look: 'paper' }).cells).toHaveLength(3)
  })

  it('reads the region from the paper', () => {
    expect(printFinalRegionOf('letter')).toBe('us')
    expect(
      printFinalImmersiveSheet({ piece: 'counter', orientation: 'wide', paper: 'a4' })
        .bleedPt,
    ).toBeCloseTo(mmPt(3), 6)
  })
})
