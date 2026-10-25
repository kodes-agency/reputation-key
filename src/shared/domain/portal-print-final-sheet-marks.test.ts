import { describe, expect, it } from 'vitest'
import sheets from './__fixtures__/portal-print-final-paper-sheets.json'
import {
  PRINT_FINAL_SHEET_MARKS,
  printFinalSheetMarks,
  printFinalTickRect,
  type PrintFinalSheetMark,
} from './portal-print-final-sheet-marks'
import {
  printFinalPaperSheet,
  type PrintFinalSheet,
  type PrintFinalSheetCell,
} from './portal-print-final-sheets'
import { inPt, mmPt } from './portal-print-final-measures'

// The grey cut ticks and the dashed fold marks of the Paper sheets against the
// generator's (`final-sheets.mjs`, `marks` and `foldMarks`), then the rules the
// spec holds them to (§10.1): ends 0.27 in from the sheet's edge, never on a
// piece, and the Letter Counter sheet's named exception.

type Layout = (typeof sheets.layouts)[number]

const inches = (pt: number) => pt / 72
const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.001)

const sheetOf = (layout: Layout): PrintFinalSheet =>
  printFinalPaperSheet({
    piece: layout.piece as PrintFinalSheet['piece'],
    orientation: layout.orientation as PrintFinalSheet['orientation'],
    paper: layout.paper as PrintFinalSheet['paper'],
  })

const SHEETS = sheets.layouts.map(sheetOf)
const nameOf = (sheet: PrintFinalSheet) =>
  `${sheet.piece} ${sheet.orientation} on ${sheet.paper}`

const sortedByPlace = (marks: readonly PrintFinalSheetMark[]) =>
  [...marks].sort(
    (a, b) => a.x0Pt - b.x0Pt || a.y0Pt - b.y0Pt || a.x1Pt - b.x1Pt || a.y1Pt - b.y1Pt,
  )

const fixtureMarks = (rows: readonly (readonly (number | string)[])[]) =>
  [...rows].sort(
    (a, b) =>
      Number(a[0]) - Number(b[0]) ||
      Number(a[1]) - Number(b[1]) ||
      Number(a[2]) - Number(b[2]) ||
      Number(a[3]) - Number(b[3]),
  )

describe('the Paper sheets’ marks against the generator', () => {
  it.each(sheets.layouts.map((layout) => [nameOf(sheetOf(layout)), layout] as const))(
    '%s: ticks, through ticks and fold marks are the generator’s, full and part-filled',
    (_, layout) => {
      const sheet = sheetOf(layout)
      for (const filled of layout.filled) {
        const marks = printFinalSheetMarks(sheet, sheet.cells.slice(0, filled.n))
        const ticks = sortedByPlace(marks.filter((m) => m.kind !== 'fold'))
        const folds = sortedByPlace(marks.filter((m) => m.kind === 'fold'))
        const expectedTicks = fixtureMarks(filled.marks)
        const expectedFolds = fixtureMarks(filled.folds)
        expect(ticks).toHaveLength(expectedTicks.length)
        expect(folds).toHaveLength(expectedFolds.length)
        expectedTicks.forEach((row, index) => {
          const mark = ticks[index]
          near(inches(mark?.x0Pt ?? NaN), Number(row[0]))
          near(inches(mark?.y0Pt ?? NaN), Number(row[1]))
          near(inches(mark?.x1Pt ?? NaN), Number(row[2]))
          near(inches(mark?.y1Pt ?? NaN), Number(row[3]))
          expect(mark?.kind).toBe(row[4] === 'through' ? 'through' : 'tick')
        })
        expectedFolds.forEach((row, index) => {
          const mark = folds[index]
          near(inches(mark?.x0Pt ?? NaN), Number(row[0]))
          near(inches(mark?.y0Pt ?? NaN), Number(row[1]))
          near(inches(mark?.x1Pt ?? NaN), Number(row[2]))
          near(inches(mark?.y1Pt ?? NaN), Number(row[3]))
        })
      }
    },
  )
})

const everyFill = (sheet: PrintFinalSheet) =>
  sheet.cells.map((_, index) => sheet.cells.slice(0, index + 1))

const cellBox = (cell: PrintFinalSheetCell) => ({
  left: cell.leftPt,
  top: cell.topPt,
  right: cell.leftPt + cell.widthPt,
  bottom: cell.topPt + cell.heightPt,
})

const overlaps = (
  a: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  b: Readonly<{ left: number; top: number; right: number; bottom: number }>,
) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

