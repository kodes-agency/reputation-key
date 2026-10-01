// The words of one panel, laid out from the top: the portal's title in small
// capitals, the call to action, the line under it, and, when there are two
// languages, a rule and the second language smaller beneath.
//
// Laid out in millimetres at a scale. The caller picks the largest scale at
// which the stack fits the room the code's plate leaves, so a long headline in
// one language shrinks the type instead of running into the code.

import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import { BRAND_FIT, mm, TYPE_PT, TRACKING_EM } from './print-kit-geometry'
import type { PrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { measureLine, type PdfTextStyle, type PrintKitFonts } from './print-kit-pdf-text'
import { fitLines, wrapWords } from '#/shared/domain/portal-print-kit-text'

const POINTS_PER_MM = mm(1)
const ptToMm = (points: number) => points / POINTS_PER_MM

export type StackItem =
  | Readonly<{
      kind: 'line'
      text: string
      style: PdfTextStyle
      /** The vertical middle of the line, in millimetres from the stack's top. */
      middleMm: number
    }>
  | Readonly<{ kind: 'rule'; yMm: number; widthMm: number; colour: string }>

export type Stack = Readonly<{ items: readonly StackItem[]; heightMm: number }>

type Measure = (text: string, style: PdfTextStyle) => number

/** Line height as a share of the type size. */
const LEADING = { headline: 1.08, secondHeadline: 1.15, subline: 1.35, kicker: 1.4 }

const RULE_WIDTH_MM = 8.5

type Cursor = { y: number; items: StackItem[] }

function pushLines(
  cursor: Cursor,
  lines: readonly string[],
  style: PdfTextStyle,
  leading: number,
): void {
  const lineMm = ptToMm(style.size * leading)
  for (const text of lines) {
    cursor.items.push({ kind: 'line', text, style, middleMm: cursor.y + lineMm / 2 })
    cursor.y += lineMm
  }
}

function layoutFirstBlock(
  cursor: Cursor,
  block: PrintTextBlock,
  palette: PrintKitPalette,
  scale: number,
  maxWidthPt: number,
  measure: Measure,
): void {
  const kickerAt = (size: number): PdfTextStyle => ({
    face: 'bodyStrong',
    size,
    spacing: size * TRACKING_EM.kicker,
    colour: palette.kicker,
    opacity: 1,
  })
  const headline: PdfTextStyle = {
    face: 'display',
    size: TYPE_PT.headline * scale,
    spacing: 0,
    colour: palette.headline,
    opacity: 1,
  }
  const subline: PdfTextStyle = {
    face: 'body',
    size: TYPE_PT.subline * scale,
    spacing: 0,
    colour: palette.body,
    opacity: 0.84,
  }
  // A long title shrinks to a floor, then takes a second line, so it stays
  // inside the margins instead of running to the bleed.
  const kickerSize = TYPE_PT.kicker * scale
  const kicker = fitLines({
    text: block.kicker.toUpperCase(),
    size: kickerSize,
    minSize: Math.min(kickerSize, BRAND_FIT.kicker.minPt),
    maxLines: BRAND_FIT.kicker.maxLines,
    maxWidth: maxWidthPt,
    widthAt: (text, size) => measure(text, kickerAt(size)),
  })
  pushLines(cursor, kicker.lines, kickerAt(kicker.size), LEADING.kicker)
  cursor.y += 1.6 * scale
  pushLines(
    cursor,
    wrapWords(block.headline, maxWidthPt, (line) => measure(line, headline)),
    headline,
    LEADING.headline,
  )
  cursor.y += 1 * scale
  pushLines(
    cursor,
    wrapWords(block.subline, maxWidthPt, (line) => measure(line, subline)),
    subline,
    LEADING.subline,
  )
}

function layoutSecondBlock(
  cursor: Cursor,
  block: PrintTextBlock,
  palette: PrintKitPalette,
  scale: number,
  maxWidthPt: number,
  measure: Measure,
): void {
  const headline: PdfTextStyle = {
    face: 'display',
    size: TYPE_PT.secondHeadline * scale,
    spacing: 0,
    colour: palette.headline,
    opacity: 0.94,
  }
  const subline: PdfTextStyle = {
    face: 'body',
    size: TYPE_PT.secondSubline * scale,
    spacing: 0,
    colour: palette.body,
    opacity: 0.72,
  }
  cursor.y += 3.6 * scale
  cursor.items.push({
    kind: 'rule',
    yMm: cursor.y,
    widthMm: RULE_WIDTH_MM * scale,
    colour: palette.kicker,
  })
  cursor.y += 3.4 * scale
  pushLines(
    cursor,
    wrapWords(block.headline, maxWidthPt, (line) => measure(line, headline)),
    headline,
    LEADING.secondHeadline,
  )
  cursor.y += 0.5 * scale
  pushLines(
    cursor,
    wrapWords(block.subline, maxWidthPt, (line) => measure(line, subline)),
    subline,
    LEADING.subline,
  )
}

/** The panel's words at `scale`, as lines and a rule placed from the stack's top. */
export function layoutStack(
  blocks: readonly PrintTextBlock[],
  palette: PrintKitPalette,
  scale: number,
  maxWidthPt: number,
  measure: Measure,
): Stack {
  const cursor: Cursor = { y: 0, items: [] }
  const [first, second] = blocks
  if (first) layoutFirstBlock(cursor, first, palette, scale, maxWidthPt, measure)
  if (second) layoutSecondBlock(cursor, second, palette, scale, maxWidthPt, measure)
  return { items: cursor.items, heightMm: cursor.y }
}

/** A measure bound to a document and its fonts. */
export const measureWith =
  (doc: PDFKit.PDFDocument, fonts: PrintKitFonts): Measure =>
  (text, style) =>
    measureLine(doc, fonts, text, style)

const SCALE_STEP = 0.04
const MIN_SCALE = 0.6

/**
 * The stack at the largest scale up to `maxScale` that fits `roomMm`. A stack
 * that fits at no scale is returned at the smallest, and the caller clips it:
 * that only happens with copy far longer than any pack's.
 */
export function fitStack(
  layout: (scale: number) => Stack,
  roomMm: number,
  maxScale: number,
): Stack {
  let scale = maxScale
  let stack = layout(scale)
  while (stack.heightMm > roomMm && scale > MIN_SCALE) {
    scale = Math.max(MIN_SCALE, scale - SCALE_STEP)
    stack = layout(scale)
  }
  return stack
}
