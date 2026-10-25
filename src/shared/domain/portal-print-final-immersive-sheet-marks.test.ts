import { describe, expect, it } from 'vitest'
import sheets from './__fixtures__/portal-print-final-immersive-sheets.json'
import { printFinalImmersiveSheet } from './portal-print-final-immersive-sheets'
import { inPt, mmPt } from './portal-print-final-measures'
import {
  PRINT_FINAL_SHEET_MARKS,
  printFinalMarkColour,
  printFinalSheetMarks,
  printFinalTickRect,
  type PrintFinalSheetMark,
} from './portal-print-final-sheet-marks'
import {
  printFinalPaperSheet,
  type PrintFinalSheet,
  type PrintFinalSheetCell,
} from './portal-print-final-sheets'

// The black crop marks and the dashed fold marks of the Immersive sheets against
// the generator's (`final-sheets.mjs`, `marks` and `foldMarks`), then the rules
// the spec holds them to (§10.1): each starts 0.06 in beyond the bleed, ends stay
// 0.27 in from the sheet's edge, and none lands on a piece or its bleed.

type Layout = (typeof sheets.layouts)[number]

const inches = (pt: number) => pt / 72
const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.001)

const sheetOf = (layout: Layout): PrintFinalSheet =>
  printFinalImmersiveSheet({
    piece: layout.piece as PrintFinalSheet['piece'],
    orientation: layout.orientation as PrintFinalSheet['orientation'],
    paper: layout.paper as PrintFinalSheet['paper'],
  })

const nameOf = (sheet: Pick<PrintFinalSheet, 'piece' | 'orientation' | 'paper'>) =>
  `${sheet.piece} ${sheet.orientation} on ${sheet.paper}`
const SHEETS = sheets.layouts.map(sheetOf)
const NAMED = SHEETS.map((sheet) => [nameOf(sheet), sheet] as const)

const byPlace = (marks: readonly PrintFinalSheetMark[]) =>
  [...marks].sort(
    (a, b) => a.x0Pt - b.x0Pt || a.y0Pt - b.y0Pt || a.x1Pt - b.x1Pt || a.y1Pt - b.y1Pt,
  )
const rowsByPlace = (rows: readonly (readonly (number | string)[])[]) =>
  [...rows].sort(
    (a, b) =>
      Number(a[0]) - Number(b[0]) ||
      Number(a[1]) - Number(b[1]) ||
      Number(a[2]) - Number(b[2]) ||
      Number(a[3]) - Number(b[3]),
  )

const everyFill = (sheet: PrintFinalSheet) =>
  sheet.cells.map((_, index) => sheet.cells.slice(0, index + 1))

const boxOf = (cell: PrintFinalSheetCell, by = 0) => ({
  left: cell.leftPt - by,
  top: cell.topPt - by,
  right: cell.leftPt + cell.widthPt + by,
  bottom: cell.topPt + cell.heightPt + by,
})

describe('the Immersive sheets’ marks against the generator', () => {
  it.each(sheets.layouts.map((layout) => [nameOf(sheetOf(layout)), layout] as const))(
    '%s: crop marks and fold marks are the generator’s, full and part-filled',
    (_, layout) => {
      const sheet = sheetOf(layout)
      for (const filled of layout.filled) {
        const marks = printFinalSheetMarks(sheet, sheet.cells.slice(0, filled.n))
        const crops = byPlace(marks.filter((m) => m.kind !== 'fold'))
        const folds = byPlace(marks.filter((m) => m.kind === 'fold'))
        const expectedCrops = rowsByPlace(filled.marks)
        const expectedFolds = rowsByPlace(filled.folds)
        expect(crops).toHaveLength(expectedCrops.length)
        expect(folds).toHaveLength(expectedFolds.length)
        for (const [list, rows] of [
          [crops, expectedCrops],
          [folds, expectedFolds],
        ] as const) {
          rows.forEach((row, index) => {
            const mark = list[index]
            near(inches(mark?.x0Pt ?? NaN), Number(row[0]))
            near(inches(mark?.y0Pt ?? NaN), Number(row[1]))
            near(inches(mark?.x1Pt ?? NaN), Number(row[2]))
            near(inches(mark?.y1Pt ?? NaN), Number(row[3]))
          })
        }
      }
    },
  )

  it.each(sheets.layouts.map((layout) => [nameOf(sheetOf(layout)), layout] as const))(
    '%s: carries the generator’s count of marks, and no short tick on a line',
    (_, layout) => {
      const sheet = sheetOf(layout)
      const marks = printFinalSheetMarks(sheet, sheet.cells)
      expect(marks.filter((m) => m.kind === 'tick')).toHaveLength(layout.report.ticks)
      expect(marks.filter((m) => m.kind === 'fold')).toHaveLength(layout.report.folds)
      expect(marks.filter((m) => m.kind === 'through')).toHaveLength(0)
    },
  )
})

