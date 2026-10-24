// The words of a card drawn as they were planned (`portal-print-kit-card-words.ts`):
// each line and the rule centred in the column, in its role's colour. The lines
// were broken and measured in the PDF's own fonts when the card was planned.

import type { CardColours } from '#/shared/domain/portal-print-kit-card-colours'
import type { CardLine, CardRule } from '#/shared/domain/portal-print-kit-card-words'
import { drawLine, type PrintKitFonts } from './print-kit-pdf-text'
import { pdfStyleOf } from './print-kit-card-style'

/** Draws `items` centred in the column from `column.x`, `column.widthPt` wide. */
export function drawCardWords(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  items: readonly (CardLine | CardRule)[],
  colours: CardColours,
  column: Readonly<{ x: number; widthPt: number }>,
): void {
  for (const item of items) {
    const x = column.x + (column.widthPt - item.widthPt) / 2
    if (item.kind === 'rule') {
      doc.save()
      doc.rect(x, item.topPt, item.widthPt, item.weightPt).fill(colours.rule)
      doc.restore()
      continue
    }
    drawLine(doc, fonts, item.text, pdfStyleOf(item.style, colours[item.role]), {
      x,
      middleY: item.topPt + item.heightPt / 2,
    })
  }
}
