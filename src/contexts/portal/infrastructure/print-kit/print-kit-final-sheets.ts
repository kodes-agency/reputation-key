// The final office sheets in the PDF (final design spec §10.1 and §10.2): each
// page is the paper, turned to landscape where the piece turns it, with the
// pieces drawn in their cells from the geometry the Share tab's preview reads
// (`portal-print-final-sheets.ts`, `portal-print-final-immersive-sheets.ts`): a
// card upright in its cell, or a quarter turn across it; a tent flat with the
// back face upside down above the fold. Then the sheet's own marks (Paper's grey
// ticks, Immersive's black crop marks, and the dashed fold marks), and the
// printed note where there is free paper for one.
//
// Every face is the same face, laid out once and drawn wherever the sheet puts
// it, clipped to its trim (an Immersive piece's to its trim and bleed) so
// nothing of one card prints on its neighbour. Only the pieces asked for are
// drawn (exact N); the cells past them stay blank, unless the last sheet is
// filled with spares, and their marks are left out.
//
// A sheet with no note has no free paper to say "print at Actual size", so its
// PDF asks the print dialog for it instead: `PrintScaling /None`.

import { printFinalBackPlacement } from '#/shared/domain/portal-print-final-back-sheets'
import type { PrintFinalBleed } from '#/shared/domain/portal-print-final-layers'
import {
  PRINT_FINAL_SHEET_MARKS,
  printFinalMarkColour,
  printFinalSheetMarks,
  printFinalTickRect,
  type PrintFinalSheetMark,
} from '#/shared/domain/portal-print-final-sheet-marks'
import {
  PRINT_FINAL_SHEET_NOTE,
  printFinalSheetNotes,
  type PrintFinalSheetNote,
} from '#/shared/domain/portal-print-final-sheet-notes'
import {
  printFinalCellPlacements,
  printFinalSheetFills,
  type PrintFinalSheet,
  type PrintFinalSheetCell,
  type PrintFinalSheetPlacement,
} from '#/shared/domain/portal-print-final-sheets'
import { fillWords } from '#/shared/domain/portal-print-kit-text'
import type { FinalPreparedBack } from './print-kit-final-back'
import type { FinalPreparedFace } from './print-kit-final-immersive'
import {
  drawLine,
  measureLine,
  type PdfTextStyle,
  type PrintKitFonts,
} from './print-kit-pdf-text'

export type FinalSheetsInput = Readonly<{
  sheet: PrintFinalSheet
  /** The face every cell holds, laid out once. */
  face: FinalPreparedFace
  /** The back every cell of the sheet behind holds; each sheet is followed by its back. Cards only. */
  back?: FinalPreparedBack
  /** The code's cream square as printed: the note names its size. */
  tilePt: number
  /** How many pieces to print: the quantity, or every cell of the last sheet when it is filled with spares. */
  pieceCount: number
  /** How many pieces each sheet carries, from its first cell: the manager may ask for fewer than fit. Absent: every cell. */
  perSheet?: number
}>

/** What a cell holds, front or back: its trim, how far its art runs past it, and how to draw it. */
type Drawable = Readonly<{
  layout: Readonly<{ plan: Readonly<{ widthPt: number; heightPt: number }> }>
  bleed: PrintFinalBleed
  draw: () => void
}>

/** A face drawn in its place: turned as the placement says, and clipped to its trim and bleed. */
function drawPlaced(
  doc: PDFKit.PDFDocument,
  face: Drawable,
  placement: PrintFinalSheetPlacement,
): void {
  const { leftPt, topPt, widthPt, heightPt, turnDeg } = placement
  const { bleed } = face
  const { widthPt: trimWidth, heightPt: trimHeight } = face.layout.plan
  doc.save()
  if (turnDeg === -90) {
    // Turned a quarter counter-clockwise, its top edge becomes the cell's left.
    doc.translate(leftPt, topPt + heightPt).rotate(-90)
  } else if (turnDeg === 90) {
    // Turned a quarter clockwise, its top edge becomes the cell's right: a back across its cell.
    doc.translate(leftPt + widthPt, topPt).rotate(90)
  } else if (turnDeg === 180) {
    doc.translate(leftPt, topPt).rotate(180, { origin: [widthPt / 2, heightPt / 2] })
  } else {
    doc.translate(leftPt, topPt)
  }
  doc
    .rect(
      0 - bleed.leftPt,
      0 - bleed.topPt,
      trimWidth + bleed.leftPt + bleed.rightPt,
      trimHeight + bleed.topPt + bleed.bottomPt,
    )
    .clip()
  face.draw()
  doc.restore()
}

