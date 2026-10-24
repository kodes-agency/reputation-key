// The round-3 sizes' sheets (spec-delta S6, round-2 R4) against the boards
// paper-table-letter-4up, imm-table-letter-4up and paper-mini-letter-10up:
// exact page sizes, cards on their shared cut lines, ink inside what an office
// printer prints, crop marks outside the bleed, and no card painting into its
// neighbour. Then what a download may ask for (`printKitFormatProblem`).

import { describe, expect, it } from 'vitest'
import { PRINT_KIT_PAPERS, type PrintKitPaper } from './portal-print-kit'
import {
  printKitFormatProblem,
  printKitSheetPages,
  type PrintKitFormatChoice,
} from './portal-print-kit-formats'
import { inToPt, mmToPt } from './portal-print-kit-measures'
import {
  immersiveLargeOfficePages,
  immersiveTableOfficePages,
} from './portal-print-kit-office-sheets'
import {
  barMeasureText,
  paperMiniPages,
  paperTablePages,
} from './portal-print-kit-size-sheets'
import {
  PANEL_SIZE_PT,
  PRINTER_BORDER_PT,
  printShopCardPages,
  type PrintKitPage,
  type PrintKitPagePanel,
  type SheetNote,
} from './portal-print-kit-sheets'

type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>

const LETTER = { widthPt: inToPt(8.5), heightPt: inToPt(11) }
const A4 = { widthPt: mmToPt(210), heightPt: mmToPt(297) }
const TABLE_TILE = inToPt(1.4)

/** The face's trim on the page; a turned face turns about its own centre. */
function trimOf(panel: PrintKitPagePanel): Box {
  const { widthPt, heightPt } = PANEL_SIZE_PT[panel.geometry]
  const cx = panel.leftPt + widthPt / 2
  const cy = panel.topPt + heightPt / 2
  const [w, h] = panel.turned ? [heightPt, widthPt] : [widthPt, heightPt]
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 }
}

/** The trim and its bleed, for an upright face. */
const bleedBoxOf = (panel: PrintKitPagePanel): Box => {
  const trim = trimOf(panel)
  return {
    left: trim.left - panel.bleed.leftPt,
    top: trim.top - panel.bleed.topPt,
    right: trim.right + panel.bleed.rightPt,
    bottom: trim.bottom + panel.bleed.bottomPt,
  }
}

const tickBoxes = (page: PrintKitPage): readonly Box[] =>
  page.ticks.map((tick) => ({
    left: tick.xPt,
    top: tick.yPt,
    right: tick.xPt + tick.widthPt,
    bottom: tick.yPt + tick.heightPt,
  }))

/** The box a note fills on the page: turned, it runs up from its bottom-left corner. */
function noteBox(note: SheetNote): Box {
  return note.turned
    ? {
        left: note.leftPt,
        top: note.topPt - note.widthPt,
        right: note.leftPt + note.heightPt,
        bottom: note.topPt,
      }
    : {
        left: note.leftPt,
        top: note.topPt,
        right: note.leftPt + note.widthPt,
        bottom: note.topPt + note.heightPt,
      }
}

const overlaps = (a: Box, b: Box) =>
  a.left < b.right - 1e-6 &&
  b.left < a.right - 1e-6 &&
  a.top < b.bottom - 1e-6 &&
  b.top < a.bottom - 1e-6

/** Every box at least 0.25 in from the page's edges. */
function expectInsideBorder(page: PrintKitPage, boxes: readonly Box[]): void {
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(PRINTER_BORDER_PT - 1e-6)
    expect(box.top).toBeGreaterThanOrEqual(PRINTER_BORDER_PT - 1e-6)
    expect(box.right).toBeLessThanOrEqual(page.widthPt - PRINTER_BORDER_PT + 1e-6)
    expect(box.bottom).toBeLessThanOrEqual(page.heightPt - PRINTER_BORDER_PT + 1e-6)
  }
}

const corners = (page: PrintKitPage) =>
  page.panels.map((panel) =>
    [panel.leftPt, panel.topPt].map((pt) => Number(pt.toFixed(3))),
  )

