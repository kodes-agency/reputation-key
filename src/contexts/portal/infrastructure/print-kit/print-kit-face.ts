// A face in the PDF (design spec §2 to §5, §7 and §8): laid out by
// the shared planner (`layoutPrintFace`) from the guest fonts' own glyph
// outlines, and drawn where it put each part's ink: the logo or the wordmark,
// the words, the rule between two languages and the code block.
//
// The words, marks and code are drawn the same in both looks, in the look's
// colours (`PrintColours`): Paper prints them on plain paper, with the
// accent ink on the kicker, the rule and the tile's outline; Immersive over its
// art (`print-kit-art.ts`), white and off-white with the kicker tint, the
// logo on its cream plate unless it is light. Drawn in the face's coordinates, in
// points, from its trim's top-left corner.

import type { PrintFace } from '#/shared/domain/portal-print'
import type { PrintBrandBox } from '#/shared/domain/portal-print-brand'
import type { PrintTile } from '#/shared/domain/portal-print-code'
import {
  layoutPrintFace,
  type PrintBrandInput,
  type PrintContent,
  type PrintFaceLayout,
} from '#/shared/domain/portal-print-face'
import { PRINT_PLATE } from '#/shared/domain/portal-print-brand'
import { PRINT_MEASURES } from '#/shared/domain/portal-print-measures'
import type { PrintPlacedPart } from '#/shared/domain/portal-print-parts'
import type {
  PrintSetText,
  PrintTextMeasurer,
  PrintTextStyle,
} from '#/shared/domain/portal-print-text'
import { printToneColour, type PrintColours } from '#/shared/domain/portal-print-colours'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import { PRINT_KIT_TILE } from '#/shared/domain/portal-print-kit-palette'
import { drawCodeBlock } from './print-kit-code'
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

export type FaceLogo = Readonly<{ image: OpenedImage; ink: LogoInk }>

export type FaceArt = Readonly<{
  colours: PrintColours
  qr: QrMatrix
  /** The logo, or null to set the wordmark. */
  logo: FaceLogo | null
  wordmark: string
}>

/** The embedded file a style is set in. */
function fontFaceOf(style: PrintTextStyle): PrintKitFontFace {
  if (style.family === 'serif') return 'display'
  if (style.italic) return style.weight === 600 ? 'bodyStrongItalic' : 'bodyItalic'
  return style.weight === 600 ? 'bodyStrong' : 'body'
}

const pdfTextStyle = (style: PrintTextStyle, colour: string): PdfTextStyle => ({
  face: fontFaceOf(style),
  size: style.sizePt,
  spacing: style.trackingEm * style.sizePt,
  colour,
  opacity: 1,
})

/** The words measured as the PDF sets them: advances and glyph outlines from the embedded fonts. */
export function pdfMeasurer(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
): PrintTextMeasurer {
  return {
    advancePt: (text, style) =>
      measureLine(doc, fonts, text, pdfTextStyle(style, '#000000')),
    ink: (text, style) =>
      measureLineInk(doc, fonts, text, pdfTextStyle(style, '#000000')),
  }
}

/** The logo's drawn pixels: its picture without the transparent margin round it. */
export const logoInkSize = (logo: FaceLogo) => ({
  inkWidth: logo.image.width * (logo.ink.right - logo.ink.left),
  inkHeight: logo.image.height * (logo.ink.bottom - logo.ink.top),
})

/** The brand a Paper face's planner sizes: the logo by its drawn pixels, bare on the paper, or the wordmark. */
function brandInput(art: FaceArt): PrintBrandInput {
  if (art.logo === null) return { kind: 'wordmark', text: art.wordmark }
  return { kind: 'logo', ...logoInkSize(art.logo), onPlate: false }
}

/** Lays a Paper face out in the PDF's own measures. */
export function layoutFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  input: Readonly<{
    face: PrintFace
    blocks: readonly PrintTextBlock[]
    tile: PrintTile
    art: FaceArt
  }>,
): PrintFaceLayout {
  return layoutPrintFace({
    face: input.face,
    blocks: input.blocks,
    brand: brandInput(input.art),
    tile: input.tile,
    measurer: pdfMeasurer(doc, fonts),
  })
}

/** One set part's lines on their baselines, where its ink box was placed. */
export function drawText(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  set: PrintSetText,
  part: PrintPlacedPart,
  colour: string,
) {
  const style = pdfTextStyle(set.style, colour)
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
  logo: FaceLogo,
  box: PrintBrandBox,
  part: PrintPlacedPart,
) {
  if (box.paddingPt.h > 0) {
    doc.save()
    doc
      .roundedRect(part.xPt, part.yPt, box.widthPt, box.heightPt, PRINT_PLATE.radiusPt)
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

function drawContent(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  art: FaceArt,
  content: PrintContent,
  part: PrintPlacedPart,
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
        printToneColour(colours, content.tone),
      )
    case 'logo':
      return art.logo === null ? undefined : drawLogo(doc, art.logo, content.box, part)
    case 'rule':
      doc.rect(part.xPt, part.yPt, part.widthPt, part.heightPt).fill(colours.accent)
  }
}

/** Draws a laid-out face's words, marks and code; whatever is under them is drawn first. */
export function drawFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: PrintFaceLayout,
  art: FaceArt,
): void {
  const { plan } = layout
  plan.parts.forEach((part, index) => {
    const content = layout.contents[index]
    if (content !== undefined) drawContent(doc, fonts, art, content, part)
  })
  drawCodeBlock(
    doc,
    fonts,
    {
      qr: art.qr,
      cues: layout.cues,
      cuePt: PRINT_MEASURES[plan.face.region][plan.face.piece].cuePt,
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