describe('the rules the crop marks keep (§10.1)', () => {
  const { edgePt, tickGapPt, tickLengthPt } = PRINT_FINAL_SHEET_MARKS

  it.each(NAMED)(
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

  it.each(NAMED)(
    '%s: no crop mark touches a piece or its bleed, with any number of pieces',
    (_, sheet) => {
      for (const cells of everyFill(sheet)) {
        const boxes = cells.map((cell) => boxOf(cell, sheet.bleedPt))
        for (const mark of printFinalSheetMarks(sheet, cells)) {
          if (mark.kind !== 'tick') continue
          const rect = printFinalTickRect(mark)
          const tick = {
            left: rect.leftPt,
            top: rect.topPt,
            right: rect.leftPt + rect.widthPt,
            bottom: rect.topPt + rect.heightPt,
          }
          const onAPiece = boxes.some(
            (box) =>
              tick.left < box.right &&
              tick.right > box.left &&
              tick.top < box.bottom &&
              tick.bottom > box.top,
          )
          expect(onAPiece).toBe(false)
        }
      }
    },
  )

  it.each(NAMED)(
    '%s: each crop mark starts 0.06 in beyond the bleed of the pieces it bounds, and is at most 0.3 in long',
    (_, sheet) => {
      const boxes = sheet.cells.map((cell) => boxOf(cell, sheet.bleedPt))
      for (const mark of printFinalSheetMarks(sheet, sheet.cells)) {
        const length = Math.hypot(mark.x1Pt - mark.x0Pt, mark.y1Pt - mark.y0Pt)
        expect(length).toBeLessThanOrEqual(tickLengthPt + 1e-6)
        if (mark.kind !== 'tick') continue
        const vertical = mark.x0Pt === mark.x1Pt
        // The nearest piece edge the mark points at, along the line.
        const nearest = Math.min(
          ...boxes.flatMap((box) =>
            vertical
              ? [Math.abs(mark.y1Pt - box.top), Math.abs(mark.y0Pt - box.bottom)]
              : [Math.abs(mark.x1Pt - box.left), Math.abs(mark.x0Pt - box.right)],
          ),
        )
        expect(nearest).toBeGreaterThanOrEqual(tickGapPt - 1e-6)
      }
    },
  )

  it('keeps each sheet’s marks the spec measured from the edge: 0.64 in (Letter Counter), 0.39 in (Letter tent, wide), 0.27 in (Small cards)', () => {
    const closest = (sheet: PrintFinalSheet) =>
      Math.min(
        ...printFinalSheetMarks(sheet, sheet.cells).map((mark) =>
          mark.x0Pt === mark.x1Pt
            ? Math.min(mark.y0Pt, sheet.heightPt - mark.y1Pt)
            : Math.min(mark.x0Pt, sheet.widthPt - mark.x1Pt),
        ),
      )
    const at = (
      piece: PrintFinalSheet['piece'],
      orientation: PrintFinalSheet['orientation'],
    ) =>
      inches(closest(printFinalImmersiveSheet({ piece, orientation, paper: 'letter' })))
    near(at('counter', 'upright'), 0.64)
    near(at('counter', 'wide'), 0.64)
    near(at('tent', 'wide'), 0.39)
    near(at('small', 'wide'), 0.27)
    near(at('small', 'upright'), 0.27)
  })

  it('draws crop marks black and Paper’s ticks grey, at the same weight', () => {
    expect(printFinalMarkColour('immersive')).toBe(
      PRINT_FINAL_SHEET_MARKS.immersiveColour,
    )
    expect(printFinalMarkColour('paper')).toBe('#9C968E')
    expect(PRINT_FINAL_SHEET_MARKS.tickWeightPt).toBeCloseTo(mmPt(0.24), 6)
  })

  it('leaves the Paper sheets’ marks as they were', () => {
    const paper = printFinalPaperSheet({
      piece: 'small',
      orientation: 'wide',
      paper: 'letter',
    })
    expect(paper.bleedPt).toBe(0)
    expect(printFinalSheetMarks(paper, paper.cells).length).toBeGreaterThan(0)
  })
})

describe('Immersive fold marks (§10.1)', () => {
  const tents = NAMED.filter(([, sheet]) => sheet.piece === 'tent')

  it.each(tents)(
    '%s: are on the fold line, 0.14 in long, outside the bleed and 0.06 in beyond it',
    (_, sheet) => {
      for (const cell of sheet.cells) {
        const marks = printFinalSheetMarks(sheet, [cell]).filter((m) => m.kind === 'fold')
        expect(marks).toHaveLength(2)
        const [left, right] = byPlace(marks)
        for (const mark of marks) {
          expect(mark.y0Pt).toBeCloseTo(cell.topPt + cell.heightPt / 2, 5)
          expect(mark.y1Pt).toBe(mark.y0Pt)
          expect(mark.x1Pt - mark.x0Pt).toBeCloseTo(inPt(0.14), 5)
        }
        expect(cell.leftPt - sheet.bleedPt - (left?.x1Pt ?? NaN)).toBeCloseTo(
          inPt(0.06),
          5,
        )
        expect(
          (right?.x0Pt ?? NaN) - (cell.leftPt + cell.widthPt + sheet.bleedPt),
        ).toBeCloseTo(inPt(0.06), 5)
      }
    },
  )

  it.each(NAMED.filter(([, sheet]) => sheet.piece !== 'tent'))(
    '%s: a card sheet carries no fold marks',
    (_, sheet) => {
      expect(
        printFinalSheetMarks(sheet, sheet.cells).some((m) => m.kind === 'fold'),
      ).toBe(false)
    },
  )
})
