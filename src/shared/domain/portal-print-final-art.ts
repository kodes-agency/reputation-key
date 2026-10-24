// The art of an Immersive final face, treatment S (final design spec §6.2 to
// §6.6), copied from the generator that drew the boards (`final-engine.mjs`,
// layoutCard's art): what is painted under the words and the code, in order.
//
//   1. The ground, run into the bleed, and two washes over it.
//   2. The photo, cropped to cover its box with bleed, fading into the ground:
//      upright its lower 48 % fades downward; wide its right 48 % fades toward
//      the tile.
//   3. The scrims, ink rgba(6, 9, 8, a): one from the top trim to 0.5 in below
//      the brand, one round the message. Both deepen by `boost` (§6.3).
//   4. With no photo: brighter washes, and on an upright face the arch outline
//      round the brand and the words.
//   5. Film grain, and on a tent the pale strip at the fold, over everything.
//
// Every alpha is a ramp along one axis, in the face's points: the PDF draws a
// ramp as a soft mask and the Share tab's preview as a CSS gradient, from the
// same stops. Pure and shared.

import {
  PRINT_FINAL_DISTANCES,
  inPt,
  type PrintFinalBox,
} from './portal-print-final-measures'
import type { PrintFinalImmersivePalette } from './portal-print-final-immersive'
import { printFinalPhotoBox, type PrintFinalPhotoBox } from './portal-print-final-photo'
import type { PrintFinalPlan } from './portal-print-final-plan'
import {
  box,
  intoBleed,
  printFinalWashes,
  PRINT_FINAL_NO_BLEED,
  type PrintFinalBleed,
  type PrintFinalRamp,
  type PrintFinalWash,
} from './portal-print-final-layers'

export type PrintFinalScrim = Readonly<{
  box: PrintFinalBox
  ramps: readonly PrintFinalRamp[]
}>

export type PrintFinalPhotoArt = Readonly<{
  /** Where the photo shows: its box, run into the bleed on the trim edges it touches. */
  box: PrintFinalBox
  /** The box the photo is cropped to cover: its box with the bleed on every trim edge it touches, drawn or not. */
  cover: PrintFinalBox
  fade: PrintFinalRamp
  /** The photo box's cover size and the dpi rule's measures. */
  measure: PrintFinalPhotoBox
}>

export type PrintFinalArt = Readonly<{
  ground: string
  /** The trim with the bleed. */
  groundBox: PrintFinalBox
  washes: readonly PrintFinalWash[]
  photo: PrintFinalPhotoArt | null
  /** The top scrim, then the message scrim; none without a photo. */
  scrims: readonly PrintFinalScrim[]
  arch: Readonly<{
    box: PrintFinalBox
    colour: string
    opacity: number
    strokePt: number
  }> | null
  grainOpacity: number
  foldStrip: Readonly<{ box: PrintFinalBox; colour: string }> | null
}>

/** The generator's numbers (§6.2, §6.3, §6.6). */
const ART = Object.freeze({
  fadeShare: 0.48,
  topScrim: Object.freeze({
    belowBrandPt: inPt(0.5),
    alphas: [0.5, 0.4] as const,
    middle: 0.45,
  }),
  uprightScrim: Object.freeze({
    abovePt: inPt(0.45),
    belowPt: inPt(0.35),
    alpha: 0.5,
    alphaTwo: 0.56,
  }),
  wideScrim: Object.freeze({
    abovePt: inPt(0.55),
    belowPt: inPt(0.55),
    pastColumnPt: inPt(0.7),
    alpha: 0.66,
    alphaTwo: 0.7,
  }),
  maxScrim: 0.9,
  grain: Object.freeze({ photo: 0.05, none: 0.04 }),
  arch: Object.freeze({
    left: 0.19,
    right: 0.81,
    abovePt: inPt(0.08),
    aboveCodePt: inPt(0.12),
    opacity: 0.42,
    strokePt: 0.45,
  }),
})

/** The region's bleed on every edge: what the photo is cropped to cover, drawn or not (§6.2). */
function regionBleed(plan: PrintFinalPlan): PrintFinalBleed {
  const amount = PRINT_FINAL_DISTANCES.bleedPt[plan.face.region]
  return { leftPt: amount, topPt: amount, rightPt: amount, bottomPt: amount }
}

/**
 * The photo: shown in its box run into the drawn bleed, cropped to cover its
 * box with the full bleed on each trim edge it touches (a tent's top is its
 * fold strip, not a trim edge it touches), fading over 48 % of its reach.
 */
