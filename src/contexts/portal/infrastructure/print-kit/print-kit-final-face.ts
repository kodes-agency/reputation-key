// A final face in the PDF (final design spec §2 to §5, §7 and §8): laid out by
// the shared planner (`layoutPrintFinalFace`) from the guest fonts' own glyph
// outlines, and drawn where it put each part's ink: the logo or the wordmark,
// the stars, the words, the rule between two languages and the code block.
//
// Paper prints no ground: plain paper, ink and soft text, the accent ink on the
// kicker, the stars, the rule and the tile's outline, the accent on the bar.
// Drawn in the face's coordinates, in points, from its trim's top-left corner.

import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import type { PrintFinalBrandBox } from '#/shared/domain/portal-print-final-brand'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import {
  layoutPrintFinalFace,
  type PrintFinalBrandInput,
  type PrintFinalContent,
  type PrintFinalFaceLayout,
} from '#/shared/domain/portal-print-final-face'
import { PRINT_FINAL_PLATE } from '#/shared/domain/portal-print-final-brand'
import {
  PRINT_FINAL_STAR,
  type PrintFinalStars,
} from '#/shared/domain/portal-print-final-marks'
import { PRINT_FINAL_MEASURES } from '#/shared/domain/portal-print-final-measures'
import type { PrintFinalPlacedPart } from '#/shared/domain/portal-print-final-parts'
import type {
  PrintFinalSetText,
  PrintFinalTextMeasurer,
  PrintFinalTextStyle,
} from '#/shared/domain/portal-print-final-text'
import type { PrintFinalTone } from '#/shared/domain/portal-print-final-words'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import {
  PRINT_KIT_TILE,
  type PaperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { drawFinalCodeBlock } from './print-kit-final-code'
import type { LogoInk } from './print-kit-image'
import { drawImage, type OpenedImage } from './print-kit-pdf-image'
import {
  drawLineOnBaseline,
  measureLine,
  measureLineInk,
  type PdfTextStyle,
  type PrintKitFonts,
} from './print-kit-pdf-text'
import type { PrintKitFontFace } from './print-kit-fonts'
import type { QrMatrix } from './print-kit-qr'

export type FinalFaceLogo = Readonly<{ image: OpenedImage; ink: LogoInk }>

export type FinalFaceArt = Readonly<{
  palette: PaperPrintKitPalette
  qr: QrMatrix
  /** The logo, or null to set the wordmark. */
  logo: FinalFaceLogo | null
  wordmark: string
}>

/** The embedded file a style is set in. */
function fontFaceOf(style: PrintFinalTextStyle): PrintKitFontFace {
  if (style.family === 'serif') return 'display'
  if (style.italic) return 'bodyItalic'
  return style.weight === 600 ? 'bodyStrong' : 'body'
}

export const pdfFinalTextStyle = (
  style: PrintFinalTextStyle,
  colour: string,
): PdfTextStyle => ({
  face: fontFaceOf(style),
  size: style.sizePt,
  spacing: style.trackingEm * style.sizePt,
  colour,
  opacity: 1,
})

/** The words measured as the PDF sets them: advances and glyph outlines from the embedded fonts. */
export function pdfFinalMeasurer(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
): PrintFinalTextMeasurer {
  return {
    advancePt: (text, style) =>
      measureLine(doc, fonts, text, pdfFinalTextStyle(style, '#000000')),
    ink: (text, style) =>
      measureLineInk(doc, fonts, text, pdfFinalTextStyle(style, '#000000')),
  }
}

/** The brand the planner sizes: the logo by its drawn pixels, or the wordmark. */
function brandInput(art: FinalFaceArt): PrintFinalBrandInput {
  if (art.logo === null) return { kind: 'wordmark', text: art.wordmark }
  const { image, ink } = art.logo
  return {
    kind: 'logo',
    inkWidth: image.width * (ink.right - ink.left),
    inkHeight: image.height * (ink.bottom - ink.top),
    onPlate: false,
  }
}

/** Lays a face out in the PDF's own measures. */
export function layoutFinalFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: Readonly<{
    face: PrintFinalFace
    blocks: readonly PrintTextBlock[]
    tile: PrintFinalTile
    art: FinalFaceArt
  }>,
): PrintFinalFaceLayout {
  return layoutPrintFinalFace({
    face: input.face,
    blocks: input.blocks,
    brand: brandInput(input.art),
    tile: input.tile,
    measurer: pdfFinalMeasurer(doc, fonts),
  })
}

