// What a print shop looks for around the art: crop marks at the trim, a fold
// mark on a folded sheet, and the PDF boxes that say where the trim and the
// bleed are, so a preflight reads them without being told.
//
// And what an office printer's sheet carries instead (spec 4.3 and 4.4): grey
// ticks where it is cut or folded, and on the Letter card sheet a print check in
// the strip that is cut away, whose bar measures 2 in when the sheet was printed
// at Actual size.

import { PRINT_KIT_BLEED_MM, type PrintSheet } from '#/shared/domain/portal-print-kit'
import type { PaperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import {
  PRINT_CHECK,
  TICK,
  type PrintKitPage,
  type PrintKitTick,
} from '#/shared/domain/portal-print-kit-sheets'
import { CODE_BLOCK } from '#/shared/domain/portal-print-kit-measures'
import {
  MARK_LENGTH_MM,
  MARK_OFFSET_MM,
  SLUG_MM,
} from '#/shared/domain/portal-print-kit-layout'
import { mm } from './print-kit-geometry'
import { drawCentredLine, type PrintKitFonts } from './print-kit-pdf-text'

/** All four inks: marks stay visible on every plate. */
const REGISTRATION: [number, number, number, number] = [100, 100, 100, 100]
const MARK_WEIGHT_PT = 0.25

export type SheetFrame = Readonly<{
  /** The page in points, trim and slug together. */
  pageWidth: number
  pageHeight: number
  /** Where the trim sits on the page, in points. */
  trimLeft: number
  trimTop: number
  trimWidth: number
  trimHeight: number
}>

export function frameOf(sheet: PrintSheet): SheetFrame {
  return {
    pageWidth: mm(sheet.trimWidthMm + 2 * SLUG_MM),
    pageHeight: mm(sheet.trimHeightMm + 2 * SLUG_MM),
    trimLeft: mm(SLUG_MM),
    trimTop: mm(SLUG_MM),
    trimWidth: mm(sheet.trimWidthMm),
    trimHeight: mm(sheet.trimHeightMm),
  }
}

/** The four crop marks, two lines at each corner, pointing away from the art. */
export function drawCropMarks(doc: PDFKit.PDFDocument, frame: SheetFrame): void {
  const offset = mm(MARK_OFFSET_MM)
  const length = mm(MARK_LENGTH_MM)
  const left = frame.trimLeft
  const right = frame.trimLeft + frame.trimWidth
  const top = frame.trimTop
  const bottom = frame.trimTop + frame.trimHeight
  doc.save().lineWidth(MARK_WEIGHT_PT).strokeColor(REGISTRATION)
  for (const x of [left, right]) {
    const direction = x === left ? -1 : 1
    for (const y of [top, bottom]) {
      // Across the corner, then up or down it.
      doc
        .moveTo(x + direction * offset, y)
        .lineTo(x + direction * (offset + length), y)
        .stroke()
      const up = y === top ? -1 : 1
      doc
        .moveTo(x, y + up * offset)
        .lineTo(x, y + up * (offset + length))
        .stroke()
    }
  }
  doc.restore()
}

/** A dashed mark at the fold, on both edges, outside the trim. */
export function drawFoldMarks(
  doc: PDFKit.PDFDocument,
  frame: SheetFrame,
  foldAtMm: number,
): void {
  const y = frame.trimTop + mm(foldAtMm)
  const offset = mm(MARK_OFFSET_MM)
  const length = mm(MARK_LENGTH_MM)
  const left = frame.trimLeft
  const right = frame.trimLeft + frame.trimWidth
  doc.save().lineWidth(MARK_WEIGHT_PT).strokeColor(REGISTRATION).dash(2, { space: 2 })
  doc
    .moveTo(left - offset, y)
    .lineTo(left - offset - length, y)
    .stroke()
  doc
    .moveTo(right + offset, y)
    .lineTo(right + offset + length, y)
    .stroke()
  doc.undash().restore()
}

/**
 * Declares the trim and the bleed on the page. Boxes are `[left, bottom, right,
 * top]` in PDF space, whose origin is the bottom-left of the page.
 */
export function setPageBoxes(page: PDFKit.PDFPage, frame: SheetFrame): void {
  const bleed = mm(PRINT_KIT_BLEED_MM)
  const box = (inset: number): number[] => [
    frame.trimLeft - inset,
    frame.pageHeight - (frame.trimTop + frame.trimHeight) - inset,
    frame.trimLeft + frame.trimWidth + inset,
    frame.pageHeight - frame.trimTop + inset,
  ]
  Object.assign(page.dictionary.data, { TrimBox: box(0), BleedBox: box(bleed) })
}

/**
 * Declares the trim of a redesigned page, and its bleed when it has one. A Paper
 * page has none: its trim is the sheet, and a BleedBox the size of the trim would
 * tell a preflight there is bleed to keep when there is none.
 */
export function setStyledPageBoxes(page: PDFKit.PDFPage, sheet: PrintKitPage): void {
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

/** The grey ticks of a Paper sheet, as filled rectangles: their weight is exact at any zoom. */
export function drawTicks(doc: PDFKit.PDFDocument, ticks: readonly PrintKitTick[]): void {
  if (ticks.length === 0) return
  doc.save()
  for (const tick of ticks) doc.rect(tick.xPt, tick.yPt, tick.widthPt, tick.heightPt)
  doc.fill(TICK.colour)
  doc.restore()
}

/**
 * The print check under the Letter cards: the question, the 2 in bar in the
 * code's bar colour with the accent-ink outline drawn outside it (so the bar
 * itself is the 2 in), and two lines on what to measure and where to cut.
 */
export function drawPrintCheck(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  palette: PaperPrintKitPalette,
): void {
  const { title, bar, lines, gapPt, centreXPt } = PRINT_CHECK
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
  lines.text.forEach((text, index) => {
    line(text, y + (index + 0.5) * lineHeight, 'body', lines.sizePt, palette.soft)
  })
}
