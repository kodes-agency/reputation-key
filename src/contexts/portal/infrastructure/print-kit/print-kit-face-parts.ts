// What a card's face and a small tent's face share as the PDF draws them: the
// brand they are planned with (the logo measured to its ink, or the wordmark),
// the words measured in the embedded fonts, and the photo area (a card's band,
// a tent's panel) run into the bleed, with the monogram on its ground when there
// is no photo.

import type { CardBrandInput } from '#/shared/domain/portal-print-kit-card-brand'
import type { CardTextMeasure } from '#/shared/domain/portal-print-kit-card-words'
import type { ImmersivePrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { pdfStyleOf } from './print-kit-card-style'
import type { FaceLogo } from './print-kit-face-brand'
import { drawImage, type OpenedImage } from './print-kit-pdf-image'
import {
  capTopInLineBox,
  fontMetrics,
  measureLine,
  type PrintKitFonts,
} from './print-kit-pdf-text'
import { drawMonogram } from './print-kit-window'

/** The drawing's width over its height, measured to its ink. */
const inkAspect = (logo: FaceLogo): number =>
  (logo.image.width * (logo.ink.right - logo.ink.left)) /
  Math.max(1, logo.image.height * (logo.ink.bottom - logo.ink.top))

/** The brand a face is planned with: the logo, on a plate when it has one, or the wordmark. */
export const faceBrandInput = (
  art: Readonly<{ logo: FaceLogo | null; wordmark: string }>,
): CardBrandInput =>
  art.logo === null
    ? { kind: 'wordmark', text: art.wordmark }
    : { kind: 'logo', inkAspect: inkAspect(art.logo), plate: art.logo.plate !== null }

/** How a face's words are measured in the embedded fonts, and where a wordmark's caps start. */
export function faceMeasures(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
): Readonly<{
  measure: CardTextMeasure
  wordmarkInkTopPt: (sizePt: number) => number
}> {
  const display = fontMetrics(doc, fonts, 'display')
  return {
    measure: (text, style) => measureLine(doc, fonts, text, pdfStyleOf(style, '#000000')),
    wordmarkInkTopPt: (size) => capTopInLineBox(display, size, 0.75),
  }
}

type Box = Readonly<{ x: number; y: number; widthPt: number; heightPt: number }>

/**
 * A photo area, `area` with its bleed: the photo cropped to it, or with none the
 * monogram's ground run into the bleed and the letter centred on the area as it
 * is trimmed (`trimmed`), set with `monogram`'s measures.
 */
export function drawPhotoArea(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  area: Readonly<{ x: number; y: number; width: number; height: number }>,
  trimmed: Box,
  art: Readonly<{
    palette: ImmersivePrintKitPalette
    photo: OpenedImage | null
    letter: string
    monogram: Parameters<typeof drawMonogram>[4]
  }>,
): void {
  doc.save()
  doc.rect(area.x, area.y, area.width, area.height).clip()
  if (art.photo !== null) {
    drawImage(doc, art.photo, area)
  } else {
    doc.rect(area.x, area.y, area.width, area.height).fill(art.palette.plateTone)
    drawMonogram(
      doc,
      fonts,
      trimmed,
      { palette: art.palette, letter: art.letter },
      art.monogram,
    )
  }
  doc.restore()
}
