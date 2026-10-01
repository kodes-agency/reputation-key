// What a print shop looks for around the art: crop marks at the trim, a fold
// mark on a folded sheet, and the PDF boxes that say where the trim and the
// bleed are, so a preflight reads them without being told.

import { PRINT_KIT_BLEED_MM, type PrintSheet } from '#/shared/domain/portal-print-kit'
import { mm } from './print-kit-geometry'

/** Paper outside the trim: the bleed, then room for the marks. */
export const SLUG_MM = 10
/** Marks start this far from the trim, past the bleed, so they never print in it. */
const MARK_OFFSET_MM = 4
const MARK_LENGTH_MM = 5

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
