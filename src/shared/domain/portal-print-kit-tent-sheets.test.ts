// The small tent's pages against the tent-small-sheet board (round-3
// spec-delta S5): two 5 × 7 in flats on landscape Letter (130 × 180 mm on A4),
// each back face upside down above the shared fold, cut and fold ticks and the
// note inside what an office printer prints; and Immersive's one flat to a print
// shop's page, bleeding on every edge but the fold. Then the file name and the
// subject, and the print shop's slug.

import { describe, expect, it } from 'vitest'
import { PRINT_KIT_PAPERS, printKitFileName } from './portal-print-kit'
import { printKitSheetPages } from './portal-print-kit-formats'
import { printShopSlugLines } from './portal-print-kit-immersive'
import { inToPt, mmToPt } from './portal-print-kit-measures'
import { printKitSubject } from './portal-print-kit-pieces'
import { PANEL_SIZE_PT, PRINTER_BORDER_PT } from './portal-print-kit-sheets'
import {
  TENT_SMALL_BLOCK,
  paperSmallTentPage,
  printShopSmallTentPage,
} from './portal-print-kit-tent-sheets'

const TILE = inToPt(1.4)

describe('the Paper small tent sheet, as tent-small-sheet', () => {
  it('is Letter landscape with two flats at (0.5, 0.75) in, folding at 4.25 in', () => {
    const page = paperSmallTentPage('letter', TILE)
    expect([page.widthPt, page.heightPt]).toEqual([inToPt(11), inToPt(8.5)])
    expect(page.foldAtPt).toBeCloseTo(inToPt(4.25), 6)
    expect(page.bleedPt).toBe(0)
    expect(
      page.panels.map((panel) => [panel.side, panel.leftPt, panel.topPt, panel.rotated]),
    ).toEqual([
      ['back', inToPt(0.5), inToPt(0.75), true],
      ['front', inToPt(0.5), inToPt(4.25), false],
      ['back', inToPt(5.5), inToPt(0.75), true],
      ['front', inToPt(5.5), inToPt(4.25), false],
    ])
    for (const panel of page.panels) {
      expect(PANEL_SIZE_PT[panel.geometry]).toEqual({
        widthPt: inToPt(5),
        heightPt: inToPt(3.5),
      })
    }
  })

  it('lays A4 out the same way: 130 × 180 mm flats at margins of 18.5 × 15 mm, folding at 105 mm', () => {
    const page = paperSmallTentPage('a4', mmToPt(36))
    expect(page.widthPt).toBeCloseTo(mmToPt(297), 6)
    expect(page.heightPt).toBeCloseTo(mmToPt(210), 6)
    expect(page.foldAtPt).toBeCloseTo(mmToPt(105), 6)
    expect(page.panels[0]?.leftPt).toBeCloseTo(mmToPt(18.5), 6)
    expect(page.panels[0]?.topPt).toBeCloseTo(mmToPt(15), 6)
    expect(PANEL_SIZE_PT[page.panels[0]?.geometry ?? 'card4x6']).toEqual({
      widthPt: mmToPt(130),
      heightPt: mmToPt(90),
    })
  })

  it.each(PRINT_KIT_PAPERS)(
    'keeps every tick and the note on %s inside the printer’s border and off the flats',
    (paper) => {
      const page = paperSmallTentPage(paper, TILE)
      const block = TENT_SMALL_BLOCK[paper]
      const right = block.leftPt + 2 * block.cellWidthPt
      const bottom = block.topPt + block.cellHeightPt
      const marks = [
        ...page.ticks.map((tick) => ({ ...tick })),
        ...(page.note === null
          ? []
          : [
              {
                xPt: page.note.leftPt,
                yPt: page.note.topPt,
                widthPt: page.note.widthPt,
                heightPt: page.note.heightPt,
              },
            ]),
      ]
      for (const mark of marks) {
        expect(mark.xPt).toBeGreaterThanOrEqual(PRINTER_BORDER_PT - 1e-6)
        expect(mark.yPt).toBeGreaterThanOrEqual(PRINTER_BORDER_PT - 1e-6)
        expect(mark.xPt + mark.widthPt).toBeLessThanOrEqual(
          page.widthPt - PRINTER_BORDER_PT + 1e-6,
        )
        expect(mark.yPt + mark.heightPt).toBeLessThanOrEqual(
          page.heightPt - PRINTER_BORDER_PT + 1e-6,
        )
        const inside =
          mark.xPt > block.leftPt + 1 &&
          mark.xPt + mark.widthPt < right - 1 &&
          mark.yPt > block.topPt + 1 &&
          mark.yPt + mark.heightPt < bottom - 1
        expect(inside).toBe(false)
      }
    },
  )

  it('cuts down on three lines and across on two, and dashes the fold in both side margins', () => {
    const page = paperSmallTentPage('letter', TILE)
    const fold = page.foldAtPt ?? 0
    const onFold = page.ticks.filter(
      (tick) => Math.abs(tick.yPt + tick.heightPt / 2 - fold) < 0.01,
    )
    expect(onFold.length).toBeGreaterThanOrEqual(4)
    expect(onFold.every((tick) => tick.widthPt < 3)).toBe(true)
    expect(onFold.some((tick) => tick.xPt < inToPt(0.5))).toBe(true)
    expect(onFold.some((tick) => tick.xPt > inToPt(10.5))).toBe(true)
    const down = page.ticks.filter((tick) => tick.heightPt > tick.widthPt)
    expect(new Set(down.map((tick) => (tick.xPt + tick.widthPt / 2).toFixed(2)))).toEqual(
      new Set([inToPt(0.5), inToPt(5.5), inToPt(10.5)].map((x) => x.toFixed(2))),
    )
  })

  it('names the bar’s width in the note', () => {
    expect(paperSmallTentPage('letter', TILE).note?.text).toContain(
      'The bar under each code measures 1.4 in (3.6 cm).',
    )
    expect(paperSmallTentPage('a4', mmToPt(36)).note?.text).toContain('36 mm (3.6 cm)')
  })
})

