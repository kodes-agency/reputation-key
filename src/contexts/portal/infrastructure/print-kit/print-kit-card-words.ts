// The words of a card drawn as they were planned (`portal-print-kit-card-words.ts`):
// each line and the rule centred in the column (or set from its left edge, on
// the small tent), in its role's colour. The lines were broken and measured in
// the PDF's own fonts when the card was planned.

import type { CardColours } from '#/shared/domain/portal-print-kit-card-colours'
import type { CardLine, CardRule } from '#/shared/domain/portal-print-kit-card-words'
import { drawLine, type PrintKitFonts } from './print-kit-pdf-text'
import { pdfStyleOf } from './print-kit-card-style'

/** How the words sit in their column: centred on a card, from its left edge on the small tent. */
export type WordsAlign = 'centre' | 'left'

/** Draws `items` in the column from `column.x`, `column.widthPt` wide: centred, unless `align` says left. */
export function drawCardWords(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  items: readonly (CardLine | CardRule)[],
  colours: CardColours,
  column: Readonly<{ x: number; widthPt: number }>,
  align: WordsAlign = 'centre',
): void {
  for (const item of items) {
    const x = align === 'left' ? column.x : column.x + (column.widthPt - item.widthPt) / 2
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
