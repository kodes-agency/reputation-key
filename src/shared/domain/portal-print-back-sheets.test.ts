import { describe, expect, it } from 'vitest'
import {
  PRINT_ORIENTATIONS,
  PRINT_PIECES,
  printRegionOf,
  type PrintLook,
} from './portal-print'
import { printBackCell, printBackPlacement } from './portal-print-back-sheets'
import { printHasBack } from './portal-print-back'
import { printSheet } from './portal-print-immersive-sheets'
import { printLiveArea } from './portal-print-measures'
import { printCellPlacements, type PrintSheetPlacement } from './portal-print-sheets'

// A card's back sits behind its front once the sheet is turned over like the page
// of a book: the cells are mirrored left to right, and a card that lies across
// its cell is turned the other way, so the back's top is the front's top edge.

const KEYS = PRINT_PIECES.filter(printHasBack).flatMap((piece) =>
  PRINT_ORIENTATIONS.flatMap((orientation) =>
    (['paper', 'immersive'] as const).flatMap((look: PrintLook) =>
      (['letter', 'a4'] as const).map((paper) => ({ piece, orientation, look, paper })),
    ),
  ),
)

const nameOf = (key: (typeof KEYS)[number]) =>
  `${key.look} ${key.piece} ${key.orientation} on ${key.paper}`

/** Where a point of a face, in the face's own frame, lands on the sheet it is placed on. */
function onSheet(
  placement: PrintSheetPlacement,
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
      const sheet = printSheet(key)
      const face = { ...key, region: printRegionOf(key.paper) }
      const { widthPt, heightPt } = printLiveArea(face)
      for (const cell of sheet.cells) {
        const [front] = printCellPlacements(sheet, cell)
        const back = printBackPlacement(sheet, cell)
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
      const sheet = printSheet(key)
      for (const cell of sheet.cells) {
        const behind = printBackCell(sheet, cell)
        expect(behind.leftPt).toBeGreaterThanOrEqual(-1e-6)
        expect(behind.leftPt + behind.widthPt).toBeLessThanOrEqual(sheet.widthPt + 1e-6)
        expect(behind.topPt).toBe(cell.topPt)
        expect(printBackCell(sheet, behind).leftPt).toBeCloseTo(cell.leftPt, 6)
      }
    },
  )

  it('turns only the card that lies across the Letter Paper Counter sheet, and the other way', () => {
    const turned = KEYS.flatMap((key) => {
      const sheet = printSheet(key)
      return sheet.cells
        .map((cell) => printBackPlacement(sheet, cell).turnDeg)
        .filter((turn) => turn !== 0)
        .map(() => nameOf(key))
    })
    expect(turned).toEqual([
      'paper counter upright on letter',
      'paper counter wide on letter',
    ])
    const sheet = printSheet({
      piece: 'counter',
      orientation: 'upright',
      look: 'paper',
      paper: 'letter',
    })
    expect(sheet.cells.map((cell) => printBackPlacement(sheet, cell).turnDeg)).toEqual([
      0, 0, 90,
    ])
    expect(
      sheet.cells.map((cell) => printCellPlacements(sheet, cell)[0]?.turnDeg),
    ).toEqual([0, 0, -90])
  })

  it('has no back for a tent’s flat: its two faces print the front', () => {
    const sheet = printSheet({
      piece: 'tent',
      orientation: 'wide',
      look: 'paper',
      paper: 'letter',
    })
    const [cell] = sheet.cells
    if (cell === undefined) throw new Error('a tent sheet has cells')
    expect(() => printBackPlacement(sheet, cell)).toThrow(/no back to place/u)
  })
})
