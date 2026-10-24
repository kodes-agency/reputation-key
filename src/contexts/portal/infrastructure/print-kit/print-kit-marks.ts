// What a print shop looks for around the art (spec 5.3): crop marks at the trim,
// fold marks on a folded sheet and a slug line, and the PDF boxes that say where
// the trim and the bleed are, so a preflight reads them without being told.
//
// And what an office printer's sheet carries instead (spec 4.3 and 4.4): grey
// ticks where it is cut or folded, and on the Letter card sheet a print check in
// the strip that is cut away, whose bar measures 2 in when the sheet was printed
// at Actual size. The round-3 office sheets carry a short note instead, and an
// Immersive office sheet's crop marks are plain black, not registration.

import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import type { PaperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import {
  PRINT_CHECK,
  TICK,
  printCheckLines,
  type PrintKitPage,
  type PrintKitTick,
  type SheetNote,
} from '#/shared/domain/portal-print-kit-sheets'
import { SHEET_NOTE } from '#/shared/domain/portal-print-kit-sheet-parts'
import { fillWords } from '#/shared/domain/portal-print-kit-text'
import { CODE_BLOCK } from '#/shared/domain/portal-print-kit-measures'
import {
  PRINT_SHOP_MARK,
  printShopMarks,
  type MarkLine,
} from '#/shared/domain/portal-print-kit-immersive'
import {
  drawCentredLine,
  drawLine,
  measureLine,
  type PdfTextStyle,
  type PrintKitFonts,
} from './print-kit-pdf-text'

/** All four inks: marks stay visible on every plate. */
const REGISTRATION: [number, number, number, number] = [100, 100, 100, 100]

/**
 * Declares the trim of a page, and its bleed when it has one. Boxes are `[left,
 * bottom, right, top]` in PDF space, whose origin is the bottom-left of the
 * page. A Paper page has no bleed: its trim is the sheet, and a BleedBox the
 * size of the trim would tell a preflight there is bleed to keep when there is
 * none.
 */
export function setPageBoxes(page: PDFKit.PDFPage, sheet: PrintKitPage): void {
  const { trim } = sheet
  const box = (inset: number): number[] => [
    trim.leftPt - inset,
    sheet.heightPt - (trim.topPt + trim.heightPt) - inset,
    trim.leftPt + trim.widthPt + inset,
    sheet.heightPt - trim.topPt + inset,
  ]
  const boxes: Record<string, number[]> = { TrimBox: box(0) }
  if (sheet.bleedPt > 0) boxes.BleedBox = box(sheet.bleedPt)
  Object.assign(page.dictionary.data, boxes)
}

/**
 * The ticks of an office sheet, as filled rectangles: their weight is exact at
 * any zoom. Grey on Paper, plain black for an Immersive office sheet's crop marks.
 */
export function drawTicks(
  doc: PDFKit.PDFDocument,
  ticks: readonly PrintKitTick[],
  colour: string = TICK.colour,
): void {
  if (ticks.length === 0) return
  doc.save()
  for (const tick of ticks) doc.rect(tick.xPt, tick.yPt, tick.widthPt, tick.heightPt)
  doc.fill(colour)
  doc.restore()
}

const NOTE_LEADING = SHEET_NOTE.leading
const NOTE_FLOOR_PT = 5

/**
 * A sheet's note, wrapped to its box: at its size, or a quarter point smaller
 * at a time, down to 5 pt, until its lines fit the box's height. A turned note
 * runs up the page from the box's bottom-left corner.
 */
export function drawSheetNote(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  note: SheetNote,
): void {
  const styleAt = (size: number): PdfTextStyle => ({
    face: 'body',
    size,
    spacing: 0,
    colour: SHEET_NOTE.colour,
    opacity: 1,
  })
  const linesAt = (size: number) =>
    fillWords(note.text, note.widthPt, (line) =>
      measureLine(doc, fonts, line, styleAt(size)),
    )
  let size = note.sizePt
  let lines = linesAt(size)
  while (lines.length * size * NOTE_LEADING > note.heightPt && size > NOTE_FLOOR_PT) {
    size = Math.max(NOTE_FLOOR_PT, size - 0.25)
    lines = linesAt(size)
  }
  doc.save()
  if (note.turned) {
    doc.translate(note.leftPt, note.topPt).rotate(-90)
  } else {
    doc.translate(note.leftPt, note.topPt)
  }
  const lineHeight = size * NOTE_LEADING
  lines.forEach((line, index) => {
    drawLine(doc, fonts, line, styleAt(size), {
      x: 0,
      middleY: (index + 0.5) * lineHeight,
    })
  })
  doc.restore()
}

/**
 * The print check under the Letter cards: the question, a bar as wide as the
 * cards' code tile (`tilePt`, today's 2 in unless named) in the code's bar colour
 * with the accent-ink outline drawn outside it (so the bar itself is the tile),
 * and two lines on what to measure and where to cut.
 */
export function drawPrintCheck(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  palette: PaperPrintKitPalette,
  tilePt: number = PRINT_CHECK.bar.widthPt,
): void {
  const { title, lines, gapPt, centreXPt } = PRINT_CHECK
  const bar = { ...PRINT_CHECK.bar, widthPt: tilePt }
  const titleHeight = title.sizePt * title.leading
  const line = (
    text: string,
    middleY: number,
    face: 'body' | 'bodyStrong',
    size: number,
    colour: string,
  ) =>
    drawCentredLine(
      doc,
      fonts,
      text,
      { face, size, spacing: 0, colour, opacity: 1 },
      { centreX: centreXPt, middleY },
    )
  let y = PRINT_CHECK.topPt
  line(title.text, y + titleHeight / 2, 'bodyStrong', title.sizePt, palette.ink)
  y += titleHeight + gapPt
  const left = centreXPt - bar.widthPt / 2
  const outline = CODE_BLOCK.outlinePt
  doc.save()
  doc
    .rect(
      left - outline,
      y - outline,
      bar.widthPt + 2 * outline,
      bar.heightPt + 2 * outline,
    )
    .fill(palette.accentInk)
  doc.rect(left, y, bar.widthPt, bar.heightPt).fill(palette.barFill)
  doc.restore()
  y += bar.heightPt + gapPt
  const lineHeight = lines.sizePt * lines.leading
  printCheckLines(tilePt).forEach((text, index) => {
    line(text, y + (index + 0.5) * lineHeight, 'body', lines.sizePt, palette.soft)
  })
}

function strokeLines(doc: PDFKit.PDFDocument, lines: readonly MarkLine[]): void {
  for (const line of lines) doc.moveTo(line.x1, line.y1).lineTo(line.x2, line.y2).stroke()
}

/**
 * The print shop's marks round an Immersive page (spec 5.3): crop marks at each
 * corner of the trim, starting outside the bleed; dashed fold marks in both side
 * slugs of a tent; and between the bottom marks the slug line that names the
 * piece, its trim, bleed and fold, the longest of `slugLines` that fits.
 */
export function drawPrintShopMarks(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  page: PrintKitPage,
  paper: PrintKitPaper,
  slugLines: readonly string[],
): void {
  const marks = printShopMarks(page, paper)
  doc.save().lineWidth(PRINT_SHOP_MARK.weightPt).strokeColor(REGISTRATION)
  strokeLines(doc, marks.crop)
  doc.dash(PRINT_SHOP_MARK.dashPt, { space: PRINT_SHOP_MARK.dashPt })
  strokeLines(doc, marks.fold)
  doc.undash().restore()
  const { slug } = PRINT_SHOP_MARK
  const style: PdfTextStyle = {
    face: 'body',
    size: slug.sizePt,
    spacing: 0,
    colour: slug.colour,
    opacity: 1,
  }
  const text = slugLines.find(
    (line) => measureLine(doc, fonts, line, style) <= marks.slug.widthPt,
  )
  if (text === undefined) return
  drawCentredLine(doc, fonts, text, style, {
    centreX: marks.slug.centreXPt,
    middleY: marks.slug.topPt + slug.sizePt / 2,
  })
}
