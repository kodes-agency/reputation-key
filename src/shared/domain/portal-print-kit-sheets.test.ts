import { describe, expect, it } from 'vitest'
import { PRINT_KIT_PAPERS, PRINT_KIT_PIECES } from './portal-print-kit'
import {
  CARD_GRID,
  CODE_BLOCK,
  MARGIN,
  TENT_FACE_GRID,
  inToPt,
  mmToPt,
  ptToIn,
  ptToMm,
} from './portal-print-kit-measures'
import {
  PANEL_SIZE_PT,
  PRINTER_BORDER_PT,
  PRINT_CHECK,
  TICK,
  printKitPages,
  type PanelGeometry,
  type PrintKitPage,
  type PrintKitPagePanel,
} from './portal-print-kit-sheets'

type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>

/**
 * Where a Paper face may put ink, in its own coordinates: inside its side
 * margins, and inside its top and bottom margins (the fold clearance at the top
 * of a tent face, whose top edge is the fold; at its sheet edge the tile's
 * outline may come 0.35 mm closer, since the gaps balance the logo's transparent
 * edge against it).
 */
function inkBox(geometry: PanelGeometry): Box {
  const { widthPt, heightPt } = PANEL_SIZE_PT[geometry]
  if (geometry === 'tentFaceLetter' || geometry === 'tentFaceA5') {
    const grid = TENT_FACE_GRID[geometry === 'tentFaceLetter' ? 'letter' : 'a4']
    return {
      left: grid.sidePt,
      top: grid.foldClearancePt,
      right: widthPt - grid.sidePt,
      bottom: heightPt - (grid.foldClearancePt - MARGIN.optical.outlinePt),
    }
  }
  const grid = CARD_GRID.paper[geometry === 'card4x6' ? 'letter' : 'a4']
  return {
    left: grid.sidePt,
    top: grid.marginPt,
    right: widthPt - grid.sidePt,
    bottom: heightPt - grid.marginPt,
  }
}

/** The face's ink box on the page: a rotated face turns about its own centre. */
function onPage(panel: PrintKitPagePanel): Box {
  const { widthPt, heightPt } = PANEL_SIZE_PT[panel.geometry]
  const box = inkBox(panel.geometry)
  const turned = panel.rotated
    ? {
        left: widthPt - box.right,
        top: heightPt - box.bottom,
        right: widthPt - box.left,
        bottom: heightPt - box.top,
      }
    : box
  return {
    left: panel.leftPt + turned.left,
    top: panel.topPt + turned.top,
    right: panel.leftPt + turned.right,
    bottom: panel.topPt + turned.bottom,
  }
}

/** How close a box comes to the page's edges. */
const edgeClearance = (page: PrintKitPage, box: Box) =>
  Math.min(box.left, box.top, page.widthPt - box.right, page.heightPt - box.bottom)

const tickBox = (tick: PrintKitPage['ticks'][number]): Box => ({
  left: tick.xPt,
  top: tick.yPt,
  right: tick.xPt + tick.widthPt,
  bottom: tick.yPt + tick.heightPt,
})

const paperPages = PRINT_KIT_PIECES.flatMap((piece) =>
  PRINT_KIT_PAPERS.flatMap((paper) =>
    [1, 2].map((faces) => ({
      name: `${piece} on ${paper}, ${faces} face(s)`,
      pages: printKitPages(piece, faces, 'paper', paper),
    })),
  ),
)

describe('Paper sheet sizes', () => {
  it('prints Letter at exactly 612 × 792 pt and A4 at 595.28 × 841.89 pt', () => {
    for (const piece of PRINT_KIT_PIECES) {
      const [letter] = printKitPages(piece, 2, 'paper', 'letter')
      const [a4] = printKitPages(piece, 2, 'paper', 'a4')
      expect([letter?.widthPt, letter?.heightPt]).toEqual([612, 792])
      expect(a4?.widthPt).toBeCloseTo(595.28, 2)
      expect(a4?.heightPt).toBeCloseTo(841.89, 2)
    }
  })

  it('has no bleed and makes the trim the whole sheet', () => {
    for (const { pages } of paperPages) {
      for (const page of pages) {
        expect(page.bleedPt).toBe(0)
        expect(page.marks).toBe('ticks')
        expect(page.trim).toEqual({
          leftPt: 0,
          topPt: 0,
          widthPt: page.widthPt,
          heightPt: page.heightPt,
        })
      }
    }
  })
})

