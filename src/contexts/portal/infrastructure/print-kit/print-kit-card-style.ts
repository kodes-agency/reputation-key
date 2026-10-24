// A card's text style (`CardTextStyle`, in ems and points) as the PDF sets it:
// the tracking turned into points after every character, in a colour.

import type { CardTextStyle } from '#/shared/domain/portal-print-kit-card-words'
import type { PdfTextStyle } from './print-kit-pdf-text'

export const pdfStyleOf = (style: CardTextStyle, colour: string): PdfTextStyle => ({
  face: style.face,
  size: style.sizePt,
  spacing: style.sizePt * style.trackingEm,
  colour,
  opacity: 1,
})
