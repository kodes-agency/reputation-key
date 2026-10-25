import { describe, expect, it } from 'vitest'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  printFinalRegionOf,
  type PrintFinalLook,
} from './portal-print-final'
import {
  printFinalBackCell,
  printFinalBackPlacement,
} from './portal-print-final-back-sheets'
import { printFinalHasBack } from './portal-print-final-back'
import { printFinalSheet } from './portal-print-final-immersive-sheets'
import { printFinalLiveArea } from './portal-print-final-measures'
import {
  printFinalCellPlacements,
  type PrintFinalSheetPlacement,
} from './portal-print-final-sheets'

// A card's back sits behind its front once the sheet is turned over like the page
// of a book: the cells are mirrored left to right, and a card that lies across
// its cell is turned the other way, so the back's top is the front's top edge.

const KEYS = PRINT_FINAL_PIECES.filter(printFinalHasBack).flatMap((piece) =>
  PRINT_FINAL_ORIENTATIONS.flatMap((orientation) =>
    (['paper', 'immersive'] as const).flatMap((look: PrintFinalLook) =>
      (['letter', 'a4'] as const).map((paper) => ({ piece, orientation, look, paper })),
    ),
  ),
)

const nameOf = (key: (typeof KEYS)[number]) =>
  `${key.look} ${key.piece} ${key.orientation} on ${key.paper}`

/** Where a point of a face, in the face's own frame, lands on the sheet it is placed on. */
function onSheet(
  placement: PrintFinalSheetPlacement,
  x: number,
  y: number,
): readonly [number, number] {
  const { leftPt, topPt, widthPt, heightPt } = placement
  switch (placement.turnDeg) {
    case -90:
      return [leftPt + y, topPt + heightPt - x]
    case 90:
      return [leftPt + widthPt - y, topPt + x]
    case 180:
      return [leftPt + widthPt - x, topPt + heightPt - y]
    case 0:
      return [leftPt + x, topPt + y]
  }
}

describe('the back of an office sheet', () => {
  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: every back lies behind its front, point for point, when the sheet is turned over',
    (_, key) => {
      const sheet = printFinalSheet(key)
      const face = { ...key, region: printFinalRegionOf(key.paper) }
      const { widthPt, heightPt } = printFinalLiveArea(face)
      for (const cell of sheet.cells) {
        const [front] = printFinalCellPlacements(sheet, cell)
        const back = printFinalBackPlacement(sheet, cell)
        if (front === undefined) throw new Error('a card cell holds a card')
        for (const [x, y] of [
          [0, 0],
          [widthPt, 0],
          [widthPt * 0.3, heightPt * 0.8],
          [widthPt, heightPt],
        ] as const) {
          const [frontX, frontY] = onSheet(front, x, y)
          // The same physical point of the card, seen from its reverse: mirrored across the card's own vertical axis.
          const [backX, backY] = onSheet(back, widthPt - x, y)
          expect(backX).toBeCloseTo(sheet.widthPt - frontX, 6)
          expect(backY).toBeCloseTo(frontY, 6)
        }
      }
    },
  )

  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: the mirrored cells stay on the page and mirror back to the front’s',
    (_, key) => {
      const sheet = printFinalSheet(key)
      for (const cell of sheet.cells) {
        const behind = printFinalBackCell(sheet, cell)
        expect(behind.leftPt).toBeGreaterThanOrEqual(-1e-6)
        expect(behind.leftPt + behind.widthPt).toBeLessThanOrEqual(sheet.widthPt + 1e-6)
        expect(behind.topPt).toBe(cell.topPt)
        expect(printFinalBackCell(sheet, behind).leftPt).toBeCloseTo(cell.leftPt, 6)
      }
    },
  )

  it('turns only the card that lies across the Letter Paper Counter sheet, and the other way', () => {
    const turned = KEYS.flatMap((key) => {
      const sheet = printFinalSheet(key)
      return sheet.cells
        .map((cell) => printFinalBackPlacement(sheet, cell).turnDeg)
        .filter((turn) => turn !== 0)
        .map(() => nameOf(key))
    })
    expect(turned).toEqual([
      'paper counter upright on letter',
      'paper counter wide on letter',
    ])
    const sheet = printFinalSheet({
      piece: 'counter',
      orientation: 'upright',
      look: 'paper',
      paper: 'letter',
    })
    expect(
      sheet.cells.map((cell) => printFinalBackPlacement(sheet, cell).turnDeg),
    ).toEqual([0, 0, 90])
    expect(
      sheet.cells.map((cell) => printFinalCellPlacements(sheet, cell)[0]?.turnDeg),
    ).toEqual([0, 0, -90])
  })

  it('has no back for a tent’s flat: its two faces print the front', () => {
    const sheet = printFinalSheet({
      piece: 'tent',
      orientation: 'wide',
      look: 'paper',
      paper: 'letter',
    })
    const [cell] = sheet.cells
    if (cell === undefined) throw new Error('a tent sheet has cells')
    expect(() => printFinalBackPlacement(sheet, cell)).toThrow(/no back to place/u)
  })
})
