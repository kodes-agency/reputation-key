// The brand as text, when the property has no logo: its wordmark in capitals at
// the head of the panel. A long name gives way: it shrinks to a floor, then
// wraps to two lines, so no end of it ever reaches the bleed where a cutter
// would take it.

import { fitLines } from '#/shared/domain/portal-print-kit-text'
import {
  BRAND_FIT,
  BRAND_MIDDLE_MM,
  PANEL_WIDTH_MM,
  TEXT_WIDTH_PT,
  TRACKING_EM,
  TYPE_PT,
  mm,
} from './print-kit-geometry'
import {
  drawCentredLine,
  measureLine,
  type PdfTextStyle,
  type PrintKitFonts,
} from './print-kit-pdf-text'

const CENTRE_X = mm(PANEL_WIDTH_MM / 2)

const wordmarkStyle = (size: number): PdfTextStyle => ({
  face: 'display',
  size,
  spacing: size * TRACKING_EM.wordmark,
  colour: '#FFFFFF',
  opacity: 1,
})

/** The wordmark's lines and the size they are set at. */
export function layoutWordmark(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  wordmark: string,
) {
  return fitLines({
    text: wordmark.toUpperCase(),
    size: TYPE_PT.wordmark,
    minSize: BRAND_FIT.wordmark.minPt,
    maxLines: BRAND_FIT.wordmark.maxLines,
    maxWidth: TEXT_WIDTH_PT,
    widthAt: (text, size) => measureLine(doc, fonts, text, wordmarkStyle(size)),
  })
}

/** The wordmark, its lines centred on the brand's middle. */
export function drawWordmark(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  wordmark: string,
): void {
  const { lines, size } = layoutWordmark(doc, fonts, wordmark)
  const lineHeight = size * BRAND_FIT.wordmark.lineHeight
  lines.forEach((line, index) => {
    drawCentredLine(doc, fonts, line, wordmarkStyle(size), {
      centreX: CENTRE_X,
      middleY: mm(BRAND_MIDDLE_MM) + (index - (lines.length - 1) / 2) * lineHeight,
    })
  })
}
