// The brand at the head of a face (spec 2.1, 2.5 and 3.1): the
// property's logo when it has one, else its wordmark in tracked capitals.
//
// A face measures its top margin to ink, so the plan says where the ink starts
// inside the brand's box: the wordmark's cap line, from the font's metrics, or
// the top of a logo's drawing, from its alpha. A logo too light to print on paper
// sits on a plate in the field colour, and then the plate is the ink.

import {
  FIT,
  LOGO_BOX_MM,
  LOGO_PLATE,
  WORDMARK,
  mmToPt,
  printedDpi,
} from '#/shared/domain/portal-print-kit-measures'
import { stripUnsupportedCharacters } from '#/shared/domain/portal-print-kit-font-ranges'
import { fitLines } from '#/shared/domain/portal-print-kit-text'
import type { LogoInk } from './print-kit-image'
import { drawImage, type OpenedImage } from './print-kit-pdf-image'
import {
  capTopInLineBox,
  drawLine,
  fontMetrics,
  measureLine,
  type PdfTextStyle,
  type PrintKitFonts,
} from './print-kit-pdf-text'

export type FaceLogo = Readonly<{
  image: OpenedImage
  ink: LogoInk
  /** The plate it sits on, when it would not read on its ground alone; null for none. */
  plate: string | null
}>

export type FaceBrandArt = Readonly<{
  wordmark: string
  logo: FaceLogo | null
  /** The wordmark's colour. */
  colour: string
}>

export type BrandSize = Readonly<{
  /** The wordmark's type size, and the logo's height, at most. */
  wordmarkPt: number
  logoHeightPt: number
  /** The room across the face. */
  maxWidthPt: number
}>

type BrandBox = Readonly<{
  widthPt: number
  heightPt: number
  /** Where the ink starts inside the box, from its top and its left edge. */
  inkTopPt: number
  inkLeftPt: number
}>

export type BrandPlan =
  | (BrandBox &
      Readonly<{ kind: 'wordmark'; lines: readonly string[]; style: PdfTextStyle }>)
  | (BrandBox &
      Readonly<{
        kind: 'logo'
        logo: FaceLogo
        imageWidthPt: number
        imageHeightPt: number
      }>)

/** From one line of a two-line wordmark to the next, in ems: the line box itself is 0.75 em. */
const WORDMARK_LINE_PITCH_EM = 1.2

const wordmarkStyle = (size: number, colour: string): PdfTextStyle => ({
  face: 'display',
  size,
  spacing: size * WORDMARK.trackingEm,
  colour,
  opacity: 1,
})

function planWordmark(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  art: FaceBrandArt,
  size: BrandSize,
): BrandPlan {
  const measure = (text: string, at: number) =>
    measureLine(doc, fonts, text, wordmarkStyle(at, art.colour))
  const { lines, size: fitted } = fitLines({
    text: stripUnsupportedCharacters(art.wordmark.toUpperCase()),
    size: size.wordmarkPt,
    // A brand longer than the face shrinks to its floor before it takes a second line.
    minSize: Math.min(size.wordmarkPt, FIT.wordmarkFloorPt),
    maxLines: 2,
    maxWidth: size.maxWidthPt,
    widthAt: measure,
  })
  const lineBox = fitted * WORDMARK.lineBoxEm
  return {
    kind: 'wordmark',
    lines,
    style: wordmarkStyle(fitted, art.colour),
    widthPt: Math.max(0, ...lines.map((line) => measure(line, fitted))),
    heightPt: lineBox + Math.max(0, lines.length - 1) * fitted * WORDMARK_LINE_PITCH_EM,
    inkTopPt: capTopInLineBox(
      fontMetrics(doc, fonts, 'display'),
      fitted,
      WORDMARK.lineBoxEm,
    ),
    inkLeftPt: 0,
  }
}

function planLogo(logo: FaceLogo, size: BrandSize): BrandPlan {
  const padX = logo.plate === null ? 0 : LOGO_PLATE.paddingXPt
  const padY = logo.plate === null ? 0 : LOGO_PLATE.paddingYPt
  const maxWidth = Math.min(mmToPt(LOGO_BOX_MM.width), size.maxWidthPt) - 2 * padX
  const scale = Math.min(
    size.logoHeightPt / logo.image.height,
    maxWidth / logo.image.width,
  )
  const imageWidthPt = logo.image.width * scale
  const imageHeightPt = logo.image.height * scale
  return {
    kind: 'logo',
    logo,
    imageWidthPt,
    imageHeightPt,
    widthPt: imageWidthPt + 2 * padX,
    heightPt: imageHeightPt + 2 * padY,
    // On a plate the plate is the ink; else the drawing starts past the file's transparent edge.
    inkTopPt: logo.plate === null ? imageHeightPt * logo.ink.top : 0,
    inkLeftPt: logo.plate === null ? imageWidthPt * logo.ink.left : 0,
  }
}

/** The brand's box at `size`, and where its ink starts. */
export function planBrand(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  art: FaceBrandArt,
  size: BrandSize,
): BrandPlan {
  return art.logo === null
    ? planWordmark(doc, fonts, art, size)
    : planLogo(art.logo, size)
}

/** The dots per inch a planned logo prints at; none for a wordmark. */
export function brandDpi(plan: BrandPlan): number | null {
  return plan.kind === 'logo'
    ? printedDpi(plan.logo.image.width, plan.imageWidthPt)
    : null
}

/**
 * Draws the brand with its box's top-left corner at `at`. The lines of a
 * two-line wordmark are centred in the box on a card, and start at its left on
 * the Paper tent face.
 */
export function drawBrand(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  plan: BrandPlan,
  at: Readonly<{ x: number; y: number; align: 'centre' | 'start' }>,
): void {
  if (plan.kind === 'logo') {
    const { plate } = plan.logo
    if (plate !== null) {
      doc.save()
      doc
        .roundedRect(at.x, at.y, plan.widthPt, plan.heightPt, LOGO_PLATE.radiusPt)
        .fill(plate)
      doc.restore()
    }
    const inset =
      plate === null
        ? { x: 0, y: 0 }
        : { x: LOGO_PLATE.paddingXPt, y: LOGO_PLATE.paddingYPt }
    drawImage(doc, plan.logo.image, {
      x: at.x + inset.x,
      y: at.y + inset.y,
      width: plan.imageWidthPt,
      height: plan.imageHeightPt,
    })
    return
  }
  const { size } = plan.style
  plan.lines.forEach((line, index) => {
    const width = measureLine(doc, fonts, line, plan.style)
    const x = at.align === 'centre' ? at.x + (plan.widthPt - width) / 2 : at.x
    const middleY =
      at.y + (size * WORDMARK.lineBoxEm) / 2 + index * size * WORDMARK_LINE_PITCH_EM
    drawLine(doc, fonts, line, plan.style, { x, middleY })
  })
}
