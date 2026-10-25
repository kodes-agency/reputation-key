import { describe, expect, it } from 'vitest'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  type PrintFinalFace,
  type PrintFinalLook,
  type PrintFinalPiece,
  type PrintFinalRegion,
} from './portal-print-final'
import { inPt, mmPt, printFinalLiveArea } from './portal-print-final-measures'
import {
  printFinalHasShopFile,
  printFinalShopFaceBleed,
  printFinalShopPage,
} from './portal-print-final-shop'
import { printFinalTickRect } from './portal-print-final-sheet-marks'

// The print-shop file against the board (final-design-2026-10-25, board
// print-shop, `gen6.mjs`): the Counter card on Letter with its marks on is a
// 4.75 × 6.75 in page, the trim 0.375 in from every edge, and each of the eight
// marks starts 1/16 in beyond the 1/8 in bleed and runs 3/16 in, to the page's edge.

const inches = (pt: number) => pt / 72
const mm = (pt: number) => (pt / 72) * 25.4
const near = (actual: number, expected: number, tolerance = 0.001) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)

const face = (
  piece: PrintFinalPiece,
  orientation: PrintFinalFace['orientation'],
  region: PrintFinalRegion = 'us',
  look: PrintFinalLook = 'immersive',
): PrintFinalFace => ({ piece, orientation, look, region })

const CARDS = (['counter', 'small'] as const).flatMap((piece) =>
  PRINT_FINAL_ORIENTATIONS.flatMap((orientation) =>
    (['us', 'eu'] as const).flatMap((region) =>
      (['paper', 'immersive'] as const).map(
        (look) =>
          [
            `${look} ${piece} ${orientation} (${region})`,
            face(piece, orientation, region, look),
          ] as const,
      ),
    ),
  ),
)

describe('the print-shop page with its crop marks off', () => {
  it('is the bleed box: the Counter card’s 4.25 × 6.25 in, the trim 1/8 in in', () => {
    const page = printFinalShopPage({
      face: face('counter', 'upright'),
      cropMarks: false,
    })
    near(inches(page.widthPt), 4.25)
    near(inches(page.heightPt), 6.25)
    near(inches(page.trim.leftPt), 0.125)
    near(inches(page.trim.topPt), 0.125)
    near(inches(page.trim.widthPt), 4)
    near(inches(page.trim.heightPt), 6)
    expect(page.marks).toEqual([])
    expect(page.bleed).toEqual({
      leftPt: 0,
      topPt: 0,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
    })
  })

  it('keeps the 3 mm bleed on A6', () => {
    const page = printFinalShopPage({
      face: face('counter', 'upright', 'eu'),
      cropMarks: false,
    })
    near(mm(page.widthPt), 111, 0.01)
    near(mm(page.heightPt), 154, 0.01)
    near(mm(page.trim.leftPt), 3, 0.01)
  })
})

describe('the print-shop page with its crop marks on', () => {
  const page = printFinalShopPage({ face: face('counter', 'upright'), cropMarks: true })

  it('is the trim plus 0.375 in on each side: the board’s 4.75 × 6.75 in', () => {
    near(inches(page.widthPt), 4.75)
    near(inches(page.heightPt), 6.75)
    near(inches(page.trim.leftPt), 0.375)
    near(inches(page.trim.topPt), 0.375)
    near(inches(page.bleedPt), 0.125)
  })

  it('has the board’s eight marks, two at each corner of the trim', () => {
    expect(page.marks).toHaveLength(8)
    expect(page.marks.every((mark) => mark.kind === 'tick')).toBe(true)
    // Top-left: across, from the page's edge to 1/16 in beyond the bleed; and down.
    expect(page.marks.map((m) => [m.x0Pt, m.y0Pt, m.x1Pt, m.y1Pt].map(inches))).toEqual(
      expect.arrayContaining([
        [0, 0.375, 0.1875, 0.375],
        [0.375, 0, 0.375, 0.1875],
        [4.5625, 0.375, 4.75, 0.375],
        [4.375, 0, 4.375, 0.1875],
        [0, 6.375, 0.1875, 6.375],
        [0.375, 6.5625, 0.375, 6.75],
        [4.5625, 6.375, 4.75, 6.375],
        [4.375, 6.5625, 4.375, 6.75],
      ]),
    )
  })

  it('draws each mark at the weight of an office sheet’s ticks, so its rectangle straddles the trim line', () => {
    const rect = printFinalTickRect(page.marks[0]!)
    near(mm(rect.heightPt), 0.24, 0.001)
    near(inches(rect.leftPt), 0, 0.001)
  })
})