describe('the rules the marks keep (§10.1)', () => {
  const { edgePt } = PRINT_FINAL_SHEET_MARKS

  it.each(SHEETS.map((sheet) => [nameOf(sheet), sheet] as const))(
    '%s: every mark’s ends stay 0.27 in from the sheet’s edge, with any number of pieces',
    (_, sheet) => {
      for (const cells of everyFill(sheet)) {
        for (const mark of printFinalSheetMarks(sheet, cells)) {
          const vertical = mark.x0Pt === mark.x1Pt
          const ends = vertical
            ? [mark.y0Pt, sheet.heightPt - mark.y1Pt]
            : [mark.x0Pt, sheet.widthPt - mark.x1Pt]
          expect(Math.min(...ends)).toBeGreaterThanOrEqual(edgePt - 1e-6)
        }
      }
    },
  )

  it.each(SHEETS.map((sheet) => [nameOf(sheet), sheet] as const))(
    '%s: no tick touches a piece, with any number of pieces',
    (_, sheet) => {
      for (const cells of everyFill(sheet)) {
        const boxes = cells.map(cellBox)
        for (const mark of printFinalSheetMarks(sheet, cells)) {
          if (mark.kind !== 'tick') continue
          const rect = printFinalTickRect(mark)
          const tick = {
            left: rect.leftPt,
            top: rect.topPt,
            right: rect.leftPt + rect.widthPt,
            bottom: rect.topPt + rect.heightPt,
          }
          expect(boxes.some((box) => overlaps(tick, box))).toBe(false)
        }
      }
    },
  )

  it('keeps the through ticks to the Letter Counter sheet: 4 upright, 2 wide', () => {
    const throughs = SHEETS.map((sheet) => ({
      name: nameOf(sheet),
      count: printFinalSheetMarks(sheet, sheet.cells).filter((m) => m.kind === 'through')
        .length,
    })).filter((entry) => entry.count > 0)
    expect(throughs).toEqual([
      { name: 'counter upright on letter', count: 4 },
      { name: 'counter wide on letter', count: 2 },
    ])
  })

  it('lays each through tick on its own cut line, in the 0.27 to 0.47 in band', () => {
    for (const orientation of ['upright', 'wide'] as const) {
      const sheet = printFinalPaperSheet({
        piece: 'counter',
        orientation,
        paper: 'letter',
      })
      const throughs = printFinalSheetMarks(sheet, sheet.cells).filter(
        (m) => m.kind === 'through',
      )
      for (const mark of throughs) {
        const length = Math.hypot(mark.x1Pt - mark.x0Pt, mark.y1Pt - mark.y0Pt)
        expect(length).toBeCloseTo(PRINT_FINAL_SHEET_MARKS.throughLengthPt, 5)
        const vertical = mark.x0Pt === mark.x1Pt
        const nearEdge = vertical
          ? Math.min(mark.y0Pt, sheet.heightPt - mark.y1Pt)
          : Math.min(mark.x0Pt, sheet.widthPt - mark.x1Pt)
        expect(inches(nearEdge)).toBeGreaterThanOrEqual(0.27 - 1e-6)
        expect(inches(nearEdge)).toBeLessThanOrEqual(0.27 + 1e-6)
      }
    }
  })

  it.each(SHEETS.map((sheet) => [nameOf(sheet), sheet] as const))(
    '%s: carries ticks only when its cells are cut one by one, and folds only on a tent',
    (_, sheet) => {
      const marks = printFinalSheetMarks(sheet, sheet.cells)
      const ticks = marks.filter((m) => m.kind !== 'fold')
      const folds = marks.filter((m) => m.kind === 'fold')
      expect(ticks.length > 0).toBe(sheet.kind === 'cards')
      expect(folds).toHaveLength(sheet.folds ? 2 * sheet.cells.length : 0)
    },
  )
})

describe('fold marks (§10.1)', () => {
  const tents = SHEETS.filter((sheet) => sheet.piece === 'tent')

  it.each(tents.map((sheet) => [nameOf(sheet), sheet] as const))(
    '%s: are dashed, on the fold line, 0.18 in long, starting 0.29 in or more from the edge',
    (_, sheet) => {
      for (const cell of sheet.cells) {
        const marks = printFinalSheetMarks(sheet, [cell]).filter((m) => m.kind === 'fold')
        expect(marks).toHaveLength(2)
        for (const mark of marks) {
          expect(mark.y0Pt).toBeCloseTo(cell.topPt + cell.heightPt / 2, 5)
          expect(mark.y1Pt).toBe(mark.y0Pt)
          expect(mark.x1Pt - mark.x0Pt).toBeCloseTo(inPt(0.18), 5)
          expect(mark.x0Pt).toBeGreaterThanOrEqual(cell.leftPt)
          expect(mark.x1Pt).toBeLessThanOrEqual(cell.leftPt + cell.widthPt)
          expect(Math.min(mark.x0Pt, sheet.widthPt - mark.x1Pt)).toBeGreaterThanOrEqual(
            inPt(0.29) - 1e-6,
          )
        }
      }
    },
  )

  it('draws the marks as the spec’s weights: ticks 0.24 mm, fold marks 0.25 mm', () => {
    expect(PRINT_FINAL_SHEET_MARKS.tickWeightPt).toBeCloseTo(mmPt(0.24), 6)
    expect(PRINT_FINAL_SHEET_MARKS.foldWeightPt).toBeCloseTo(mmPt(0.25), 6)
    expect(PRINT_FINAL_SHEET_MARKS.colour).toBe('#9C968E')
  })

  it('draws a tick as its centre line widened by the weight', () => {
    const rect = printFinalTickRect({
      kind: 'tick',
      x0Pt: 100,
      y0Pt: 20,
      x1Pt: 100,
      y1Pt: 40,
    })
    expect(rect.heightPt).toBe(20)
    expect(rect.widthPt).toBeCloseTo(PRINT_FINAL_SHEET_MARKS.tickWeightPt, 9)
    expect(rect.leftPt + rect.widthPt / 2).toBeCloseTo(100, 9)
  })
})
