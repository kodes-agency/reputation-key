import { describe, expect, it } from 'vitest'
import sheets from './__fixtures__/portal-print-final-immersive-sheets.json'
import { printFinalImmersiveSheet } from './portal-print-final-immersive-sheets'
import { PRINT_FINAL_MEASURES } from './portal-print-final-measures'
import { printFinalSheetMarks } from './portal-print-final-sheet-marks'
import {
  PRINT_FINAL_SHEET_NOTE,
  printFinalSheetNotes,
} from './portal-print-final-sheet-notes'
import type { PrintFinalSheet } from './portal-print-final-sheets'

// The printed note of the Immersive sheets (§10.1 and §10.2): its boxes and
// words against the generator's, and where it may sit: clear of every piece and
// its bleed, every crop mark and fold mark, 0.27 in from every edge and out of
// the 0.55 in at the paper's short edge.

type Layout = (typeof sheets.layouts)[number]

const sheetOf = (layout: Layout): PrintFinalSheet =>
  printFinalImmersiveSheet({
    piece: layout.piece as PrintFinalSheet['piece'],
    orientation: layout.orientation as PrintFinalSheet['orientation'],
    paper: layout.paper as PrintFinalSheet['paper'],
  })

const nameOf = (layout: Layout) =>
  `${layout.piece} ${layout.orientation} on ${layout.paper}`
const NAMED = sheets.layouts.map((layout) => [nameOf(layout), layout] as const)

const tileOf = (sheet: PrintFinalSheet) =>
  PRINT_FINAL_MEASURES[sheet.paper === 'letter' ? 'us' : 'eu'][sheet.piece].tilePt

const inches = (pt: number) => pt / 72

describe('the Immersive sheets’ notes', () => {
  it.each(NAMED)('%s: the boxes and the words are the generator’s', (_, layout) => {
    const sheet = sheetOf(layout)
    const notes = printFinalSheetNotes(sheet, tileOf(sheet))
    expect(notes).toHaveLength(layout.notes.length)
    layout.notes.forEach((expected, index) => {
      const note = notes[index]
      expect(inches(note?.leftPt ?? NaN)).toBeCloseTo(expected.x, 3)
      expect(inches(note?.topPt ?? NaN)).toBeCloseTo(expected.y, 3)
      expect(inches(note?.widthPt ?? NaN)).toBeCloseTo(expected.w, 3)
      expect(inches(note?.heightPt ?? NaN)).toBeCloseTo(expected.h, 3)
      expect(note?.text).toBe(expected.text)
    })
  })

  it('carries a note on every Immersive sheet but the Letter upright Small card sheet, which has no free paper', () => {
    const without = NAMED.filter(([, layout]) => {
      const sheet = sheetOf(layout)
      return printFinalSheetNotes(sheet, tileOf(sheet)).length === 0
    }).map(([name]) => name)
    expect(without).toEqual(['small upright on letter'])
  })

  it.each(NAMED)(
    '%s: stays 0.27 in from every edge and out of the 0.55 in at the short edge',
    (_, layout) => {
      const sheet = sheetOf(layout)
      const { edgePt, shortEdgeBandPt } = PRINT_FINAL_SHEET_NOTE
      for (const note of printFinalSheetNotes(sheet, tileOf(sheet))) {
        const left = note.leftPt
        const top = note.topPt
        const right = sheet.widthPt - (note.leftPt + note.widthPt)
        const bottom = sheet.heightPt - (note.topPt + note.heightPt)
        for (const gap of [left, top, right, bottom]) {
          expect(gap).toBeGreaterThanOrEqual(edgePt - 1e-6)
        }
        for (const gap of sheet.landscape ? [left, right] : [bottom]) {
          expect(gap).toBeGreaterThanOrEqual(shortEdgeBandPt - 1e-6)
        }
      }
    },
  )

  it.each(NAMED)(
    '%s: stays clear of every piece with its bleed and every mark, with any number of pieces',
    (_, layout) => {
      const sheet = sheetOf(layout)
      const notes = printFinalSheetNotes(sheet, tileOf(sheet))
      const slack = 0.02 * 72
      sheet.cells.forEach((_cell, index) => {
        const cells = sheet.cells.slice(0, index + 1)
        const marks = printFinalSheetMarks(sheet, cells)
        for (const note of notes) {
          const box = {
            left: note.leftPt,
            top: note.topPt,
            right: note.leftPt + note.widthPt,
            bottom: note.topPt + note.heightPt,
          }
          for (const cell of cells) {
            const by = sheet.bleedPt
            const onPiece =
              box.left < cell.leftPt + cell.widthPt + by &&
              box.right > cell.leftPt - by &&
              box.top < cell.topPt + cell.heightPt + by &&
              box.bottom > cell.topPt - by
            expect(onPiece).toBe(false)
          }
          for (const mark of marks) {
            const onMark =
              box.left < Math.max(mark.x0Pt, mark.x1Pt) + slack &&
              box.right > Math.min(mark.x0Pt, mark.x1Pt) - slack &&
              box.top < Math.max(mark.y0Pt, mark.y1Pt) + slack &&
              box.bottom > Math.min(mark.y0Pt, mark.y1Pt) - slack
            expect(onMark).toBe(false)
          }
        }
      })
    },
  )

  it.each(NAMED)('%s: names no failure the generator found', (_, layout) => {
    expect(layout.report.noteFailures).toEqual([])
    expect(layout.report.marksOnPieces).toBe(0)
  })
})

