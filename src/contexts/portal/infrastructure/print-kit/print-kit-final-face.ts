// A final face in the PDF (final design spec §2 to §5, §7 and §8): laid out by
// the shared planner (`layoutPrintFinalFace`) from the guest fonts' own glyph
// outlines, and drawn where it put each part's ink: the logo or the wordmark,
// the stars, the words, the rule between two languages and the code block.
//
// The words, marks and code are drawn the same in both looks, in the look's
// colours (`PrintFinalColours`): Paper prints them on plain paper, with the
// accent ink on the kicker, the stars, the rule and the tile's outline;
// Immersive over its art (`print-kit-final-art.ts`), white and off-white with
// the kicker tint, the logo on its cream plate unless it is light. Drawn in the
// face's coordinates, in points, from its trim's top-left corner.

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
import {
  printFinalToneColour,
  type PrintFinalColours,
} from '#/shared/domain/portal-print-final-colours'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import { PRINT_KIT_TILE } from '#/shared/domain/portal-print-kit-palette'
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
  colours: PrintFinalColours
  qr: QrMatrix
  /** The logo, or null to set the wordmark. */
  logo: FinalFaceLogo | null
  wordmark: string
}>

/** The embedded file a style is set in. */
function fontFaceOf(style: PrintFinalTextStyle): PrintKitFontFace {
  if (style.family === 'serif') return 'display'
  if (style.italic) return style.weight === 600 ? 'bodyStrongItalic' : 'bodyItalic'
  return style.weight === 600 ? 'bodyStrong' : 'body'
}

const pdfFinalTextStyle = (style: PrintFinalTextStyle, colour: string): PdfTextStyle => ({
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

/** The logo's drawn pixels: its picture without the transparent margin round it. */
export const finalLogoInkSize = (logo: FinalFaceLogo) => ({
  inkWidth: logo.image.width * (logo.ink.right - logo.ink.left),
  inkHeight: logo.image.height * (logo.ink.bottom - logo.ink.top),
})

/** The brand a Paper face's planner sizes: the logo by its drawn pixels, bare on the paper, or the wordmark. */
function brandInput(art: FinalFaceArt): PrintFinalBrandInput {
  if (art.logo === null) return { kind: 'wordmark', text: art.wordmark }
  return { kind: 'logo', ...finalLogoInkSize(art.logo), onPlate: false }
}

/** Lays a Paper face out in the PDF's own measures. */
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

/** One set part's lines on their baselines, where its ink box was placed. */
export function drawText(
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
export function drawLogo(
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
  const { colours } = art
  switch (content.kind) {
    case 'wordmark':
      return drawText(doc, fonts, content.set, part, colours.ink)
    case 'words':
      return drawText(
        doc,
        fonts,
        content.set,
        part,
        printFinalToneColour(colours, content.tone),
      )
    case 'logo':
      return art.logo === null ? undefined : drawLogo(doc, art.logo, content.box, part)
    case 'stars':
      return drawStars(doc, content.stars, part, colours.accent)
    case 'rule':
      doc.rect(part.xPt, part.yPt, part.widthPt, part.heightPt).fill(colours.accent)
  }
}

/** Draws a laid-out face's words, marks and code; whatever is under them is drawn first. */
export function drawFinalFace(
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
        outline: art.colours.outline,
        barFill: art.colours.barFill,
        barText: art.colours.barText,
      },
    },
    layout.code,
    plan.code,
  )
}