describe('the Immersive small tent for a print shop', () => {
  it.each([
    ['letter', inToPt(5.75), inToPt(7.75), inToPt(0.125)],
    ['a4', mmToPt(150), mmToPt(200), mmToPt(3)],
  ] as const)(
    'prints one flat on %s with bleed on every edge but the fold',
    (paper, w, h, bleed) => {
      const page = printShopSmallTentPage(paper)
      expect(page.widthPt).toBeCloseTo(w, 6)
      expect(page.heightPt).toBeCloseTo(h, 6)
      expect(page.marks).toBe('crop')
      expect(page.bleedPt).toBeCloseTo(bleed, 6)
      expect(page.foldAtPt).toBeCloseTo(page.trim.topPt + page.trim.heightPt / 2, 6)
      expect(page.panels.map((panel) => [panel.side, panel.rotated])).toEqual([
        ['back', true],
        ['front', false],
      ])
      for (const panel of page.panels) {
        expect(panel.bleed).toEqual({
          topPt: 0,
          rightPt: bleed,
          bottomPt: bleed,
          leftPt: bleed,
        })
      }
    },
  )

  it('names the flat on the slug: trim, bleed, fold', () => {
    const lines = printShopSlugLines(
      'table_tent',
      'letter',
      { brand: 'Hotel Elegance', place: 'Reception', side: null },
      'table',
    )
    expect(lines.at(-1)).toBe(
      'table tent · trim 5 × 7 in · bleed 1/8 in · fold 3.5 in · score',
    )
  })
})

describe('the small tent’s pages, file name and subject', () => {
  it('prints on the pages its style picks', () => {
    const choice = {
      piece: 'table_tent',
      size: 'table',
      output: 'office',
      languageCount: 2,
      paper: 'letter',
      faceCount: 2,
      tilePt: TILE,
    } as const
    const [paper] = printKitSheetPages({ ...choice, style: 'paper' })
    expect(paper?.widthPt).toBeCloseTo(inToPt(11), 6)
    const [shop] = printKitSheetPages({
      ...choice,
      style: 'immersive',
      output: 'print_shop',
    })
    expect(shop?.marks).toBe('crop')
    expect(() => printKitSheetPages({ ...choice, style: 'immersive' })).toThrow(
      /Not a printable choice/u,
    )
  })

  it('says it holds 2 on a sheet, so a Paper sheet never shares a name with the Letter-half tent', () => {
    const format = { style: 'paper', paper: 'letter' } as const
    expect(
      printKitFileName('Reception', 'table_tent', ['en', 'es'], {
        ...format,
        size: 'table',
      }),
    ).toBe('reception-table-tent-en-es-2up-letter.pdf')
    expect(printKitFileName('Reception', 'table_tent', ['en', 'es'], format)).toBe(
      'reception-table-tent-en-es-letter.pdf',
    )
    expect(
      printKitFileName('Reception', 'table_tent', ['en'], {
        style: 'immersive',
        paper: 'a4',
        size: 'table',
      }),
    ).toBe('reception-table-tent-en-immersive-a4.pdf')
  })

  it('names the faces in an Immersive subject, the sheet in a Paper one', () => {
    expect(printKitSubject('immersive', 'table_tent', 'letter', 'table')).toBe(
      'Print kit: Immersive style, table tent, 5 × 3.5 in faces',
    )
    expect(printKitSubject('immersive', 'table_tent', 'a4', 'table')).toBe(
      'Print kit: Immersive style, table tent, 130 × 90 mm faces',
    )
    expect(printKitSubject('paper', 'table_tent', 'a4', 'table')).toBe(
      'Print kit: Paper style, table tent, A4',
    )
    expect(printKitSubject('immersive', 'table_tent', 'letter', 'large')).toBe(
      'Print kit: Immersive style, table tent, 4 × 6 in',
    )
  })
})
