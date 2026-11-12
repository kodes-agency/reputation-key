import { describe, expect, it } from 'vitest'
import sheets from './__fixtures__/portal-print-paper-sheets.json'
import {
  PRINT_SHEET_NOTE,
  printSheetNotes,
  printTileLabel,
} from './portal-print-sheet-notes'
import { printSheetMarks } from './portal-print-sheet-marks'
import { inPt, mmPt, PRINT_MEASURES } from './portal-print-measures'
import { printPaperSheet, type PrintSheet } from './portal-print-sheets'

// The printed note of the Paper sheets (§10.1): its boxes against the generator's,
// and where it may sit: clear of every piece, tick and fold mark, 0.27 in from
// every edge and out of the 0.55 in at the paper's short edge.

type Layout = (typeof sheets.layouts)[number]

const sheetOf = (layout: Layout): PrintSheet =>
  printPaperSheet({
    piece: layout.piece as PrintSheet['piece'],
    orientation: layout.orientation as PrintSheet['orientation'],
    paper: layout.paper as PrintSheet['paper'],
  })

const nameOf = (sheet: PrintSheet) =>
  `${sheet.piece} ${sheet.orientation} on ${sheet.paper}`

const tileOf = (sheet: PrintSheet) =>
  PRINT_MEASURES[sheet.paper === 'letter' ? 'us' : 'eu'][sheet.piece].tilePt

const inches = (pt: number) => pt / 72

describe('the tile as the note names it', () => {
  it('says inches and centimetres on Letter', () => {
    expect(printTileLabel(inPt(1.5), 'us')).toBe('1.5 in (3.8 cm)')
    expect(printTileLabel(inPt(1.4), 'us')).toBe('1.4 in (3.6 cm)')
    expect(printTileLabel(inPt(1.25), 'us')).toBe('1.25 in (3.2 cm)')
  })

  it('names the long address’s 2.1 in tile and the ladder’s step-up', () => {
    expect(printTileLabel(inPt(2.1), 'us')).toBe('2.1 in (5.3 cm)')
    expect(printTileLabel(inPt(1.75), 'us')).toBe('1.75 in (4.4 cm)')
  })

  it('says millimetres on A4', () => {
    expect(printTileLabel(mmPt(38), 'eu')).toBe('38 mm')
    expect(printTileLabel(mmPt(36), 'eu')).toBe('36 mm')
    expect(printTileLabel(mmPt(32), 'eu')).toBe('32 mm')
  })
})