/** The ticks as filled rectangles, so their weight is exact at any zoom; the fold marks dashed. */
function drawMarks(
  doc: PDFKit.PDFDocument,
  colour: string,
  marks: readonly PrintFinalSheetMark[],
): void {
  const { foldWeightPt, foldDashPt } = PRINT_FINAL_SHEET_MARKS
  const ticks = marks.filter((mark) => mark.kind !== 'fold')
  const folds = marks.filter((mark) => mark.kind === 'fold')
  if (ticks.length > 0) {
    doc.save()
    for (const tick of ticks) {
      const rect = printFinalTickRect(tick)
      doc.rect(rect.leftPt, rect.topPt, rect.widthPt, rect.heightPt)
    }
    doc.fill(colour)
    doc.restore()
  }
  if (folds.length > 0) {
    doc.save().lineWidth(foldWeightPt).strokeColor(colour)
    doc.dash(foldDashPt, { space: foldDashPt })
    for (const fold of folds)
      doc.moveTo(fold.x0Pt, fold.y0Pt).lineTo(fold.x1Pt, fold.y1Pt)
    doc.stroke()
    doc.undash().restore()
  }
}

const NOTE_FLOOR_PT = 5
const NOTE_SHRINK_PT = 0.25

/**
 * A note's lines at the spec's 6.5 pt; only if they would overflow the box (a
 * code tile whose name runs longer than any the boards measured) a quarter point
 * smaller at a time, to a 5 pt floor.
 */
export function setFinalSheetNote(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  note: PrintFinalSheetNote,
) {
  const { sizePt, leading } = PRINT_FINAL_SHEET_NOTE
  const styleAt = (size: number): PdfTextStyle => ({
    face: 'body',
    size,
    spacing: 0,
    colour: PRINT_FINAL_SHEET_NOTE.colour,
    opacity: 1,
  })
  const setAt = (size: number) => ({
    size,
    lines: fillWords(note.text, note.widthPt, (line) =>
      measureLine(doc, fonts, line, styleAt(size)),
    ),
    style: styleAt(size),
  })
  let set = setAt(sizePt)
  while (
    set.lines.length * set.size * leading > note.heightPt &&
    set.size > NOTE_FLOOR_PT
  ) {
    set = setAt(Math.max(NOTE_FLOOR_PT, set.size - NOTE_SHRINK_PT))
  }
  return set
}

function drawNote(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  note: PrintFinalSheetNote,
): void {
  const { size, lines, style } = setFinalSheetNote(doc, fonts, note)
  const pitch = size * PRINT_FINAL_SHEET_NOTE.leading
  lines.forEach((line, index) => {
    drawLine(doc, fonts, line, style, {
      x: note.leftPt,
      middleY: note.topPt + (index + 0.5) * pitch,
    })
  })
}

/**
 * Opens the print dialog at Actual size: the catalogue's viewer preferences ask
 * for no scaling. PDFKit writes the dictionary when the document ends.
 */
function askForActualSize(doc: PDFKit.PDFDocument): void {
  const catalogue = (doc as unknown as { _root: { data: Record<string, unknown> } })._root
  catalogue.data.ViewerPreferences = doc.ref({ PrintScaling: 'None' })
}

/**
 * The reverse of a sheet: each filled cell's back in the cell behind it. It
 * carries no marks and no note; the cuts are made from the front.
 */
function drawBackSheet(
  doc: PDFKit.PDFDocument,
  back: FinalPreparedBack,
  sheet: PrintFinalSheet,
  cells: readonly PrintFinalSheetCell[],
): void {
  doc.addPage({ size: [sheet.widthPt, sheet.heightPt], margin: 0 })
  for (const cell of cells) {
    drawPlaced(doc, back, printFinalBackPlacement(sheet, cell))
  }
}

/** Adds the sheets a count takes to the document, one page each, and after each its back where there is one. */
export function drawFinalSheets(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: FinalSheetsInput,
): void {
  const { sheet, face, tilePt, pieceCount } = input
  const colour = printFinalMarkColour(sheet.look)
  const hasNote = printFinalSheetNotes(sheet, tilePt).length > 0
  const perSheet = Math.min(input.perSheet ?? sheet.cells.length, sheet.cells.length)
  for (const filled of printFinalSheetFills(perSheet, pieceCount)) {
    const cells = sheet.cells.slice(0, filled)
    doc.addPage({ size: [sheet.widthPt, sheet.heightPt], margin: 0 })
    for (const cell of cells) {
      for (const placement of printFinalCellPlacements(sheet, cell)) {
        drawPlaced(doc, face, placement)
      }
    }
    drawMarks(doc, colour, printFinalSheetMarks(sheet, cells))
    for (const note of printFinalSheetNotes(sheet, tilePt, cells)) {
      drawNote(doc, fonts, note)
    }
    if (input.back !== undefined) drawBackSheet(doc, input.back, sheet, cells)
  }
  if (!hasNote) askForActualSize(doc)
}
