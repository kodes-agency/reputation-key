// How an Immersive final face keeps its words readable without a dark band
// (final design spec §6.3, as fixed on 2026-10-26): the scrims darken the photo
// only, and when a word of the message still misses 4.5:1 the photo melts
// further into the ground behind it, never toward black. A scrim that printed
// over the bare ground under the fade was darker than the ground and ended in a
// visible edge; the ground itself is dark enough to carry every word. A brand
// the top scrim cannot carry at its most is cleared the same way.
//
// Pure and shared: the PDF bakes the scrims into the photo and masks it by the
// fade and the clearing; the preview nests the scrims in the masked photo; the
// contrast reader composes the same way.

import { inPt } from './portal-print-final-measures'
import { layerAlpha, rampAlpha, type PrintFinalRamp } from './portal-print-final-layers'
import type { PrintFinalPlan } from './portal-print-final-plan'
import type { PrintFinalBox } from './portal-print-final-measures'

/**
 * How much an Immersive face was deepened for contrast: the top scrim for the
 * brand (0 to 0.30, §6.3), and how far the photo melts into the ground (0 to
 * 0.60) from above the message, or from above the brand once the top scrim is
 * at its most and the brand still misses.
 */
export type PrintFinalBoost = Readonly<{
  top: number
  clear: number
  clearFrom: 'message' | 'brand'
}>

export const PRINT_FINAL_NO_BOOST: PrintFinalBoost = Object.freeze({
  top: 0,
  clear: 0,
  clearFrom: 'message',
})

/** The clearing starts this far above the message; wide, it ends this far below it. */
const CLEAR = Object.freeze({ abovePt: inPt(0.45), wideBelowPt: inPt(0.55) })

/** The span the clearing holds over: the message, with the brand when it clears from there. */
function clearSpan(
  plan: PrintFinalPlan,
  from: PrintFinalBoost['clearFrom'],
): Readonly<{ topPt: number; bottomPt: number }> | null {
  const { brand, message } = plan.groups
  const spans = (from === 'brand' ? [brand, message] : [message]).filter(
    (span) => span !== null,
  )
  if (spans.length === 0) return null
  return {
    topPt: Math.min(...spans.map((span) => span.topPt)),
    bottomPt: Math.max(...spans.map((span) => span.bottomPt)),
  }
}

/**
 * The photo melting further into the ground by the boost's clearing: from
 * 0.45 in above its span (the message, or the brand and the message) to the
 * span's top, then held to the photo's end upright (the fade takes it the rest
 * of the way, so nothing comes back lighter under the words); wide, out again
 * over 0.55 in below the span.
 */
export function printFinalClear(
  plan: PrintFinalPlan,
  boost: PrintFinalBoost,
): PrintFinalRamp | null {
  const span = clearSpan(plan, boost.clearFrom)
  if (span === null || boost.clear <= 0) return null
  const held = 1 - boost.clear
  const into = [
    { atPt: span.topPt - CLEAR.abovePt, alpha: 1 },
    { atPt: span.topPt, alpha: held },
  ]
  if (plan.face.orientation === 'upright') return { axis: 'y', stops: into }
  return {
    axis: 'y',
    stops: [
      ...into,
      { atPt: span.bottomPt, alpha: held },
      { atPt: span.bottomPt + CLEAR.wideBelowPt, alpha: 1 },
    ],
  }
}

const along = (ramp: PrintFinalRamp, x: number, y: number) =>
  rampAlpha(ramp, ramp.axis === 'x' ? x : y)

/** How much of the photo shows over the ground at a point: its fade times any clearing. */
export function printFinalPhotoAlpha(
  photo: Readonly<{ fade: PrintFinalRamp; clear: PrintFinalRamp | null }>,
  x: number,
  y: number,
): number {
  return along(photo.fade, x, y) * (photo.clear === null ? 1 : along(photo.clear, x, y))
}

type Scrim = Readonly<{ box: PrintFinalBox; ramps: readonly PrintFinalRamp[] }>

/** The scrims' ink alpha on the photo at a point, one scrim laid over another. */
export function printFinalScrimAlpha(
  scrims: readonly Scrim[],
  x: number,
  y: number,
): number {
  const through = scrims.reduce((left, { box, ramps }) => {
    const inside =
      x >= box.leftPt && x <= box.rightPt && y >= box.topPt && y <= box.bottomPt
    return inside ? left * (1 - layerAlpha(ramps, x, y)) : left
  }, 1)
  return 1 - through
}