describe.each(CARDS)('%s', (_, shopFace) => {
  const { widthPt, heightPt } = printFinalLiveArea(shopFace)
  const on = printFinalShopPage({ face: shopFace, cropMarks: true })
  const off = printFinalShopPage({ face: shopFace, cropMarks: false })

  it('keeps the trim the piece’s own size, on both pages', () => {
    for (const page of [on, off]) {
      near(page.trim.widthPt, widthPt, 0.001)
      near(page.trim.heightPt, heightPt, 0.001)
      near(page.widthPt, widthPt + 2 * page.trim.leftPt, 0.001)
      near(page.heightPt, heightPt + 2 * page.trim.topPt, 0.001)
    }
  })

  it('has a bleed of 1/8 in on Letter and 3 mm on A4, the same on the page with and without marks', () => {
    const expected = shopFace.region === 'us' ? inPt(1 / 8) : mmPt(3)
    near(on.bleedPt, expected, 0.001)
    near(off.bleedPt, expected, 0.001)
    near(off.trim.leftPt, expected, 0.001)
  })

  it('puts every mark on a trim line, ending at the page’s edge and starting 1/16 in (1.5 mm) clear of the bleed box', () => {
    const gap = shopFace.region === 'us' ? inPt(1 / 16) : mmPt(1.5)
    const { trim, bleed } = on
    const trimXs = [trim.leftPt, trim.leftPt + trim.widthPt]
    const trimYs = [trim.topPt, trim.topPt + trim.heightPt]
    for (const mark of on.marks) {
      const horizontal = mark.y0Pt === mark.y1Pt
      const line = horizontal ? mark.y0Pt : mark.x0Pt
      expect(
        (horizontal ? trimYs : trimXs).some((edge) => Math.abs(edge - line) < 1e-6),
      ).toBe(true)
      const [from, to] = horizontal ? [mark.x0Pt, mark.x1Pt] : [mark.y0Pt, mark.y1Pt]
      const [bleedLow, bleedHigh] = horizontal
        ? [bleed.leftPt, bleed.leftPt + bleed.widthPt]
        : [bleed.topPt, bleed.topPt + bleed.heightPt]
      const pageEnd = horizontal ? on.widthPt : on.heightPt
      const atLow = from < 1e-6
      expect(atLow || Math.abs(to - pageEnd) < 1e-6).toBe(true)
      near(atLow ? bleedLow - to : from - bleedHigh, gap, 0.001)
    }
  })

  it('never lets a mark touch the bleed box', () => {
    const { bleed } = on
    for (const mark of on.marks) {
      const rect = printFinalTickRect(mark)
      const clear =
        rect.leftPt + rect.widthPt <= bleed.leftPt ||
        rect.leftPt >= bleed.leftPt + bleed.widthPt ||
        rect.topPt + rect.heightPt <= bleed.topPt ||
        rect.topPt >= bleed.topPt + bleed.heightPt
      expect(clear).toBe(true)
    }
  })

  it('is exactly the bleed on every side of the face’s art', () => {
    expect(printFinalShopFaceBleed(on)).toEqual({
      leftPt: on.bleedPt,
      topPt: on.bleedPt,
      rightPt: on.bleedPt,
      bottomPt: on.bleedPt,
    })
  })
})

describe('tents', () => {
  it('have no print-shop file: they stay office-only', () => {
    expect(PRINT_FINAL_PIECES.filter(printFinalHasShopFile)).toEqual(['counter', 'small'])
    expect(() =>
      printFinalShopPage({ face: face('tent', 'wide'), cropMarks: false }),
    ).toThrow(RangeError)
  })
})