describe('the Letter card sheet', () => {
  const [fronts, backs] = printKitPages('counter_card', 2, 'paper', 'letter')

  it('puts two 4 × 6 in cards at the top, 0.25 in from each side', () => {
    expect(fronts?.panels.map((panel) => [panel.leftPt, panel.topPt])).toEqual([
      [18, 0],
      [306, 0],
    ])
    expect(fronts?.panels.every((panel) => panel.geometry === 'card4x6')).toBe(true)
    expect(PANEL_SIZE_PT.card4x6).toEqual({ widthPt: 288, heightPt: 432 })
  })

  it('draws three ticks under the cards on the down cuts, and none within the printer border', () => {
    const ticks = fronts?.ticks ?? []
    expect(ticks).toHaveLength(3)
    for (const tick of ticks) {
      expect(ptToIn(tick.yPt)).toBeCloseTo(6, 10)
      expect(ptToIn(tick.heightPt)).toBeCloseTo(0.3, 10)
      expect(tick.widthPt).toBeCloseTo(TICK.weightPt, 10)
    }
    // The outer ticks' outer edges are on their cut lines; the middle one is centred on its line.
    expect(ticks[0]?.xPt).toBe(inToPt(0.25))
    expect((ticks[1]?.xPt ?? 0) + TICK.weightPt / 2).toBeCloseTo(inToPt(4.25), 10)
    expect((ticks[2]?.xPt ?? 0) + TICK.weightPt).toBeCloseTo(inToPt(8.25), 10)
  })

  it('carries the print check on the fronts only, and a bar exactly as wide as the bar under each code', () => {
    expect(fronts?.printCheck).toBe(true)
    expect(PRINT_CHECK.bar.widthPt).toBe(CODE_BLOCK.tilePt)
    expect(ptToIn(PRINT_CHECK.topPt)).toBeCloseTo(6.7, 10)
    expect(backs?.printCheck).toBe(false)
  })

  it('puts the backs on page 2 with the columns swapped, and no ticks', () => {
    expect(backs?.panels.map((panel) => [panel.side, panel.leftPt])).toEqual([
      ['back', 306],
      ['back', 18],
    ])
    expect(backs?.ticks).toEqual([])
  })

  it('prints one sheet for a card in one language', () => {
    expect(printKitPages('counter_card', 1, 'paper', 'letter')).toHaveLength(1)
  })
})

describe('the A4 card sheet', () => {
  const [fronts] = printKitPages('counter_card', 2, 'paper', 'a4')

  it('puts four A6 cards at the exact quarters', () => {
    expect(
      fronts?.panels.map((panel) => [ptToMm(panel.leftPt), ptToMm(panel.topPt)]),
    ).toEqual([
      [0, expect.closeTo(0.5, 10)],
      [expect.closeTo(105, 10), expect.closeTo(0.5, 10)],
      [0, expect.closeTo(148.5, 10)],
      [expect.closeTo(105, 10), expect.closeTo(148.5, 10)],
    ])
    expect(fronts?.panels.every((panel) => panel.geometry === 'cardA6')).toBe(true)
  })

  it('has six ticks on the two cut lines, a cross at the centre among them', () => {
    expect(fronts?.ticks).toHaveLength(6)
    expect(fronts?.printCheck).toBe(false)
  })
})