describe('Paper Table cards, 4 to a sheet', () => {
  it('prints Letter at 612 × 792 pt with 2 × 2 abutting 3.5 × 5 in cards in a 7 × 10 in block at (0.75, 0.5) in', () => {
    const [front] = paperTablePages(1, 'letter', TABLE_TILE)
    expect(front && [front.widthPt, front.heightPt]).toEqual([
      LETTER.widthPt,
      LETTER.heightPt,
    ])
    expect(front && corners(front)).toEqual([
      [54, 36],
      [306, 36],
      [54, 396],
      [306, 396],
    ])
    expect(front?.panels.every((panel) => panel.geometry === 'cardTableLetter')).toBe(
      true,
    )
    expect(front?.bleedPt).toBe(0)
  })

  it('prints A4 with 90 × 130 mm cards in a block at (15, 18.5) mm', () => {
    const [front] = paperTablePages(1, 'a4', mmToPt(36))
    expect(front && [front.widthPt, front.heightPt]).toEqual([A4.widthPt, A4.heightPt])
    expect(front?.panels[3] && trimOf(front.panels[3])).toMatchObject({
      right: expect.closeTo(mmToPt(195), 6),
      bottom: expect.closeTo(mmToPt(278.5), 6),
    })
  })

  it.each(PRINT_KIT_PAPERS)(
    'on %s, ticks every shared cut line in the margins, outside the cards and inside the printer’s border',
    (paper) => {
      const [front] = paperTablePages(1, paper, TABLE_TILE)
      if (front === undefined) throw new Error('no page')
      expect(front.marks).toBe('ticks')
      expect(front.ticks).toHaveLength(12)
      const trims = front.panels.map(trimOf)
      for (const tick of tickBoxes(front)) {
        for (const trim of trims) expect(overlaps(tick, trim)).toBe(false)
      }
      expectInsideBorder(front, [...tickBoxes(front), noteBox(front.note!)])
    },
  )

  it('notes the bar’s 1.4 in under the block, clear of the ticks', () => {
    const [front] = paperTablePages(1, 'letter', TABLE_TILE)
    expect(front?.note?.text).toBe(
      'Print at Actual size (100%). The bar under each code measures 1.4 in (3.6 cm). Cut on the ticks: 3 cuts down, 3 across.',
    )
    expect(front?.note?.topPt).toBeGreaterThan(inToPt(10.5))
    const note = noteBox(front!.note!)
    for (const tick of tickBoxes(front!)) expect(overlaps(note, tick)).toBe(false)
  })

  it('puts the backs on a second sheet, each row read right to left, with no ticks or note', () => {
    const [front, back] = paperTablePages(2, 'letter', TABLE_TILE)
    expect(back?.panels.every((panel) => panel.side === 'back')).toBe(true)
    expect(back && corners(back)).toEqual([
      [306, 36],
      [54, 36],
      [306, 396],
      [54, 396],
    ])
    expect(back?.ticks).toEqual([])
    expect(back?.note).toBeNull()
    expect(front?.panels.every((panel) => panel.side === 'front')).toBe(true)
  })
})

describe('Immersive Table cards, 4 to an office sheet', () => {
  it.each(PRINT_KIT_PAPERS)(
    'on %s, bleeds each card only on the block’s outer edges, so no card paints into its neighbour',
    (paper) => {
      const [page] = immersiveTableOfficePages(1, paper, TABLE_TILE)
      if (page === undefined) throw new Error('no page')
      const bleed = paper === 'letter' ? inToPt(0.125) : mmToPt(3)
      expect(page.panels.map((panel) => panel.bleed)).toEqual([
        { topPt: bleed, rightPt: 0, bottomPt: 0, leftPt: bleed },
        { topPt: bleed, rightPt: bleed, bottomPt: 0, leftPt: 0 },
        { topPt: 0, rightPt: 0, bottomPt: bleed, leftPt: bleed },
        { topPt: 0, rightPt: bleed, bottomPt: bleed, leftPt: 0 },
      ])
      const boxes = page.panels.map(bleedBoxOf)
      const trims = page.panels.map(trimOf)
      boxes.forEach((box, index) => {
        trims.forEach((trim, other) => {
          if (other !== index) expect(overlaps(box, trim)).toBe(false)
        })
      })
    },
  )

  it.each(PRINT_KIT_PAPERS)(
    'on %s, puts plain black crop marks outside the bleed and every mark, the note and the bleed inside the printer’s border',
    (paper) => {
      const [page] = immersiveTableOfficePages(1, paper, TABLE_TILE)
      if (page === undefined) throw new Error('no page')
      expect(page.marks).toBe('office-crop')
      expect(page.ticks).toHaveLength(12)
      const bleeds = page.panels.map(bleedBoxOf)
      const note = noteBox(page.note!)
      for (const mark of tickBoxes(page)) {
        for (const box of bleeds) expect(overlaps(mark, box)).toBe(false)
        expect(overlaps(mark, note)).toBe(false)
      }
      expectInsideBorder(page, [...tickBoxes(page), note, ...bleeds])
    },
  )

  it('ends the top and bottom marks 0.26 in from the Letter sheet’s edge, as the board does', () => {
    const [page] = immersiveTableOfficePages(1, 'letter', TABLE_TILE)
    const tops = tickBoxes(page!).map((box) => box.top)
    expect(Math.min(...tops)).toBeCloseTo(inToPt(0.26), 6)
  })

  it('makes the whole sheet the trim, with no bleed box for a print shop', () => {
    const [page] = immersiveTableOfficePages(1, 'letter', TABLE_TILE)
    expect(page?.bleedPt).toBe(0)
    expect(page?.trim).toEqual({ leftPt: 0, topPt: 0, ...LETTER })
  })

  it('prints the front on the top row and the back on the bottom row with a second language, on one sheet', () => {
    const pages = immersiveTableOfficePages(2, 'letter', TABLE_TILE)
    expect(pages).toHaveLength(1)
    expect(pages[0]?.panels.map((panel) => panel.side)).toEqual([
      'front',
      'front',
      'back',
      'back',
    ])
  })
})

