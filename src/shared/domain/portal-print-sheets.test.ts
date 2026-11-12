import { describe, expect, it } from 'vitest'
import golden from './__fixtures__/portal-print-golden.json'
import sheets from './__fixtures__/portal-print-paper-sheets.json'
import {
  PRINT_ORIENTATIONS,
  PRINT_PIECES,
  printRegionOf,
  type PrintFace,
} from './portal-print'
import { PRINT_DISTANCES, inPt, mmPt, printLiveArea } from './portal-print-measures'
import { PRINT_PER_SHEET } from './portal-print-offer'
import {
  printCellPlacements,
  printPaperSheet,
  printSheetCuts,
  printSheetFills,
  type PrintSheet,
  type PrintSheetPlacement,
} from './portal-print-sheets'
import type { PrintKitPaper } from './portal-print-kit'

// The Paper office sheets against the design's generator
// (final-design-2026-10-25, `final-sheets.mjs`): the page, every cell and every
// cut, for a full sheet and for sheets only partly filled, to a thousandth of an
// inch; then the rules of §10.1 and §12 "Sheets" that the table must hold.

type Layout = (typeof sheets.layouts)[number]

const PAPERS: readonly PrintKitPaper[] = ['letter', 'a4']
const KEYS = PRINT_PIECES.flatMap((piece) =>
  PRINT_ORIENTATIONS.flatMap((orientation) =>
    PAPERS.map((paper) => ({ piece, orientation, paper })),
  ),
)
const nameOf = (key: { piece: string; orientation: string; paper: string }) =>
  `${key.piece} ${key.orientation} on ${key.paper}`

const inches = (pt: number) => pt / 72
const TOLERANCE_IN = 0.001
const near = (actual: number, expected: number, tolerance = TOLERANCE_IN) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)

const sheetOf = (layout: Layout) =>
  printPaperSheet({
    piece: layout.piece as PrintSheet['piece'],
    orientation: layout.orientation as PrintSheet['orientation'],
    paper: layout.paper as PrintKitPaper,
  })