describe('the Paper tent sheet', () => {
  it('folds Letter at 5.5 in and A4 at 148.5 mm, the back face upside down above the fold', () => {
    const [letter] = printKitPages('table_tent', 2, 'paper', 'letter')
    const [a4] = printKitPages('table_tent', 2, 'paper', 'a4')
    expect(ptToIn(letter?.foldAtPt ?? 0)).toBeCloseTo(5.5, 10)
    expect(ptToMm(a4?.foldAtPt ?? 0)).toBeCloseTo(148.5, 10)
    expect(
      letter?.panels.map((panel) => [panel.side, panel.rotated, panel.topPt]),
    ).toEqual([
      ['back', true, 0],
      ['front', false, 396],
    ])
  })

  it('marks the fold with two ticks at the sides only', () => {
    const [letter] = printKitPages('table_tent', 2, 'paper', 'letter')
    expect(letter?.ticks.map((tick) => ptToIn(tick.xPt))).toEqual([
      expect.closeTo(0.3, 10),
      expect.closeTo(8.05, 10),
    ])
    for (const tick of letter?.ticks ?? []) {
      expect(tick.yPt + tick.heightPt / 2).toBeCloseTo(inToPt(5.5), 10)
    }
  })
})

describe('Paper ink', () => {
  it('stays at least 0.25 in from every sheet edge', () => {
    for (const { name, pages } of paperPages) {
      for (const page of pages) {
        const boxes = [...page.panels.map(onPage), ...page.ticks.map(tickBox)]
        for (const box of boxes) {
          expect(edgeClearance(page, box), name).toBeGreaterThanOrEqual(
            PRINTER_BORDER_PT - 1e-9,
          )
        }
      }
    }
  })

  it('keeps the print check inside the strip that is cut away', () => {
    const left = PRINT_CHECK.centreXPt - PRINT_CHECK.widthPt / 2
    expect(left).toBeGreaterThanOrEqual(PRINTER_BORDER_PT)
    expect(PRINT_CHECK.topPt).toBeGreaterThan(inToPt(6.3))
  })

  it('stays at least 0.4 in from a fold', () => {
    for (const piece of PRINT_KIT_PIECES) {
      for (const paper of PRINT_KIT_PAPERS) {
        for (const page of printKitPages(piece, 2, 'paper', paper)) {
          if (page.foldAtPt === null) continue
          for (const box of page.panels.map(onPage)) {
            const fold = page.foldAtPt
            const clearance = box.bottom <= fold ? fold - box.bottom : box.top - fold
            expect(clearance).toBeGreaterThanOrEqual(inToPt(0.4))
          }
        }
      }
    }
  })
})

describe('Immersive pages', () => {
  it('print a 4 × 6 in card on a 4.75 × 6.75 in page and an A6 card on 125 × 168 mm', () => {
    const [letter] = printKitPages('counter_card', 1, 'immersive', 'letter')
    const [a4] = printKitPages('counter_card', 1, 'immersive', 'a4')
    expect([ptToIn(letter?.widthPt ?? 0), ptToIn(letter?.heightPt ?? 0)]).toEqual([
      4.75, 6.75,
    ])
    expect(ptToMm(a4?.widthPt ?? 0)).toBeCloseTo(125, 10)
    expect(ptToMm(a4?.heightPt ?? 0)).toBeCloseTo(168, 10)
    expect(letter?.bleedPt).toBe(9)
    expect(a4?.bleedPt).toBeCloseTo(mmToPt(3), 10)
    expect(letter?.marks).toBe('crop')
  })

  it('print the tent flat on a 4.75 × 12.75 in page, folded at 6 in on the trim', () => {
    const [letter] = printKitPages('table_tent', 2, 'immersive', 'letter')
    const [a4] = printKitPages('table_tent', 2, 'immersive', 'a4')
    expect([ptToIn(letter?.widthPt ?? 0), ptToIn(letter?.heightPt ?? 0)]).toEqual([
      4.75, 12.75,
    ])
    expect(ptToIn(letter?.foldAtPt ?? 0)).toBeCloseTo(6.375, 10)
    expect(ptToMm(a4?.heightPt ?? 0)).toBeCloseTo(316, 10)
  })
})
