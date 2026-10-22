// The measures the preview needs that the PDF finds by measuring: the width of
// the brand and the title. The PDF measures its fonts; the preview cannot, so it
// estimates from the average width of a character, which is close enough to
// place a line.

import { fitLines, type FittedLines } from '#/shared/domain/portal-print-kit-text'
import { stripUnsupportedCharacters } from '#/shared/domain/portal-print-kit-font-ranges'
import {
  BRAND_FIT,
  TRACKING_EM,
  PANEL_WIDTH_MM,
  SIDE_MARGIN_MM,
  TYPE_PT,
} from '#/shared/domain/portal-print-kit-layout'

/** Points in a millimetre. */
const POINTS_PER_MM = 72 / 25.4

/**
 * Lining figures for what the file sets in Cormorant, whose default figures are
 * old-style. It is the OpenType feature the lining value of font-variant-numeric
 * switches on, written as a feature setting on purpose: Tailwind's scanner reads
 * every token under `src/`, and the CSS keyword spelt out here would make it emit
 * a utility into the first-paint stylesheet (18 B gzip, against a closure with
 * 200 B to spare).
 */
export const LINING_FIGURES = { fontFeatureSettings: '"lnum" 1' } as const

/**
 * The average advance of a capital, in ems, of the display face and of the body
 * face. The PDF measures; these err wide, so the preview never shows a line
 * that fits when the file's would not.
 */
const DISPLAY_CAPITAL_EM = 0.6
const BODY_CAPITAL_EM = 0.56

const textWidthPt = (PANEL_WIDTH_MM - 2 * SIDE_MARGIN_MM) * POINTS_PER_MM

/** A tracked line of capitals, in points: the tracking after the last one is not part of it. */
const capitalsWidthPt =
  (advanceEm: number, trackingEm: number) => (text: string, sizePt: number) =>
    text.length * sizePt * (advanceEm + trackingEm) - sizePt * trackingEm

/**
 * The wordmark as the PDF sets it: in capitals, without what the fonts lack (the
 * browser's own fallback would draw it, the file does not), one line to a floor,
 * then two.
 */
export function previewWordmark(wordmark: string): FittedLines {
  return fitLines({
    text: stripUnsupportedCharacters(wordmark.toUpperCase()),
    size: TYPE_PT.wordmark,
    minSize: BRAND_FIT.wordmark.minPt,
    maxLines: BRAND_FIT.wordmark.maxLines,
    maxWidth: textWidthPt,
    widthAt: capitalsWidthPt(DISPLAY_CAPITAL_EM, TRACKING_EM.wordmark),
  })
}

/** The Portal's title as the PDF sets it above the call to action, at the stack's `scale`. */
export function previewKicker(title: string, scale: number): FittedLines {
  const size = TYPE_PT.kicker * scale
  return fitLines({
    text: stripUnsupportedCharacters(title.toUpperCase()),
    size,
    minSize: Math.min(size, BRAND_FIT.kicker.minPt),
    maxLines: BRAND_FIT.kicker.maxLines,
    maxWidth: textWidthPt,
    widthAt: capitalsWidthPt(BODY_CAPITAL_EM, TRACKING_EM.kicker),
  })
}

/** Millimetres on a page of `pageWidthMm` as a share of the preview's width, in `cqw`. */
export function mmToContainerWidth(millimetres: number, pageWidthMm: number): string {
  return `${Number(((millimetres * 100) / pageWidthMm).toFixed(4))}cqw`
}