function photoOf(plan: PrintFinalPlan, bleed: PrintFinalBleed): PrintFinalPhotoArt {
  const measure = printFinalPhotoBox(plan)
  const shown = measure.box
  const upright = plan.face.orientation === 'upright'
  const end = upright ? shown.bottomPt : shown.rightPt
  const fade = ART.fadeShare * end
  return {
    box: intoBleed(shown, plan, bleed),
    cover: intoBleed(shown, plan, regionBleed(plan)),
    fade: {
      axis: upright ? 'y' : 'x',
      stops: [
        { atPt: end - fade, alpha: 1 },
        { atPt: end - fade / 2, alpha: 0.5 },
        { atPt: end, alpha: 0 },
      ],
    },
    measure,
  }
}

function scrimsOf(
  plan: PrintFinalPlan,
  bleed: PrintFinalBleed,
  boost: number,
  languageCount: number,
): PrintFinalScrim[] {
  const two = languageCount > 1
  const { brand, message } = plan.groups
  const topEnd = (brand?.bottomPt ?? plan.live.topPt) + ART.topScrim.belowBrandPt
  const [first, second] = ART.topScrim.alphas
  const top: PrintFinalScrim = {
    box: intoBleed(box(0, 0, plan.widthPt, topEnd), plan, bleed),
    ramps: [
      {
        axis: 'y',
        stops: [
          { atPt: 0, alpha: first + boost },
          { atPt: ART.topScrim.middle * topEnd, alpha: second + boost },
          { atPt: topEnd, alpha: 0 },
        ],
      },
    ],
  }
  if (message === null) return [top]
  const wide = plan.face.orientation === 'wide'
  const shape = wide ? ART.wideScrim : ART.uprightScrim
  const alpha = Math.min(ART.maxScrim, (two ? shape.alphaTwo : shape.alpha) + boost)
  const start = message.topPt - shape.abovePt
  const end = message.bottomPt + shape.belowPt
  const down: PrintFinalRamp = {
    axis: 'y',
    stops: [
      { atPt: start, alpha: 0 },
      { atPt: message.topPt, alpha },
      { atPt: message.bottomPt, alpha },
      { atPt: end, alpha: 0 },
    ],
  }
  if (!wide)
    return [
      top,
      { box: intoBleed(box(0, start, plan.widthPt, end), plan, bleed), ramps: [down] },
    ]
  const right = plan.column.rightPt + ART.wideScrim.pastColumnPt
  const across: PrintFinalRamp = {
    axis: 'x',
    stops: [
      { atPt: right - ART.wideScrim.pastColumnPt, alpha: 1 },
      { atPt: right, alpha: 0 },
    ],
  }
  return [
    top,
    { box: intoBleed(box(0, start, right, end), plan, bleed), ramps: [down, across] },
  ]
}

function archOf(
  plan: PrintFinalPlan,
  palette: PrintFinalImmersivePalette,
): PrintFinalArt['arch'] {
  if (plan.face.orientation !== 'upright') return null
  const top = (plan.groups.brand?.topPt ?? plan.live.topPt) - ART.arch.abovePt
  return {
    box: box(
      ART.arch.left * plan.widthPt,
      top,
      ART.arch.right * plan.widthPt,
      plan.code.topPt - ART.arch.aboveCodePt,
    ),
    colour: palette.accentLine,
    opacity: ART.arch.opacity,
    strokePt: ART.arch.strokePt,
  }
}

export type PrintFinalArtInput = Readonly<{
  plan: PrintFinalPlan
  palette: PrintFinalImmersivePalette
  hasPhoto: boolean
  languageCount: number
  /** How much the scrims were deepened to keep every word at 4.5:1 (§6.3): 0 to 0.30. */
  boost: number
  bleed?: PrintFinalBleed
}>

/** The art under an Immersive face. */
export function printFinalArt(input: PrintFinalArtInput): PrintFinalArt {
  const { plan, palette, hasPhoto } = input
  const bleed = input.bleed ?? PRINT_FINAL_NO_BLEED
  const strip = plan.foldStripPt
  return {
    ground: palette.ground,
    groundBox: intoBleed(box(0, 0, plan.widthPt, plan.heightPt), plan, bleed),
    washes: printFinalWashes(plan, palette, hasPhoto),
    photo: hasPhoto ? photoOf(plan, bleed) : null,
    scrims: hasPhoto ? scrimsOf(plan, bleed, input.boost, input.languageCount) : [],
    arch: hasPhoto ? null : archOf(plan, palette),
    grainOpacity: hasPhoto ? ART.grain.photo : ART.grain.none,
    foldStrip:
      strip > 0
        ? {
            box: intoBleed(box(0, 0, plan.widthPt, strip), plan, { ...bleed, topPt: 0 }),
            colour: palette.foldStrip,
          }
        : null,
  }
}
