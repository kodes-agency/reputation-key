// Millimetres and points for the PDF. The measures themselves (margins, the
// plate under the code, the type scale) are shared with the Share tab's preview
// in `portal-print-kit-layout.ts`, so a panel is laid out from one set of
// numbers in both. A panel is drawn in its own coordinates, in points, with
// the origin at the top-left corner of its trim.

export {
  ADDRESS_OPACITY,
  BOTTOM_MARGIN_MM,
  BRAND_FIT,
  BRAND_MIDDLE_MM,
  LOGO_BOX_MM,
  PANEL_HEIGHT_MM,
  PANEL_WIDTH_MM,
  PHOTO_BAND_MM,
  PHOTO_FADE_FROM,
  PLATE_ABOVE_ADDRESS_MM,
  PLATE_MM,
  PLATE_PAPER_MM,
  PLATE_PAPER_RADIUS_MM,
  PLATE_RADIUS_MM,
  SIDE_MARGIN_MM,
  SINGLE_LANGUAGE_SCALE,
  STACK_GAP_BELOW_MM,
  STACK_TOP_MM,
  TRACKING_EM,
  TYPE_PT,
} from '#/shared/domain/portal-print-kit-layout'

import { PANEL_WIDTH_MM, SIDE_MARGIN_MM } from '#/shared/domain/portal-print-kit-layout'

const POINTS_PER_MM = 72 / 25.4

export const mm = (millimetres: number): number => millimetres * POINTS_PER_MM

/** The width text may take across a panel: the trim less a margin on each side. */
export const TEXT_WIDTH_PT = mm(PANEL_WIDTH_MM - 2 * SIDE_MARGIN_MM)
