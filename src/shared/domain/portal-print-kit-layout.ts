// The fixed measures of a print panel, in millimetres and points.
//
// Shared with `portal-print-kit.ts` for the same reason: the Share tab's preview
// is drawn from these numbers in CSS, and the PDF is drawn from them in PDFKit,
// so a margin, the plate under the code or the size of a headline has one home
// and the preview cannot drift from the file. A panel's coordinates have their
// origin at the top-left corner of its trim.

import { A6_HEIGHT_MM, A6_WIDTH_MM } from './portal-print-kit'

export const PANEL_WIDTH_MM = A6_WIDTH_MM
export const PANEL_HEIGHT_MM = A6_HEIGHT_MM

/** Paper outside the trim: the bleed, then room for the crop marks. */
export const SLUG_MM = 10
/** Marks start this far from the trim, past the bleed, so they never print in it. */
export const MARK_OFFSET_MM = 4
export const MARK_LENGTH_MM = 5

/** Text keeps this far from the trim, so a trimming tolerance never touches it. */
export const SIDE_MARGIN_MM = 7.5
export const BOTTOM_MARGIN_MM = 8

/** The wordmark or logo: its middle sits this far below the trim's top edge. */
export const BRAND_MIDDLE_MM = 9
export const LOGO_BOX_MM = { width: 42, height: 10 } as const

/** Where the stack of words may sit, measured from the top of the panel. */
export const STACK_TOP_MM = 30
export const STACK_GAP_BELOW_MM = 4

/** The plate the code sits on, and the paper inside it. */
export const PLATE_MM = 46
export const PLATE_RADIUS_MM = 6.4
export const PLATE_PAPER_MM = 39.2
export const PLATE_PAPER_RADIUS_MM = 1.6
export const PLATE_ABOVE_ADDRESS_MM = 3.2
/** The code and the paper under it: fixed, so any phone reads it. */
export const PLATE_INK = '#121614'
export const PLATE_PAPER = '#F6F1E6'

/** The photo band: from above the trim (the bleed) to this far down. */
export const PHOTO_BAND_MM = 60
/** Where the band begins to fade into the field, as a share of its height. */
export const PHOTO_FADE_FROM = 0.3

/** Type scale, in points. */
export const TYPE_PT = {
  wordmark: 12.8,
  kicker: 7.9,
  headline: 28.5,
  subline: 10.5,
  secondHeadline: 17,
  secondSubline: 9.4,
  address: 8,
  addressMin: 6.5,
} as const

/**
 * The address under the code is small type on a dark field, printed once and
 * read at arm's length: it is set at four fifths white, not two thirds.
 */
export const ADDRESS_OPACITY = 0.8

/** Tracking, in ems, of the uppercase lines. */
export const TRACKING_EM = { wordmark: 0.38, kicker: 0.3 } as const

/** One language alone is set larger than two: there is room for it. */
export const SINGLE_LANGUAGE_SCALE = 1.22

/** Line height of each line of the stack of words, as a share of its type size. */
export const STACK_LEADING = {
  kicker: 1.4,
  headline: 1.08,
  subline: 1.35,
  secondHeadline: 1.15,
} as const

/**
 * The space between the lines of the stack, in millimetres at scale 1: under
 * the title, under the call to action, around the rule between two languages
 * and under the second language's call to action. Each grows and shrinks with
 * the stack's scale.
 */
export const STACK_GAP_MM = {
  belowKicker: 1.6,
  belowHeadline: 1,
  aboveRule: 3.6,
  belowRule: 3.4,
  belowSecondHeadline: 0.5,
} as const

/** The rule between two languages, in millimetres at scale 1. */
export const STACK_RULE_WIDTH_MM = 8.5

/**
 * How the stack makes room for long words: from its full scale
 * (`SINGLE_LANGUAGE_SCALE` for one language, 1 for two) down by `step` to
 * `minScale`, the largest scale at which it fits above the code. The PDF
 * measures its fonts for this; the preview estimates.
 */
export const STACK_FIT = { step: 0.04, minScale: 0.6 } as const

/**
 * How the brand and the title give way to a long name. Each is one line at its
 * size until that line would have to be smaller than `minPt`, then at most
 * `maxLines` lines; and below `minPt` only for text longer than any brand has.
 * The PDF measures its fonts for this; the preview estimates.
 */
export const BRAND_FIT = {
  wordmark: { minPt: 8, maxLines: 2, lineHeight: 1.3 },
  kicker: { minPt: 6, maxLines: 2 },
} as const

/** The page of one sheet in millimetres: its trim and a slug on every side. */
export function printPageMm(trimWidthMm: number, trimHeightMm: number) {
  return { widthMm: trimWidthMm + 2 * SLUG_MM, heightMm: trimHeightMm + 2 * SLUG_MM }
}
