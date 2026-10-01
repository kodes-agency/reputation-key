// Millimetres and points, and the fixed measures of a print panel.
//
// A panel is drawn in its own coordinates, in points, with the origin at the
// top-left corner of its trim. Everything that is a design decision (margins,
// the size of the code's plate, the type scale) is a named millimetre value
// here, so the layout reads as the board does and a change has one home.

import { A6_HEIGHT_MM, A6_WIDTH_MM } from '#/shared/domain/portal-print-kit'

const POINTS_PER_MM = 72 / 25.4

export const mm = (millimetres: number): number => millimetres * POINTS_PER_MM

export const PANEL_WIDTH_MM = A6_WIDTH_MM
export const PANEL_HEIGHT_MM = A6_HEIGHT_MM

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
  addressMin: 6,
} as const

/** Tracking, in ems, of the uppercase lines. */
export const TRACKING_EM = { wordmark: 0.38, kicker: 0.3 } as const
