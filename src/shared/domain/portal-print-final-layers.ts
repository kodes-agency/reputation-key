// The layers an Immersive final face is painted from (final design spec §6.1
// and §6.6), as numbers the PDF and the Share tab's preview both draw: alphas
// that ramp along one axis, radial washes, and the bleed a face's art runs into.
// Each comes with what it is at a point, so the contrast check
// (`portal-print-final-contrast.ts`) reads the colours the face prints.

import type { PrintFinalImmersivePalette } from './portal-print-final-immersive'
import type { PrintFinalBox } from './portal-print-final-measures'

type Size = Readonly<{ widthPt: number; heightPt: number }>

/** How far a face's art runs past each trim edge: none for a lone piece, the bleed on a sheet or a print shop's page. */
export type PrintFinalBleed = Readonly<{
  leftPt: number
  topPt: number
  rightPt: number
  bottomPt: number
}>

export const PRINT_FINAL_NO_BLEED: PrintFinalBleed = Object.freeze({
  leftPt: 0,
  topPt: 0,
  rightPt: 0,
  bottomPt: 0,
})

/** An alpha that changes along one axis: linear between its stops (in points, ascending), held past the ends. */
export type PrintFinalRamp = Readonly<{
  axis: 'x' | 'y'
  stops: readonly Readonly<{ atPt: number; alpha: number }>[]
}>

/** A ramp's alpha at `pt` along its axis. */
export function rampAlpha(ramp: PrintFinalRamp, pt: number): number {
  const { stops } = ramp
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (first === undefined || last === undefined) return 1
  if (pt <= first.atPt) return first.alpha
  if (pt >= last.atPt) return last.alpha
  const upper = stops.findIndex((stop) => stop.atPt >= pt)
  const a = stops[upper - 1] ?? first
  const b = stops[upper] ?? last
  const span = b.atPt - a.atPt
  return span <= 0 ? b.alpha : a.alpha + ((pt - a.atPt) / span) * (b.alpha - a.alpha)
}

/** A layer's alpha at a point: the product of its ramps. */
export const layerAlpha = (
  ramps: readonly PrintFinalRamp[],
  x: number,
  y: number,
): number =>
  ramps.reduce((alpha, ramp) => alpha * rampAlpha(ramp, ramp.axis === 'x' ? x : y), 1)

/** A radial wash: its colour at `alpha` in the centre, gone at `fade` of its radii. */
export type PrintFinalWash = Readonly<{
  colour: string
  alpha: number
  xPt: number
  yPt: number
  rxPt: number
  ryPt: number
  fade: number
}>

export const box = (
  leftPt: number,
  topPt: number,
  rightPt: number,
  bottomPt: number,
): PrintFinalBox => ({
  leftPt,
  topPt,
  rightPt,
  bottomPt,
})

/** `inner` run into the bleed on each trim edge it reaches. */
export function intoBleed(
  inner: PrintFinalBox,
  plan: Size,
  bleed: PrintFinalBleed,
): PrintFinalBox {
  const near = 0.5
  return box(
    inner.leftPt <= near ? 0 - bleed.leftPt : inner.leftPt,
    inner.topPt <= near ? 0 - bleed.topPt : inner.topPt,
    inner.rightPt >= plan.widthPt - near ? plan.widthPt + bleed.rightPt : inner.rightPt,
    inner.bottomPt >= plan.heightPt - near
      ? plan.heightPt + bleed.bottomPt
      : inner.bottomPt,
  )
}

const farthestCorner = (plan: Size, x: number, y: number): number =>
  Math.hypot(Math.max(x, plan.widthPt - x), Math.max(y, plan.heightPt - y))

function circle(
  plan: Size,
  x: number,
  y: number,
  colour: string,
  alpha: number,
  fade: number,
): PrintFinalWash {
  const cx = x * plan.widthPt
  const cy = y * plan.heightPt
  const radius = farthestCorner(plan, cx, cy)
  return { colour, alpha, xPt: cx, yPt: cy, rxPt: radius, ryPt: radius, fade }
}

/** The washes: the guest page's two over a photo's ground; brighter ones and the accent's glow with no photo (§6.1, §6.6). */
export function printFinalWashes(
  plan: Size,
  palette: PrintFinalImmersivePalette,
  hasPhoto: boolean,
): PrintFinalWash[] {
  const { widthPt: w, heightPt: h } = plan
  if (hasPhoto) {
    return [
      {
        colour: palette.warm,
        alpha: 0.3,
        xPt: 0,
        yPt: h,
        rxPt: 0.72 * w,
        ryPt: 0.46 * h,
        fade: 0.72,
      },
      {
        colour: palette.cool,
        alpha: 0.3,
        xPt: w,
        yPt: 0.56 * h,
        rxPt: 0.64 * w,
        ryPt: 0.42 * h,
        fade: 0.72,
      },
    ]
  }
  return [
    circle(plan, 0.12, 0.88, palette.warm, 0.55, 0.52),
    circle(plan, 0.96, 0.4, palette.cool, 0.55, 0.48),
    circle(plan, 0.5, 0, palette.accentLine, 0.16, 0.6),
  ]
}

/** A wash's alpha at a point: its centre alpha fading linearly to none at `fade` of its radii. */
export function washAlpha(wash: PrintFinalWash, x: number, y: number): number {
  const reach = Math.hypot((x - wash.xPt) / wash.rxPt, (y - wash.yPt) / wash.ryPt)
  return reach >= wash.fade ? 0 : wash.alpha * (1 - reach / wash.fade)
}
