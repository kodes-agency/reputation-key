// The photo on an Immersive final print (final design spec §6.2): its box on
// the face, the box with bleed it must cover, and the resolution it prints at.
// Pure and shared: the PDF crops with these and the Share tab's notice reads the
// same floored number, so the label and the notice never disagree.
//
//   - Upright: the photo runs from the top trim (below the fold strip on a tent)
//     to 0.12 in above the code block, across the full width.
//   - Wide: from the left trim to the code block's left edge, at full height.
// The box with bleed adds the bleed (1/8 in, or 3 mm) on each trim edge the
// photo touches: upright left, right and top; wide left, top and bottom. A
// tent's top is its fold strip, not photo, so a tent photo gets no top bleed.

import type { PrintFinalPlan } from './portal-print-final-plan'
import { PRINT_FINAL_DISTANCES, type PrintFinalBox } from './portal-print-final-measures'

export type PrintFinalPhotoPixels = Readonly<{ widthPx: number; heightPx: number }>

export type PrintFinalPhotoBox = Readonly<{
  /** The photo on the trim, from its top-left corner. */
  box: PrintFinalBox
  /** What the photo must cover once the bleed is added on the edges it touches. */
  coverWidthPt: number
  coverHeightPt: number
}>

/** The photo's box on a planned face, and the box with bleed it covers. */
export function printFinalPhotoBox(plan: PrintFinalPlan): PrintFinalPhotoBox {
  const bleed = PRINT_FINAL_DISTANCES.bleedPt[plan.face.region]
  const strip = plan.foldStripPt
  const topBleed = strip > 0 ? 0 : bleed
  if (plan.face.orientation === 'upright') {
    const bottom = plan.code.topPt - PRINT_FINAL_DISTANCES.photoAboveCodePt
    return {
      box: { leftPt: 0, topPt: strip, rightPt: plan.widthPt, bottomPt: bottom },
      coverWidthPt: plan.widthPt + 2 * bleed,
      coverHeightPt: bottom - strip + topBleed,
    }
  }
  const right = plan.code.leftPt
  return {
    box: { leftPt: 0, topPt: strip, rightPt: right, bottomPt: plan.heightPt },
    coverWidthPt: right + bleed,
    coverHeightPt: plan.heightPt - strip + topBleed + bleed,
  }
}

/** A hair under one dot, so a photo exactly at a tier's edge is not floored below it by rounding. */
const DPI_EPSILON = 1e-9

/**
 * The dots per inch a photo prints at when it covers a box: the lesser of its
 * two sides' pixels per printed inch, divided by the manager's zoom (1 to 1.5),
 * and floored. The label and the notice both read this number.
 */
export function printFinalPhotoDpi(
  photo: PrintFinalPhotoPixels,
  cover: Pick<PrintFinalPhotoBox, 'coverWidthPt' | 'coverHeightPt'>,
  zoom = 1,
): number {
  const perInch = Math.min(
    photo.widthPx / (cover.coverWidthPt / 72),
    photo.heightPx / (cover.coverHeightPt / 72),
  )
  return Math.floor(perInch / zoom + DPI_EPSILON)
}

/** The photo's sharpness tier: under 150 dpi "will look soft", 150 to 199 "may look soft", 200 and up sharp. Never a refusal. */
export type PrintFinalPhotoTier = 'will_look_soft' | 'may_look_soft' | 'sharp'

export const PRINT_FINAL_PHOTO_DPI = Object.freeze({ soft: 150, sharp: 200 })

export function printFinalPhotoTier(dpi: number): PrintFinalPhotoTier {
  if (dpi < PRINT_FINAL_PHOTO_DPI.soft) return 'will_look_soft'
  return dpi < PRINT_FINAL_PHOTO_DPI.sharp ? 'may_look_soft' : 'sharp'
}

/** The least photo that prints at `dpi` in this box: what the notice asks for ("a photo of at least 850 × 717 px"). */
export function printFinalPhotoPixelsFor(
  cover: Pick<PrintFinalPhotoBox, 'coverWidthPt' | 'coverHeightPt'>,
  dpi: number,
  zoom = 1,
): PrintFinalPhotoPixels {
  return {
    widthPx: Math.ceil((cover.coverWidthPt / 72) * dpi * zoom - DPI_EPSILON),
    heightPx: Math.ceil((cover.coverHeightPt / 72) * dpi * zoom - DPI_EPSILON),
  }
}
