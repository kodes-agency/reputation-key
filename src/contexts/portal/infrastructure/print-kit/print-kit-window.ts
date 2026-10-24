// The Immersive photo window (spec 5.2): a frame in the accent line, a 0.3 mm
// border and 0.7 mm of padding round the picture, and inside it the photo,
// already cropped to the picture's shape and dimmed (print-kit-image.ts), so type
// never touches it. With no photo, the window holds the monogram: the brand's
// first letter in Cormorant, tone on tone on a lighter ground, between two short
// rules.
//
// Drawn in the face's own coordinates, in points.

import { WINDOW } from '#/shared/domain/portal-print-kit-measures'
import type { ImmersivePrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { drawImage, type OpenedImage } from './print-kit-pdf-image'
import {
  drawLine,
  measureLine,
  type PdfTextStyle,
  type PrintKitFonts,
} from './print-kit-pdf-text'

type Box = Readonly<{ x: number; y: number; widthPt: number; heightPt: number }>

export type WindowLayout = Box & Readonly<{ picture: Box }>

export type WindowArt = Readonly<{
  palette: ImmersivePrintKitPalette
  /** The photo cropped to this window's picture; null for the monogram. */
  photo: OpenedImage | null
  letter: string
}>

/** How a monogram is set in its box: the letter's share of the height, the rules and how far the letter drops. */
export type MonogramMeasures = Readonly<{
  letterShare: number
  ruleLengthPt: number
  ruleWeightPt: number
  gapPt: number
  /** Down from centred, in ems of the letter: the window's board sets it 4 % lower, so its caps sit centred. */
  dropEm: number
}>

const WINDOW_MONOGRAM: MonogramMeasures = { ...WINDOW.monogram, dropEm: 0.04 }

/** The brand's first letter between two rules, on the monogram's ground, filling `picture`. */
export function drawMonogram(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  picture: Box,
  art: Pick<WindowArt, 'palette' | 'letter'>,
  monogram: MonogramMeasures = WINDOW_MONOGRAM,
): void {
  const { palette, letter } = art
  doc
    .rect(picture.x, picture.y, picture.widthPt, picture.heightPt)
    .fill(palette.plateTone)
  const size = picture.heightPt * monogram.letterShare
  const style: PdfTextStyle = {
    face: 'display',
    size,
    spacing: 0,
    colour: palette.mono,
    opacity: 1,
  }
  const letterWidth = letter === '' ? 0 : measureLine(doc, fonts, letter, style)
  const groupWidth = 2 * monogram.ruleLengthPt + 2 * monogram.gapPt + letterWidth
  const left = picture.x + (picture.widthPt - groupWidth) / 2
  const middle = picture.y + picture.heightPt / 2
  const ruleTop = middle - monogram.ruleWeightPt / 2
  const rightRule = left + monogram.ruleLengthPt + 2 * monogram.gapPt + letterWidth
  doc.rect(left, ruleTop, monogram.ruleLengthPt, monogram.ruleWeightPt)
  doc.rect(rightRule, ruleTop, monogram.ruleLengthPt, monogram.ruleWeightPt)
  doc.fill(palette.monoLine)
  if (letter === '') return
  drawLine(doc, fonts, letter, style, {
    x: left + monogram.ruleLengthPt + monogram.gapPt,
    middleY: middle + monogram.dropEm * size,
  })
}

/** Draws the window: its frame, then the photo or the monogram clipped to the picture's rounded corners. */
export function drawWindow(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  window: WindowLayout,
  art: WindowArt,
): void {
  const { borderPt, outerRadiusPt, innerRadiusPt } = WINDOW.frame
  doc.save()
  // The border is inside the window's box, as the board's `border-box`.
  doc
    .roundedRect(
      window.x + borderPt / 2,
      window.y + borderPt / 2,
      window.widthPt - borderPt,
      window.heightPt - borderPt,
      outerRadiusPt - borderPt / 2,
    )
    .lineWidth(borderPt)
    .stroke(art.palette.accentLine)
  const { picture } = window
  doc
    .roundedRect(picture.x, picture.y, picture.widthPt, picture.heightPt, innerRadiusPt)
    .clip()
  if (art.photo === null) drawMonogram(doc, fonts, picture, art)
  else {
    drawImage(doc, art.photo, {
      x: picture.x,
      y: picture.y,
      width: picture.widthPt,
      height: picture.heightPt,
    })
  }
  doc.restore()
}
