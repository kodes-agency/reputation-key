// Text on a PDF page: the guest fonts registered on a document, and a line of
// text measured and drawn in them.
//
// A line is split into runs by font file (portal-print-kit-font-ranges.ts), because no
// single guest file carries a bilingual line. A line is drawn from its left edge
// or centred on a point.

import {
  splitIntoFontRuns,
  stripUnsupportedCharacters,
  type FontSubset,
} from '#/shared/domain/portal-print-kit-font-ranges'
import { printKitFontBytes, type PrintKitFontFace } from './print-kit-fonts'

export type PdfTextStyle = Readonly<{
  face: PrintKitFontFace
  /** Points. */
  size: number
  /** Extra points after every character: the tracking of an uppercase line. */
  spacing: number
  colour: string
  opacity: number
}>

/** Registers each font file on the document the first time it is used. */
export class PrintKitFonts {
  private readonly registered = new Set<string>()

  constructor(private readonly doc: PDFKit.PDFDocument) {}

  use(face: PrintKitFontFace, subset: FontSubset, size: number): void {
    const name = `${face}-${subset}`
    if (!this.registered.has(name)) {
      this.doc.registerFont(name, printKitFontBytes(face, subset))
      this.registered.add(name)
    }
    this.doc.font(name).fontSize(size)
  }
}

/** A face's vertical metrics, in thousandths of an em, as PDFKit reads them from the font. */
export type FontMetrics = Readonly<{
  ascender: number
  descender: number
  capHeight: number
}>

/**
 * The vertical metrics of `face`, from its Latin file: the families' files share
 * one set. PDFKit keeps them on the current font, which its typings leave out, so
 * the one read that needs it is wrapped here.
 */
export function fontMetrics(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  face: PrintKitFontFace,
): FontMetrics {
  fonts.use(face, 'latin', 1)
  const font: unknown = Reflect.get(doc, '_font')
  const read = (key: keyof FontMetrics): number => {
    const value: unknown =
      font === null || typeof font !== 'object' ? undefined : Reflect.get(font, key)
    if (typeof value !== 'number') throw new Error(`This PDFKit font has no ${key}`)
    return value
  }
  return {
    ascender: read('ascender'),
    descender: read('descender'),
    capHeight: read('capHeight'),
  }
}

/**
 * How far below the top of a line box the capitals start: a line is set with
 * its content area centred in its line box (as CSS does, and as PDFKit's
 * `middle` baseline places it), and the caps rise `capHeight` above the
 * baseline. The margins are measured to this cap line, not to the box (spec 2.5).
 */
export function capTopInLineBox(
  metrics: FontMetrics,
  sizePt: number,
  lineHeightEm: number,
): number {
  const baselineBelowMiddle = (metrics.ascender + metrics.descender) / 2 / 1000
  return sizePt * (lineHeightEm / 2 + baselineBelowMiddle - metrics.capHeight / 1000)
}

/** Ligatures off: fontkit switches a default feature off when its tag is given as false. */
const NO_LIGATURES = { liga: false, clig: false, dlig: false }

/**
 * The OpenType features a line is shaped with, or none.
 *
 * Lining figures on the display face: Cormorant's default figures are old-style,
 * so "Chair 3" would set with a descending 3 (spec 2.1). Its Latin and Cyrillic
 * files carry `lnum`; Ysabeau's figures are lining already.
 *
 * No ligatures on a tracked line: it is set glyph by glyph, a ligature is one
 * glyph, and the tracking has nothing to act on inside it. Cormorant joins "TT"
 * in "TRATTORIA" into one glyph, and in a line of spaced capitals the pair prints
 * joined.
 *
 * PDFKit's typings describe only the array that switches features on, hence the
 * cast. fontkit also writes the features it applied into the object it is given,
 * so every call gets its own.
 */
function featuresOf(style: PdfTextStyle): PDFKit.Mixins.TextOptions['features'] {
  const features = {
    ...(style.face === 'display' ? { lnum: true } : {}),
    ...(style.spacing > 0 ? NO_LIGATURES : {}),
  }
  if (Object.keys(features).length === 0) return undefined
  return features as unknown as PDFKit.Mixins.TextOptions['features']
}

type MeasuredRun = Readonly<{ subset: FontSubset; text: string; width: number }>

function measureRuns(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
): readonly MeasuredRun[] {
  return splitIntoFontRuns(stripUnsupportedCharacters(text)).map((run) => {
    fonts.use(style.face, run.subset, style.size)
    const characters = [...run.text].length
    const width = doc.widthOfString(run.text, { features: featuresOf(style) })
    return { ...run, width: width + style.spacing * characters }
  })
}

/** The width of a line in points; the tracking after the last character is not part of it. */
export function measureLine(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
): number {
  const runs = measureRuns(doc, fonts, text, style)
  if (runs.length === 0) return 0
  return runs.reduce((sum, run) => sum + run.width, 0) - style.spacing
}

