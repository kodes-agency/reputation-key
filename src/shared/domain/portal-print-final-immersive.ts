// The colours of an Immersive final face (final design spec §6.1, §6.3, §6.5
// and §6.6): the ground sampled from the photo (or the property's own field
// when there is none), held under the ground ink cap; the guest page's two
// washes over it; the kicker tint lightened against the brighter of the ground
// and the photo's middle under the scrim; the accent line of the no-photo
// arch; the pale strip at a tent's fold; and the code bar, as on Paper.
//
// Pure and shared: the PDF and the Share tab's preview paint the same colours.

import {
  contrastRatio,
  deriveBackdropTones,
  deriveFieldColour,
  fromHsl,
  hueSaturationOf,
  mixColour,
  nudgeLightness,
  parseHexColour,
  relativeLuminance,
} from './portal-field-colour'
import type { PrintFinalOrientation } from './portal-print-final'
import {
  printFinalKickerGround,
  printFinalSampledGround,
  type PrintFinalPhotoSample,
} from './portal-print-final-photo-sample'
import {
  PRINT_KIT_INK,
  PRINT_KIT_TILE,
  paperPrintKitPalette,
} from './portal-print-kit-palette'

const WHITE = '#FFFFFF'

/** The Immersive type colours (§3): white headlines and the guest page's warm off-white sub-lines. */
export const PRINT_FINAL_IMMERSIVE_TYPE = Object.freeze({
  headline: WHITE,
  soft: '#F6F1E8',
})

/**
 * The kicker is held against the photo under a scrim of this strength (§6.3):
 * 0.50 upright, 0.56 upright with two languages, 0.56 wide.
 */
const KICKER_SCRIM = Object.freeze({ upright: 0.5, uprightTwo: 0.56, wide: 0.56 })
/** The kicker starts as the accent with this much white in it. */
const KICKER_WHITE_SHARE = 0.12
const KICKER_CONTRAST = 4.5
const ACCENT_LINE_CONTRAST = 3
/** The tent's fold strip: the ground mixed this far into the cream (§6.5). */
const FOLD_STRIP_GROUND_SHARE = 0.1

/**
 * The ground ink cap (§6.1): the most total ink the ground may ask of a printer,
 * as the sum of its three process inks read straight from its channels (cyan
 * 1 − red, and so on), 300 % being black. A ground darker than this is lifted
 * in lightness until it is not. The proxy only orders grounds by weight; the
 * real print test (slice 8) decides the number. Every sampled ground on the
 * boards sits near 240 %, under it: only a near-black property field is lifted.
 */
export const PRINT_FINAL_GROUND_INK_CAP = 2.6
const INK_CAP_LIGHTNESS_STEP = 0.0025

/** The ground's total ink, as the cap reads it: 0 for white, 3 for black. */
export function printFinalTotalInk(colour: string): number {
  const channels = parseHexColour(colour) ?? [0, 0, 0]
  return channels.reduce((total, channel) => total + (255 - channel) / 255, 0)
}

/** `colour` lifted in lightness, hue and saturation kept, until its total ink is at the cap or under. */
export function capGroundInk(colour: string): string {
  const channels = parseHexColour(colour)
  if (channels === null || printFinalTotalInk(colour) <= PRINT_FINAL_GROUND_INK_CAP) {
    return colour.toUpperCase()
  }
  const { hue, saturation } = hueSaturationOf(channels)
  let lightness = (Math.max(...channels) + Math.min(...channels)) / 2 / 255
  let lifted = fromHsl(hue, saturation, lightness)
  while (printFinalTotalInk(lifted) > PRINT_FINAL_GROUND_INK_CAP && lightness < 1) {
    lightness = Math.min(1, lightness + INK_CAP_LIGHTNESS_STEP)
    lifted = fromHsl(hue, saturation, lightness)
  }
  return lifted
}

export type PrintFinalImmersivePalette = Readonly<{
  ground: string
  /** The guest page's washes, bounded so its body text keeps 4.6:1 on them. */
  warm: string
  cool: string
  /** The accent at 3:1 on the ground: the no-photo glow and arch. */
  accentLine: string
  /** The kicker, the stars and the rule between two languages. */
  kicker: string
  /** What the kicker was held against: the brighter of the ground and the photo's middle under the scrim. */
  kickerGround: string
  /** The pale low-ink strip at a tent's fold. */
  foldStrip: string
  barFill: string
  barText: string
}>

export type PrintFinalImmersivePaletteInput = Readonly<{
  accentColour: string
  /** The property's field colour: the colour the photo's is mixed into, and the ground with no photo. */
  fieldColour: string
  sample: PrintFinalPhotoSample | null
  orientation: PrintFinalOrientation
  languageCount: number
}>

/** An accent the print can read, upper case; ink for one it cannot. */
const usable = (colour: string, fallback: string): string =>
  parseHexColour(colour) ? colour.toUpperCase() : fallback

function kickerScrim(orientation: PrintFinalOrientation, languageCount: number): number {
  if (orientation === 'wide') return KICKER_SCRIM.wide
  return languageCount > 1 ? KICKER_SCRIM.uprightTwo : KICKER_SCRIM.upright
}

/**
 * The kicker tint (§6.3): the accent with 12 % white, lightened until it reaches
 * 4.5:1 against `against`; white when the accent cannot.
 */
export function printFinalKickerTint(accent: string, against: string): string {
  const tint = nudgeLightness(
    mixColour(accent, WHITE, KICKER_WHITE_SHARE),
    against,
    KICKER_CONTRAST,
    1,
  )
  return (contrastRatio(tint, against) ?? 0) < KICKER_CONTRAST ? WHITE : tint
}

const brighterOf = (first: string, second: string): string =>
  (relativeLuminance(first) ?? 0) > (relativeLuminance(second) ?? 0) ? first : second

/** The Immersive palette of one face. */
export function printFinalImmersivePalette(
  input: PrintFinalImmersivePaletteInput,
): PrintFinalImmersivePalette {
  const accent = usable(input.accentColour, PRINT_KIT_INK)
  const field = usable(input.fieldColour, deriveFieldColour(accent) ?? PRINT_KIT_INK)
  const { sample } = input
  const ground = capGroundInk(
    sample === null ? field : printFinalSampledGround(sample, field),
  )
  const tones = deriveBackdropTones(accent, ground)
  const kickerGround =
    sample === null
      ? ground
      : brighterOf(
          printFinalKickerGround(
            sample,
            kickerScrim(input.orientation, input.languageCount),
          ),
          ground,
        )
  const { barFill, barText } = paperPrintKitPalette(accent)
  return {
    ground,
    warm: tones?.warm ?? ground,
    cool: tones?.cool ?? ground,
    accentLine: nudgeLightness(accent, ground, ACCENT_LINE_CONTRAST, 1),
    kicker: printFinalKickerTint(accent, kickerGround),
    kickerGround,
    foldStrip: mixColour(PRINT_KIT_TILE, ground, FOLD_STRIP_GROUND_SHARE),
    barFill,
    barText,
  }
}