describe('the Paper sheets against the generator', () => {
  it('covers every piece, orientation and paper', () => {
    expect(sheets.layouts).toHaveLength(12)
    expect(KEYS).toHaveLength(12)
  })

  it.each(sheets.layouts.map((layout) => [nameOf(layout), layout] as const))(
    '%s: the page and the cells are the generator’s',
    (_, layout) => {
      const sheet = sheetOf(layout)
      near(inches(sheet.widthPt), layout.width)
      near(inches(sheet.heightPt), layout.height)
      expect(sheet.landscape).toBe(layout.landscape)
      expect(sheet.kind === 'quarters' || sheet.kind === 'strips').toBe(layout.quarters)
      expect(sheet.kind === 'strips').toBe(layout.strips)
      expect(sheet.folds).toBe(layout.flat)
      expect(sheet.cells).toHaveLength(layout.cells.length)
      layout.cells.forEach((cell, index) => {
        const mine = sheet.cells[index]
        near(inches(mine?.leftPt ?? NaN), cell.x)
        near(inches(mine?.topPt ?? NaN), cell.y)
        near(inches(mine?.widthPt ?? NaN), cell.w)
        near(inches(mine?.heightPt ?? NaN), cell.h)
        expect(mine?.turned).toBe(cell.turned)
      })
    },
  )

  it.each(sheets.layouts.map((layout) => [nameOf(layout), layout] as const))(
    '%s: the cuts are the generator’s with every cell filled and with fewer',
    (_, layout) => {
      const sheet = sheetOf(layout)
      for (const filled of layout.filled) {
        const cuts = printSheetCuts(sheet, sheet.cells.slice(0, filled.n))
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
      expect(printPaperSheet(key).cells).toHaveLength(
        PRINT_PER_SHEET[key.piece].paper[key.paper],
      )
    },
  )

  it('turns the page with the piece: tents and Small cards print wide on portrait, the Counter card upright on portrait', () => {
    const landscape = (piece: 'counter' | 'tent' | 'small', o: 'upright' | 'wide') =>
      printPaperSheet({ piece, orientation: o, paper: 'letter' }).landscape
    expect([landscape('counter', 'upright'), landscape('counter', 'wide')]).toEqual([
      false,
      true,
    ])
    expect([landscape('tent', 'wide'), landscape('tent', 'upright')]).toEqual([
      false,
      true,
    ])
    expect([landscape('small', 'wide'), landscape('small', 'upright')]).toEqual([
      false,
      true,
    ])
  })

  it('never turns a piece in its cell except the Letter Counter sheet’s third card', () => {
    const turned = KEYS.flatMap((key) =>
      printPaperSheet(key).cells.flatMap((cell, index) =>
        cell.turned ? [`${nameOf(key)} #${index + 1}`] : [],
      ),
    )
    expect(turned).toEqual(['counter upright on letter #3', 'counter wide on letter #3'])
  })
})

describe('exact N: the sheets a count takes', () => {
  it('fills every cell but the last sheet’s spare ones', () => {
    expect(printSheetFills(4, 10)).toEqual([4, 4, 2])
    expect(printSheetFills(3, 3)).toEqual([3])
    expect(printSheetFills(10, 1)).toEqual([1])
  })

  it('fills the last sheet when the spares are asked for', () => {
    expect(printSheetFills(4, 12)).toEqual([4, 4, 4])
  })
})

describe('cuts (§10.2)', () => {
  const cutsOf = (
    piece: 'counter' | 'tent' | 'small',
    o: string,
    paper: PrintKitPaper,
  ) => {
    const sheet = printPaperSheet({
      piece,
      orientation: o === 'upright' ? 'upright' : 'wide',
      paper,
    })
    const cuts = printSheetCuts(sheet, sheet.cells)
    return cuts.xsPt.length + cuts.ysPt.length
  }

  it('cuts quarters twice and strips three times', () => {
    expect(cutsOf('tent', 'wide', 'letter')).toBe(2)
    expect(cutsOf('tent', 'wide', 'a4')).toBe(2)
    expect(cutsOf('counter', 'upright', 'a4')).toBe(2)
    expect(cutsOf('counter', 'wide', 'a4')).toBe(2)
    expect(cutsOf('tent', 'upright', 'letter')).toBe(3)
    expect(cutsOf('tent', 'upright', 'a4')).toBe(3)
  })

  it('cuts the Letter Counter and every Small card sheet nine times', () => {
    expect(cutsOf('counter', 'upright', 'letter')).toBe(9)
    expect(cutsOf('counter', 'wide', 'letter')).toBe(9)
    for (const o of ['upright', 'wide']) {
      expect(cutsOf('small', o, 'letter')).toBe(9)
      expect(cutsOf('small', o, 'a4')).toBe(9)
    }
  })
})

// ---------------------------------------------------------------------------
// The paper guard (§10.1): ink stays 0.5 in from the paper's short edges and
// 0.34 in from its long edges.

const turnedPoint = (
  placement: PrintSheetPlacement,
  x: number,
  y: number,
): readonly [number, number] => {
  if (placement.turnDeg === 180) {
    return [
      placement.leftPt + placement.widthPt - x,
      placement.topPt + placement.heightPt - y,
    ]
  }
  if (placement.turnDeg === -90) {
    return [placement.leftPt + y, placement.topPt + placement.heightPt - x]
  }
  return [placement.leftPt + x, placement.topPt + y]
}

/** How far a box, in the face's own frame, lies from the paper's short and long edges once the face is placed. */
function edgeDistancesIn(
  sheet: PrintSheet,
  placement: PrintSheetPlacement,
  box: Readonly<{ left: number; top: number; right: number; bottom: number }>,
) {
  const corners = [
    turnedPoint(placement, box.left, box.top),
    turnedPoint(placement, box.right, box.bottom),
  ]
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  const fromX = Math.min(Math.min(...xs), sheet.widthPt - Math.max(...xs))
  const fromY = Math.min(Math.min(...ys), sheet.heightPt - Math.max(...ys))
  return {
    shortIn: inches(sheet.landscape ? fromX : fromY),
    longIn: inches(sheet.landscape ? fromY : fromX),
  }
}

const faceOf = (sheet: PrintSheet): PrintFace => ({
  piece: sheet.piece,
  orientation: sheet.orientation,
  look: 'paper',
  region: printRegionOf(sheet.paper),
})

/** The closest any placed face's box comes to the paper's short edge and long edge. */
function closest(
  sheet: PrintSheet,
  boxOf: (
    area: ReturnType<typeof printLiveArea>,
  ) => Readonly<{ left: number; top: number; right: number; bottom: number }>,
) {
  const area = printLiveArea(faceOf(sheet))
  const distances = sheet.cells.flatMap((cell) =>
    printCellPlacements(sheet, cell).map((placement) =>
      edgeDistancesIn(sheet, placement, boxOf(area)),
    ),
  )
  return {
    shortIn: Math.min(...distances.map((d) => d.shortIn)),
    longIn: Math.min(...distances.map((d) => d.longIn)),
  }
}

describe('the paper guard', () => {
  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: the faces fill their cells exactly',
    (_, key) => {
      const sheet = printPaperSheet(key)
      const area = printLiveArea(faceOf(sheet))
      for (const cell of sheet.cells) {
        for (const placement of printCellPlacements(sheet, cell)) {
          const turned = placement.turnDeg === -90
          expect(placement.widthPt).toBeCloseTo(turned ? area.heightPt : area.widthPt, 1)
          expect(placement.heightPt).toBeCloseTo(turned ? area.widthPt : area.heightPt, 1)
        }
      }
    },
  )

  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: the live area keeps 0.5 in from the short edges and 0.34 in from the long ones',
    (_, key) => {
      const sheet = printPaperSheet(key)
      const { shortIn, longIn } = closest(sheet, (area) => ({
        left: area.live.leftPt,
        top: area.live.topPt,
        right: area.live.rightPt,
        bottom: area.live.bottomPt,
      }))
      expect(shortIn).toBeGreaterThanOrEqual(PRINT_DISTANCES.guardShortPt / 72 - 1e-6)
      expect(longIn).toBeGreaterThanOrEqual(PRINT_DISTANCES.guardLongPt / 72 - 1e-6)
    },
  )

  // The spec's table of ink to the short and the long edge, which the boards measured
  // from the stand-in set; the golden fixture holds that set's ink margins.
  const INK_IN: Readonly<Record<string, readonly [short: number, long: number]>> = {
    'counter upright on letter': [1.09, 1.04],
    'counter wide on letter': [0.82, 1.2],
    'counter upright on a4': [0.64, 0.86],
    'counter wide on a4': [0.52, 1.0],
    'tent wide on letter': [0.67, 0.34],
    'tent upright on letter': [0.55, 0.5],
    'tent wide on a4': [0.75, 0.34],
    'tent upright on a4': [0.64, 0.5],
    'small wide on letter': [0.71, 0.94],
    'small upright on letter': [0.83, 1.04],
    'small wide on a4': [0.8, 0.98],
    'small upright on a4': [0.92, 0.99],
  }

  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: the stand-in set’s ink lies where the spec table says',
    (name, key) => {
      const sheet = printPaperSheet(key)
      const region = printRegionOf(key.paper)
      const card = golden.cards.find(
        (c) =>
          c.look === 'paper' &&
          c.piece === key.piece &&
          c.orientation === key.orientation &&
          c.region === region &&
          (c.board === 'family' || c.board === 'europe'),
      )
      if (card === undefined) throw new Error(`no stand-in card for ${name}`)
      const mm = card.margins
      const { shortIn, longIn } = closest(sheet, (area) => ({
        left: mmPt(mm.L),
        top: mmPt(mm.T),
        right: area.widthPt - mmPt(mm.R),
        bottom: area.heightPt - mmPt(mm.B),
      }))
      const [short, long] = INK_IN[name] ?? [NaN, NaN]
      near(shortIn, short, 0.03)
      near(longIn, long, 0.03)
      expect(shortIn).toBeGreaterThanOrEqual(0.5 - 0.01)
      expect(longIn).toBeGreaterThanOrEqual(0.34 - 0.01)
    },
  )

  it('keeps the Paper A6 card’s ink 12.7 mm off the edges that meet the sheet’s edge', () => {
    const upright = printLiveArea({
      piece: 'counter',
      orientation: 'upright',
      look: 'paper',
      region: 'eu',
    })
    expect(upright.live.topPt).toBeGreaterThanOrEqual(mmPt(12.7) - 1e-6)
    expect(upright.heightPt - upright.live.bottomPt).toBeGreaterThanOrEqual(
      mmPt(12.7) - 1e-6,
    )
    expect(inPt(0.5)).toBeCloseTo(mmPt(12.7), 5)
  })
})