/** A line's ink, from its pen origin and its baseline, in points (`descent` is below the baseline). */
export type PdfLineInk = Readonly<{
  leftPt: number
  rightPt: number
  ascentPt: number
  descentPt: number
}>

type GlyphBox = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>
type LaidGlyph = Readonly<{ bbox: GlyphBox }>
type LaidPosition = Readonly<{ xAdvance: number; xOffset: number; yOffset: number }>
type EmbeddedLayout = Readonly<{
  /** Font units to thousandths of an em. */
  scale: number
  layout: (
    text: string,
    features: PDFKit.Mixins.TextOptions['features'],
  ) => Readonly<{ glyphs: readonly LaidGlyph[]; positions: readonly LaidPosition[] }>
}>

/** The current font's shaper: PDFKit keeps the fontkit font behind it, which its typings leave out. */
function currentLayout(doc: PDFKit.PDFDocument): EmbeddedLayout {
  const font: unknown = Reflect.get(doc, '_font')
  const layout: unknown =
    font === null || typeof font !== 'object' ? undefined : Reflect.get(font, 'layout')
  const scale: unknown =
    font === null || typeof font !== 'object' ? undefined : Reflect.get(font, 'scale')
  if (typeof layout !== 'function' || typeof scale !== 'number') {
    throw new Error('This PDFKit font cannot lay out a line')
  }
  return { scale, layout: (text, features) => layout.call(font, text, features) }
}

const hasInk = (box: GlyphBox) =>
  Number.isFinite(box.minX) && box.maxX > box.minX && box.maxY > box.minY

/**
 * The line's ink: the union of its glyphs' outlines as they are shaped and
 * tracked, in points. A line with no ink (only spaces) measures zero.
 */
export function measureLineInk(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
): PdfLineInk {
  const ink = { left: Infinity, right: -Infinity, top: -Infinity, bottom: Infinity }
  const trackingEm = (style.spacing / style.size) * 1000
  let pen = 0
  for (const run of splitIntoFontRuns(stripUnsupportedCharacters(text))) {
    fonts.use(style.face, run.subset, style.size)
    const font = currentLayout(doc)
    const laid = font.layout(run.text, featuresOf(style))
    laid.glyphs.forEach((glyph, index) => {
      const at = laid.positions[index]
      const box = glyph.bbox
      if (at !== undefined && hasInk(box)) {
        const x = pen + at.xOffset
        ink.left = Math.min(ink.left, x + box.minX * font.scale)
        ink.right = Math.max(ink.right, x + box.maxX * font.scale)
        ink.top = Math.max(ink.top, box.maxY * font.scale + at.yOffset)
        ink.bottom = Math.min(ink.bottom, box.minY * font.scale + at.yOffset)
      }
      pen += (at?.xAdvance ?? 0) + trackingEm
    })
  }
  if (ink.left === Infinity) return { leftPt: 0, rightPt: 0, ascentPt: 0, descentPt: 0 }
  const pt = style.size / 1000
  return {
    leftPt: ink.left * pt,
    rightPt: ink.right * pt,
    ascentPt: ink.top * pt,
    descentPt: -ink.bottom * pt,
  }
}

/** How a line is anchored vertically: its middle (as CSS centres a line box) or its baseline. */
type Anchor = Readonly<{ y: number; baseline: 'middle' | 'alphabetic' }>

function drawRuns(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
  x: number,
  anchor: Anchor,
): void {
  let pen = x
  doc.fillColor(style.colour, style.opacity)
  for (const run of measureRuns(doc, fonts, text, style)) {
    fonts.use(style.face, run.subset, style.size)
    doc.text(run.text, pen, anchor.y, {
      lineBreak: false,
      baseline: anchor.baseline,
      characterSpacing: style.spacing,
      features: featuresOf(style),
    })
    pen += run.width
  }
}

/** A line starting at `x`, its vertical middle at `middleY`. */
export function drawLine(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
  at: Readonly<{ x: number; middleY: number }>,
): void {
  drawRuns(doc, fonts, text, style, at.x, { y: at.middleY, baseline: 'middle' })
}

/** A line starting at `x`, sitting on `baselineY`: the final kit places its words by their ink, from the baseline. */
export function drawLineOnBaseline(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
  at: Readonly<{ x: number; baselineY: number }>,
): void {
  drawRuns(doc, fonts, text, style, at.x, { y: at.baselineY, baseline: 'alphabetic' })
}

/** A line centred on `centreX`, its vertical middle at `middleY`. */
export function drawCentredLine(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  text: string,
  style: PdfTextStyle,
  at: Readonly<{ centreX: number; middleY: number }>,
): void {
  const width = measureLine(doc, fonts, text, style)
  drawLine(doc, fonts, text, style, { x: at.centreX - width / 2, middleY: at.middleY })
}
