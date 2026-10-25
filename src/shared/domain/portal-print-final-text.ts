// The final print's words, set (final design spec §2.3 and §3): each part is
// broken into balanced lines in its column and measured by its ink, so the
// planners place the glyphs, not the line boxes. Pure and shared: the PDF
// measures the guest fonts with their glyph outlines, the Share tab's preview
// estimates them (`portal-print-kit-text-widths.ts`), and both hand their
// measures to `setPrintFinalText` through a `PrintFinalTextMeasurer`.
//
// Inside a part the lines sit as a browser sets them: one line pitch apart
// (size × leading), each centred in the column by its advance on an upright
// face, or set from the column's left edge on a wide one. The part's ink box is
// what the planner places; each line keeps its offset inside it.

import { balanceWords, type LineBreaks } from './portal-print-kit-text'
import type { PrintFinalFamily } from './portal-print-final-type'

/** How one part's words are set. */
export type PrintFinalTextStyle = Readonly<{
  family: PrintFinalFamily
  weight: 400 | 600
  italic: boolean
  sizePt: number
  /** Extra space after each character, in ems; negative tightens. */
  trackingEm: number
  /** The line pitch, in ems. */
  leading: number
  /** Set in capitals. */
  caps: boolean
}>

/**
 * A line's ink, from where the line starts (its pen origin) and its baseline, in
 * points: `left` and `right` across, `ascent` above the baseline and `descent`
 * below it.
 */
export type PrintFinalLineInk = Readonly<{
  leftPt: number
  rightPt: number
  ascentPt: number
  descentPt: number
}>

export type PrintFinalTextMeasurer = Readonly<{
  /** The line's advance: its width as set, without the tracking after the last character. */
  advancePt: (text: string, style: PrintFinalTextStyle) => number
  ink: (text: string, style: PrintFinalTextStyle) => PrintFinalLineInk
}>

export type PrintFinalAlign = 'centre' | 'left'

export type PrintFinalSetLine = Readonly<{
  text: string
  /** The line's pen origin, from the part's ink box's left edge. */
  originPt: number
  /** The line's baseline, from the part's ink box's top. */
  baselinePt: number
}>

export type PrintFinalSetText = Readonly<{
  style: PrintFinalTextStyle
  lines: readonly PrintFinalSetLine[]
  /** The part's ink box. */
  widthPt: number
  heightPt: number
}>

/** The text as it prints: capitals for a tracked caps line. */
const printFinalDisplayText = (text: string, style: PrintFinalTextStyle) =>
  style.caps ? text.toUpperCase() : text

/**
 * The width a line takes in its column when it breaks: its advance, plus the
 * tracking after its last character, as a browser counts letter-spacing.
 */
const breakWidth = (measurer: PrintFinalTextMeasurer, style: PrintFinalTextStyle) => {
  const trailing = Math.max(0, style.trackingEm * style.sizePt)
  return (line: string) => measurer.advancePt(line, style) + trailing
}

type Placed = Readonly<{
  text: string
  origin: number
  baseline: number
  ink: PrintFinalLineInk
}>

/**
 * Sets `text` in a column `columnPt` wide: balanced lines, each centred by its
 * advance (`centre`) or from the column's left edge (`left`), one line pitch
 * apart, measured by their ink. Lines break at spaces, and also after a hyphen
 * between two letters where `breaks` says so, as a browser breaks a name like
 * "Houston-Near". Empty text sets nothing (null).
 */
export function setPrintFinalText(
  text: string,
  style: PrintFinalTextStyle,
  columnPt: number,
  align: PrintFinalAlign,
  measurer: PrintFinalTextMeasurer,
  breaks: LineBreaks = 'spaces',
): PrintFinalSetText | null {
  const shown = printFinalDisplayText(text.trim(), style)
  if (shown === '') return null
  const lines = balanceWords(shown, columnPt, breakWidth(measurer, style), breaks)
  const pitch = style.sizePt * style.leading
  const placed: Placed[] = lines.map((line, index) => {
    const advance = measurer.advancePt(line, style)
    return {
      text: line,
      origin: align === 'centre' ? (columnPt - advance) / 2 : 0,
      baseline: index * pitch,
      ink: measurer.ink(line, style),
    }
  })
  const left = Math.min(...placed.map((p) => p.origin + p.ink.leftPt))
  const right = Math.max(...placed.map((p) => p.origin + p.ink.rightPt))
  const top = Math.min(...placed.map((p) => p.baseline - p.ink.ascentPt))
  const bottom = Math.max(...placed.map((p) => p.baseline + p.ink.descentPt))
  return {
    style,
    lines: placed.map((p) => ({
      text: p.text,
      originPt: p.origin - left,
      baselinePt: p.baseline - top,
    })),
    widthPt: right - left,
    heightPt: bottom - top,
  }
}