describe('Paper Mini cards, 10 to a sheet', () => {
  it.each([
    ['letter', inToPt(0.75), inToPt(0.5), inToPt(3.5), inToPt(2)],
    ['a4', mmToPt(20), mmToPt(11), mmToPt(85), mmToPt(55)],
  ] as const)(
    'on %s, turns each portrait card a quarter, centred in its landscape cell of the business-card grid',
    (paper, left, top, cellWidth, cellHeight) => {
      const [page] = paperMiniPages(1, paper, inToPt(1.25))
      if (page === undefined) throw new Error('no page')
      expect(page.panels).toHaveLength(10)
      page.panels.forEach((panel, index) => {
        expect(panel.turned).toBe(true)
        const trim = trimOf(panel)
        expect(trim.left).toBeCloseTo(left + (index % 2) * cellWidth, 6)
        expect(trim.top).toBeCloseTo(top + Math.floor(index / 2) * cellHeight, 6)
        expect(trim.right - trim.left).toBeCloseTo(cellWidth, 6)
        expect(trim.bottom - trim.top).toBeCloseTo(cellHeight, 6)
      })
    },
  )

  it.each(PRINT_KIT_PAPERS)(
    'on %s, ticks 3 cuts down and 6 across outside the cells, the note and the ticks inside the printer’s border',
    (paper) => {
      const [page] = paperMiniPages(1, paper, inToPt(1.25))
      if (page === undefined) throw new Error('no page')
      expect(page.ticks).toHaveLength(18)
      const trims = page.panels.map(trimOf)
      const note = noteBox(page.note!)
      for (const tick of tickBoxes(page)) {
        for (const trim of trims) expect(overlaps(tick, trim)).toBe(false)
        expect(overlaps(tick, note)).toBe(false)
      }
      for (const trim of trims) expect(overlaps(note, trim)).toBe(false)
      expectInsideBorder(page, [...tickBoxes(page), note])
    },
  )

  it('names the business-card stock and the 1.25 in bar', () => {
    const [page] = paperMiniPages(1, 'letter', inToPt(1.25))
    expect(page?.note?.text).toBe(
      'Print at Actual size (100%), or on 3.5 × 2 in business-card stock. The bar under each code measures 1.25 in (3.2 cm).',
    )
  })
})

describe('the Immersive Large office sheet', () => {
  it('puts two 4 × 6 in cards on Letter landscape at (1.125, 1.25) and (5.875, 1.25) in, each with its own 1/8 in bleed', () => {
    const [page] = immersiveLargeOfficePages(1, 'letter', inToPt(1.75))
    expect(page && [page.widthPt, page.heightPt]).toEqual([inToPt(11), inToPt(8.5)])
    expect(page && corners(page)).toEqual([
      [81, 90],
      [423, 90],
    ])
    expect(page?.panels.map((panel) => panel.side)).toEqual(['front', 'front'])
    expect(page?.panels[0]?.bleed).toEqual({
      topPt: 9,
      rightPt: 9,
      bottomPt: 9,
      leftPt: 9,
    })
  })

  it.each(PRINT_KIT_PAPERS)(
    'on %s, keeps the two cards’ marks apart in the gap and outside both bleeds',
    (paper) => {
      const [page] = immersiveLargeOfficePages(2, paper, inToPt(1.75))
      if (page === undefined) throw new Error('no page')
      expect(page.panels.map((panel) => panel.side)).toEqual(['front', 'back'])
      const bleeds = page.panels.map(bleedBoxOf)
      expect(overlaps(bleeds[0]!, bleeds[1]!)).toBe(false)
      const marks = tickBoxes(page)
      expect(marks).toHaveLength(16)
      for (const mark of marks) {
        for (const box of bleeds) expect(overlaps(mark, box)).toBe(false)
      }
      for (let a = 0; a < marks.length; a += 1) {
        for (let b = a + 1; b < marks.length; b += 1) {
          expect(overlaps(marks[a]!, marks[b]!)).toBe(false)
        }
      }
      expectInsideBorder(page, [...marks, ...bleeds, noteBox(page.note!)])
    },
  )

  it('notes the bar of the tile the cards print on', () => {
    expect(immersiveLargeOfficePages(1, 'letter', inToPt(2))[0]?.note?.text).toContain(
      'The bar under each code measures 2 in (5.1 cm).',
    )
    expect(immersiveLargeOfficePages(1, 'a4', inToPt(1.75))[0]?.note?.text).toContain(
      'measures 44 mm (4.4 cm)',
    )
  })
})