describe('the Paper sheets’ notes', () => {
  it.each(sheets.layouts.map((layout) => [nameOf(sheetOf(layout)), layout] as const))(
    '%s: the boxes are the generator’s',
    (_, layout) => {
      const sheet = sheetOf(layout)
      const notes = printSheetNotes(sheet, tileOf(sheet))
      expect(notes).toHaveLength(layout.notes.length)
      layout.notes.forEach((box, index) => {
        const note = notes[index]
        expect(inches(note?.leftPt ?? NaN)).toBeCloseTo(box.x, 3)
        expect(inches(note?.topPt ?? NaN)).toBeCloseTo(box.y, 3)
        expect(inches(note?.widthPt ?? NaN)).toBeCloseTo(box.w, 3)
        expect(inches(note?.heightPt ?? NaN)).toBeCloseTo(box.h, 3)
      })
    },
  )

  it.each(sheets.layouts.map((layout) => [nameOf(sheetOf(layout)), layout] as const))(
    '%s: carries a note only where cards are cut one by one',
    (_, layout) => {
      const sheet = sheetOf(layout)
      const notes = printSheetNotes(sheet, tileOf(sheet))
      expect(notes.length > 0).toBe(sheet.kind === 'cards')
    },
  )

  it.each(sheets.layouts.map((layout) => [nameOf(sheetOf(layout)), layout] as const))(
    '%s: stays 0.27 in from every edge and out of the 0.55 in at the short edge',
    (_, layout) => {
      const sheet = sheetOf(layout)
      const { edgePt, shortEdgeBandPt } = PRINT_SHEET_NOTE
      for (const note of printSheetNotes(sheet, tileOf(sheet))) {
        const left = note.leftPt
        const top = note.topPt
        const right = sheet.widthPt - (note.leftPt + note.widthPt)
        const bottom = sheet.heightPt - (note.topPt + note.heightPt)
        for (const gap of [left, top, right, bottom]) {
          expect(gap).toBeGreaterThanOrEqual(edgePt - 1e-6)
        }
        const shortEdgeGaps = sheet.landscape ? [left, right] : [bottom]
        for (const gap of shortEdgeGaps) {
          expect(gap).toBeGreaterThanOrEqual(shortEdgeBandPt - 1e-6)
        }
      }
    },
  )

  it.each(sheets.layouts.map((layout) => [nameOf(sheetOf(layout)), layout] as const))(
    '%s: stays clear of every piece and mark, with any number of pieces',
    (_, layout) => {
      const sheet = sheetOf(layout)
      const notes = printSheetNotes(sheet, tileOf(sheet))
      const slack = inPt(0.02)
      sheet.cells.forEach((_cell, index) => {
        const cells = sheet.cells.slice(0, index + 1)
        const marks = printSheetMarks(sheet, cells)
        for (const note of notes) {
          const box = {
            left: note.leftPt,
            top: note.topPt,
            right: note.leftPt + note.widthPt,
            bottom: note.topPt + note.heightPt,
          }
          for (const cell of cells) {
            const onPiece =
              box.left < cell.leftPt + cell.widthPt &&
              box.right > cell.leftPt &&
              box.top < cell.topPt + cell.heightPt &&
              box.bottom > cell.topPt
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
})

describe('the notes’ copy', () => {
  const textsOf = (
    piece: PrintSheet['piece'],
    orientation: PrintSheet['orientation'],
    paper: PrintSheet['paper'],
    tilePt?: number,
  ) => {
    const sheet = printPaperSheet({ piece, orientation, paper })
    return printSheetNotes(sheet, tilePt ?? tileOf(sheet)).map((n) => n.text)
  }

  it('asks the Letter Counter card for Actual size, and the lower strip cut off first', () => {
    expect(textsOf('counter', 'upright', 'letter')).toEqual([
      'Print at Actual size (100%): each cream code square measures 1.5 in (3.8 cm). Cut the lower strip off first, then each card on the grey ticks.',
    ])
  })

  it('cuts the right-hand strip off first when the Counter card is wide', () => {
    expect(textsOf('counter', 'wide', 'letter')[0]).toContain(
      'right-hand strip off first',
    )
  })

  it('names the tile actually printed, such as the long address’s 2.1 in', () => {
    expect(textsOf('counter', 'upright', 'letter', inPt(2.1))[0]).toContain(
      'measures 2.1 in (5.3 cm).',
    )
  })

  it('counts the Small card sheet’s cuts from its geometry: 3 lines down and 6 across when wide, the reverse upright', () => {
    expect(textsOf('small', 'wide', 'letter')[1]).toBe(
      'Cut on the grey ticks: 3 lines down, 6 across.',
    )
    expect(textsOf('small', 'upright', 'letter')[1]).toBe(
      'Cut on the grey ticks: 6 lines down, 3 across.',
    )
    expect(textsOf('small', 'wide', 'a4')[1]).toBe(
      'Cut on the grey ticks: 3 lines down, 6 across.',
    )
  })

  it('names the A4 tile in millimetres', () => {
    expect(textsOf('small', 'wide', 'a4')[0]).toContain('measures 32 mm.')
  })

  describe('on a last sheet with fewer pieces', () => {
    const notesFor = (
      piece: PrintSheet['piece'],
      orientation: PrintSheet['orientation'],
      pieces: number,
    ) => {
      const sheet = printPaperSheet({ piece, orientation, paper: 'letter' })
      return printSheetNotes(sheet, tileOf(sheet), sheet.cells.slice(0, pieces))
    }

    it('cuts no lower strip off when no card lies across it', () => {
      for (const pieces of [1, 2]) {
        expect(notesFor('counter', 'upright', pieces)[0]?.text).toBe(
          'Print at Actual size (100%): each cream code square measures 1.5 in (3.8 cm). Cut each card on the grey ticks.',
        )
      }
      expect(notesFor('counter', 'wide', 1)[0]?.text).not.toContain('strip')
    })

    it('still cuts the strip off first when the third card is there', () => {
      expect(notesFor('counter', 'upright', 3)[0]?.text).toContain(
        'Cut the lower strip off first',
      )
    })

    it('counts the cuts of the cards that are there', () => {
      expect(notesFor('small', 'wide', 10)[1]?.text).toBe(
        'Cut on the grey ticks: 3 lines down, 6 across.',
      )
      expect(notesFor('small', 'wide', 2)[1]?.text).toBe(
        'Cut on the grey ticks: 3 lines down, 2 across.',
      )
      expect(notesFor('small', 'upright', 1)[1]?.text).toBe(
        'Cut on the grey ticks: 2 lines down, 2 across.',
      )
    })

    it('keeps the boxes where they are', () => {
      const full = notesFor('small', 'wide', 10).map(({ text: _text, ...box }) => box)
      const part = notesFor('small', 'wide', 1).map(({ text: _text, ...box }) => box)
      expect(part).toEqual(full)
    })
  })
})