describe('the Immersive notes’ copy', () => {
  const textsOf = (
    piece: PrintFinalSheet['piece'],
    orientation: PrintFinalSheet['orientation'],
    paper: PrintFinalSheet['paper'],
    tilePt?: number,
  ) => {
    const sheet = printFinalImmersiveSheet({ piece, orientation, paper })
    return printFinalSheetNotes(sheet, tilePt ?? tileOf(sheet)).map((n) => n.text)
  }

  it('asks the Letter Counter card for Actual size and says the colour runs past each edge', () => {
    expect(textsOf('counter', 'upright', 'letter')).toEqual([
      'Print at Actual size (100%): each cream code square measures 1.5 in (3.8 cm). Cut on the crop marks: the colour runs 1/8 in past each edge, so a cut that wanders does not show white.',
    ])
    expect(textsOf('counter', 'wide', 'letter')[0]).toContain(
      'the colour runs 1/8 in past each edge.',
    )
  })

  it('says 3 mm on A4', () => {
    expect(textsOf('counter', 'upright', 'a4')[0]).toBe(
      'Print at Actual size (100%): each cream code square measures 38 mm. Cut on the crop marks: the colour runs 3 mm past each edge.',
    )
  })

  it('asks a tent to be scored with a ruler and a dry ballpoint, then folded on the dashed marks', () => {
    expect(textsOf('tent', 'wide', 'letter')[0]).toBe(
      'Print at Actual size (100%): each cream code square measures 1.4 in (3.6 cm). Cut on the crop marks. Score the fold with a ruler and a dry ballpoint, then fold on the dashed marks.',
    )
    expect(textsOf('tent', 'upright', 'letter')[0]).toContain(
      'Cut on the crop marks, score, fold on the dashed marks.',
    )
  })

  it('says the Small card’s bleed on Letter, and says it shorter on A4 where the gap holds one line', () => {
    expect(textsOf('small', 'wide', 'letter')[0]).toBe(
      'Print at Actual size (100%): each cream code square measures 1.25 in (3.2 cm). Cut on the crop marks; every card has its own 1/8 in bleed.',
    )
    expect(textsOf('small', 'upright', 'a4')).toEqual(['Actual size (100%): code 32 mm.'])
    expect(textsOf('small', 'wide', 'a4')).toEqual([
      'Actual size (100%): code square 32 mm. Cut on the crop marks.',
    ])
  })

  it('names the tile actually printed, such as the long address’s 2.1 in', () => {
    expect(textsOf('counter', 'upright', 'letter', 2.1 * 72)[0]).toContain(
      'measures 2.1 in (5.3 cm).',
    )
  })

  it('keeps the boxes where they are with fewer pieces on the sheet, which is clear of everything', () => {
    const sheet = printFinalImmersiveSheet({
      piece: 'small',
      orientation: 'wide',
      paper: 'letter',
    })
    const full = printFinalSheetNotes(sheet, tileOf(sheet))
    const part = printFinalSheetNotes(sheet, tileOf(sheet), sheet.cells.slice(0, 1))
    expect(part).toEqual(full)
  })
})
