// Text on a PDF page: the guest fonts registered on a document, and a line of
// text measured and drawn in them.
//
// A line is split into runs by font file (print-kit-font-ranges.ts), because no
// single guest file carries a bilingual line. Lines are centred: the print kit
// sets nothing flush left.

import { splitIntoFontRuns, stripUnsupportedCharacters } from './print-kit-font-ranges'
import type { FontSubset } from './print-kit-font-ranges'
import { printKitFontBytes, type PrintKitFontFace } from './print-kit-fonts'

export type PdfTextStyle = Readonly<{
  face: PrintKitFontFace
  /** Points. */
  size: number
  /** Extra points after every character: the tracking of an uppercase line. */
  spacing: number
  colour: string
  opacity: number
}>

/** Registers each font file on the document the first time it is used. */
export class PrintKitFonts {
  private readonly registered = new Set<string>()

  constructor(private readonly doc: PDFKit.PDFDocument) {}

  use(face: PrintKitFontFace, subset: FontSubset, size: number): void {
    const name = `${face}-${subset}`
    if (!this.registered.has(name)) {
      this.doc.registerFont(name, printKitFontBytes(face, subset))
      this.registered.add(name)
    }
    this.doc.font(name).fontSize(size)
  }
}

type MeasuredRun = Readonly<{ subset: FontSubset; text: string; width: number }>

function measureRuns(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
): readonly MeasuredRun[] {
  return splitIntoFontRuns(stripUnsupportedCharacters(text)).map((run) => {
    fonts.use(style.face, run.subset, style.size)
    const characters = [...run.text].length
    return { ...run, width: doc.widthOfString(run.text) + style.spacing * characters }
  })
}

/** The width of a line in points; the tracking after the last character is not part of it. */
export function measureLine(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
): number {
  const runs = measureRuns(doc, fonts, text, style)
  if (runs.length === 0) return 0
  return runs.reduce((sum, run) => sum + run.width, 0) - style.spacing
}

/** A line centred on `centreX`, its vertical middle at `middleY`. */
export function drawCentredLine(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
  at: Readonly<{ centreX: number; middleY: number }>,
): void {
  const runs = measureRuns(doc, fonts, text, style)
  const total = runs.reduce((sum, run) => sum + run.width, 0) - style.spacing
  let x = at.centreX - total / 2
  doc.fillColor(style.colour, style.opacity)
  for (const run of runs) {
    fonts.use(style.face, run.subset, style.size)
    doc.text(run.text, x, at.middleY, {
      lineBreak: false,
      baseline: 'middle',
      characterSpacing: style.spacing,
    })
    x += run.width
  }
}