describe('print-shop pages for Table and Mini', () => {
  it.each([
    ['table', 'letter', inToPt(4.25), inToPt(5.75)],
    ['table', 'a4', mmToPt(110), mmToPt(150)],
    ['mini', 'letter', inToPt(2.75), inToPt(4.25)],
    ['mini', 'a4', mmToPt(75), mmToPt(105)],
  ] as const)(
    'print one %s card per %s page of %f × %f pt, bleeding on every side',
    (size, paper, width, height) => {
      const [page] = printShopCardPages(size, 1, paper as PrintKitPaper)
      expect(page?.widthPt).toBeCloseTo(width, 6)
      expect(page?.heightPt).toBeCloseTo(height, 6)
      expect(page?.marks).toBe('crop')
      const bleed = paper === 'letter' ? inToPt(0.125) : mmToPt(3)
      expect(page?.panels[0]?.bleed).toEqual({
        topPt: bleed,
        rightPt: bleed,
        bottomPt: bleed,
        leftPt: bleed,
      })
    },
  )
})

describe('barMeasureText', () => {
  it('names a Letter tile in inches and an A4 tile in millimetres, both with centimetres', () => {
    expect(barMeasureText(inToPt(1.4), 'letter')).toBe('1.4 in (3.6 cm)')
    expect(barMeasureText(mmToPt(36), 'a4')).toBe('36 mm (3.6 cm)')
    expect(barMeasureText(inToPt(1.25), 'letter')).toBe('1.25 in (3.2 cm)')
  })
})

describe('printKitFormatProblem', () => {
  const card: PrintKitFormatChoice = {
    piece: 'counter_card',
    size: 'table',
    style: 'immersive',
    output: 'office',
    languageCount: 1,
  }

  it('offers every card in both outputs on Immersive and the office on Paper, but Mini on Immersive only for a print shop', () => {
    expect(printKitFormatProblem(card)).toBeNull()
    expect(printKitFormatProblem({ ...card, output: 'print_shop' })).toBeNull()
    expect(printKitFormatProblem({ ...card, size: 'large' })).toBeNull()
    expect(printKitFormatProblem({ ...card, style: 'paper' })).toBeNull()
    expect(
      printKitFormatProblem({ ...card, size: 'mini', output: 'print_shop' }),
    ).toBeNull()
    expect(printKitFormatProblem({ ...card, size: 'mini' })).toMatch(/print shop/u)
  })

  it('refuses a Paper print-shop file and a two-language Mini', () => {
    expect(
      printKitFormatProblem({ ...card, style: 'paper', output: 'print_shop' }),
    ).toMatch(/own printer/u)
    expect(
      printKitFormatProblem({ ...card, size: 'mini', style: 'paper', languageCount: 2 }),
    ).toBe('A Mini card prints one language. Choose one.')
  })

  it('keeps the old tent as it is, and prints the small tent the same two ways, in two languages too', () => {
    const tent = { ...card, piece: 'table_tent' as const, size: 'large' as const }
    expect(printKitFormatProblem({ ...tent, output: 'print_shop' })).toBeNull()
    expect(printKitFormatProblem({ ...tent, style: 'paper' })).toBeNull()
    expect(printKitFormatProblem(tent)).not.toBeNull()
    const small = { ...tent, size: 'table' as const, languageCount: 2 }
    expect(printKitFormatProblem({ ...small, output: 'print_shop' })).toBeNull()
    expect(printKitFormatProblem({ ...small, style: 'paper' })).toBeNull()
  })

  it('refuses an Immersive tent office sheet (not drawn), a Paper tent for a print shop and a Mini tent', () => {
    const small = { ...card, piece: 'table_tent' as const, size: 'table' as const }
    expect(printKitFormatProblem(small)).toMatch(/print shop in Immersive/u)
    expect(
      printKitFormatProblem({ ...small, style: 'paper', output: 'print_shop' }),
    ).toMatch(/own printer in Paper/u)
    expect(printKitFormatProblem({ ...small, size: 'mini', style: 'paper' })).toBe(
      'There is no Mini table tent. Choose a card.',
    )
  })

  it('gives no pages to a choice it refuses', () => {
    expect(() =>
      printKitSheetPages({
        ...card,
        size: 'mini',
        paper: 'letter',
        faceCount: 1,
        tilePt: 90,
      }),
    ).toThrow(/Not a printable choice/u)
    expect(
      printKitSheetPages({ ...card, paper: 'letter', faceCount: 1, tilePt: TABLE_TILE }),
    ).toHaveLength(1)
  })
})