const toneColour = (palette: PaperPrintKitPalette, tone: PrintFinalTone): string =>
  ({ ink: palette.ink, soft: palette.soft, accent: palette.accentInk })[tone]

function drawText(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  set: PrintFinalSetText,
  part: PrintFinalPlacedPart,
  colour: string,
) {
  const style = pdfFinalTextStyle(set.style, colour)
  for (const line of set.lines) {
    drawLineOnBaseline(doc, fonts, line.text, style, {
      x: part.xPt + line.originPt,
      baselineY: part.yPt + line.baselinePt,
    })
  }
}

/** The logo with its drawing filling the planned box (on its plate, when it has one); its transparent edge falls outside. */
function drawLogo(
  doc: PDFKit.PDFDocument,
  logo: FinalFaceLogo,
  box: PrintFinalBrandBox,
  part: PrintFinalPlacedPart,
) {
  if (box.paddingPt.h > 0) {
    doc.save()
    doc
      .roundedRect(
        part.xPt,
        part.yPt,
        box.widthPt,
        box.heightPt,
        PRINT_FINAL_PLATE.radiusPt,
      )
      .fill(PRINT_KIT_TILE)
    doc.restore()
  }
  const { ink, image } = logo
  const width = box.logo.widthPt / (ink.right - ink.left)
  const height = box.logo.heightPt / (ink.bottom - ink.top)
  drawImage(doc, image, {
    x: part.xPt + box.paddingPt.h - ink.left * width,
    y: part.yPt + box.paddingPt.v - ink.top * height,
    width,
    height,
  })
}

function drawStars(
  doc: PDFKit.PDFDocument,
  stars: PrintFinalStars,
  part: PrintFinalPlacedPart,
  colour: string,
) {
  const scale = stars.sizePt / PRINT_FINAL_STAR.grid
  for (const origin of stars.origins) {
    doc.save()
    doc.translate(part.xPt + origin.xPt, part.yPt + origin.yPt).scale(scale)
    doc.lineWidth(stars.strokePt / scale).lineJoin('round')
    doc.path(PRINT_FINAL_STAR.path).stroke(colour)
    doc.restore()
  }
}

function drawContent(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  art: FinalFaceArt,
  content: PrintFinalContent,
  part: PrintFinalPlacedPart,
) {
  const { palette } = art
  switch (content.kind) {
    case 'wordmark':
      return drawText(doc, fonts, content.set, part, palette.ink)
    case 'words':
      return drawText(doc, fonts, content.set, part, toneColour(palette, content.tone))
    case 'logo':
      return art.logo === null ? undefined : drawLogo(doc, art.logo, content.box, part)
    case 'stars':
      return drawStars(doc, content.stars, part, palette.accentInk)
    case 'rule':
      doc.rect(part.xPt, part.yPt, part.widthPt, part.heightPt).fill(palette.accentInk)
  }
}

/** Draws a laid-out Paper face. Nothing is painted under it: the paper is the customer's. */
export function drawFinalPaperFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: PrintFinalFaceLayout,
  art: FinalFaceArt,
): void {
  const { plan } = layout
  plan.parts.forEach((part, index) => {
    const content = layout.contents[index]
    if (content !== undefined) drawContent(doc, fonts, art, content, part)
  })
  drawFinalCodeBlock(
    doc,
    fonts,
    {
      qr: art.qr,
      cues: layout.cues,
      cuePt: PRINT_FINAL_MEASURES[plan.face.region][plan.face.piece].cuePt,
      colours: {
        outline: art.palette.accentInk,
        barFill: art.palette.barFill,
        barText: art.palette.barText,
      },
    },
    layout.code,
    plan.code,
  )
}
