// The photo as an Immersive final print reads it (final design spec §6.1 and
// §6.3): decoded small, 240 px wide, and read for three things. The ground is
// the mean colour of its lower quarter, kept in hue, its saturation capped and
// its lightness lowered until white type clears 10.5:1, then mixed into the
// property's colour. The kicker is lightened against the photo's brightest
// middle under the scrim. And every word is measured against the pixels under
// it (`portal-print-final-contrast.ts`).
//
// Pure and shared: the PDF decodes the sample with `sharp`, the Share tab's
// preview with a canvas, and both hand the same three channels per pixel here,
// so the file and the preview paint the same ground.

import {
  fromHsl,
  hueSaturationOf,
  luminanceOfChannels,
  mixColour,
  parseHexColour,
} from './portal-field-colour'

/** The width a photo is decoded at to be read for its ground and kicker (§6.1). */
export const PRINT_FINAL_SAMPLE_WIDTH_PX = 240
/**
 * The width a photo is decoded at to be read under each word (§6.3), never
 * wider than the photo: fine enough that a pattern's highlights (a damask, lit
 * windows) count, as they did on the boards, which were measured on screen.
 */
export const PRINT_FINAL_DETAIL_WIDTH_PX = 960

export type PrintFinalRgb = readonly [number, number, number]

/** A photo decoded small: `widthPx` × `heightPx` pixels, three channels each (red, green, blue), row by row. */
export type PrintFinalPhotoSample = Readonly<{
  widthPx: number
  heightPx: number
  rgb: ArrayLike<number>
}>

/** The sample's pixel nearest to `x`, `y` (in sample pixels), clamped to its edges. */
export function samplePixel(
  sample: PrintFinalPhotoSample,
  x: number,
  y: number,
): PrintFinalRgb {
  const column = Math.min(sample.widthPx - 1, Math.max(0, Math.floor(x)))
  const row = Math.min(sample.heightPx - 1, Math.max(0, Math.floor(y)))
  const at = (row * sample.widthPx + column) * 3
  return [sample.rgb[at] ?? 0, sample.rgb[at + 1] ?? 0, sample.rgb[at + 2] ?? 0]
}

/** The mean colour of the sample's rows from `fromShare` of its height down. */
function meanOfRows(sample: PrintFinalPhotoSample, fromShare: number): PrintFinalRgb {
  const total = [0, 0, 0]
  let count = 0
  for (let row = Math.floor(sample.heightPx * fromShare); row < sample.heightPx; row++) {
    for (let column = 0; column < sample.widthPx; column++) {
      const pixel = samplePixel(sample, column, row)
      pixel.forEach((channel, index) => {
        total[index] = (total[index] ?? 0) + channel
      })
      count += 1
    }
  }
  const mean = (index: number) => (count === 0 ? 0 : (total[index] ?? 0) / count)
  return [mean(0), mean(1), mean(2)]
}

/** The ground's recipe (§6.1), the generator's numbers. */
const GROUND = Object.freeze({
  fromShare: 0.75,
  maxSaturation: 0.5,
  startLightness: 0.5,
  lightnessStep: 0.0025,
  maxSteps: 200,
  /** White type clears 10.5:1 on a ground this dark. */
  maxLuminance: 0.05,
  /** How much of the darkened photo colour goes into the property's colour. */
  photoShare: 0.6,
})

/**
 * The ground sampled from the photo: its lower quarter's mean colour, the hue
 * kept, the saturation capped at 0.5, the lightness lowered from 0.5 until the
 * luminance is 0.05 or less, mixed 60 % into `propertyColour`. Oakmere gives
 * #293143, Harborline #273246, Hotel Elegance #402D26.
 */
export function printFinalSampledGround(
  sample: PrintFinalPhotoSample,
  propertyColour: string,
): string {
  const { hue, saturation } = hueSaturationOf(meanOfRows(sample, GROUND.fromShare))
  const capped = Math.min(saturation, GROUND.maxSaturation)
  let lightness = GROUND.startLightness
  let dark = fromHsl(hue, capped, lightness)
  for (
    let step = 0;
    step < GROUND.maxSteps && luminanceOfHex(dark) > GROUND.maxLuminance;
    step++
  ) {
    lightness -= GROUND.lightnessStep
    dark = fromHsl(hue, capped, Math.max(0, lightness))
  }
  return mixColour(propertyColour, dark, GROUND.photoShare)
}

const luminanceOfHex = (hex: string): number =>
  luminanceOfChannels(parseHexColour(hex) ?? [0, 0, 0])

/** The ink of the scrims, rgba(6, 9, 8, a) (§6.3). */
export const PRINT_FINAL_SCRIM_INK: PrintFinalRgb = Object.freeze([
  6, 9, 8,
]) as PrintFinalRgb

/** The part of the photo the kicker is held against: 45 to 95 % down, 20 to 80 % across (§6.3). */
const KICKER_REGION = Object.freeze({ top: 0.45, bottom: 0.95, left: 0.2, right: 0.8 })
const KICKER_PERCENTILE = 0.95

/** A luminance as the 8-bit grey that has it. */
function greyOf(luminance: number): string {
  const encoded =
    luminance <= 0.003_130_8 ? 12.92 * luminance : 1.055 * luminance ** (1 / 2.4) - 0.055
  const channel = Math.round(Math.max(0, Math.min(1, encoded)) * 255)
  const hex = channel.toString(16).padStart(2, '0').toUpperCase()
  return `#${hex}${hex}${hex}`
}

/** `pixel` under the scrim ink at `alpha`. */
const underScrim = (pixel: PrintFinalRgb, alpha: number): PrintFinalRgb => [
  pixel[0] * (1 - alpha) + PRINT_FINAL_SCRIM_INK[0] * alpha,
  pixel[1] * (1 - alpha) + PRINT_FINAL_SCRIM_INK[1] * alpha,
  pixel[2] * (1 - alpha) + PRINT_FINAL_SCRIM_INK[2] * alpha,
]

/**
 * The kicker ground (§6.3): the 95th-percentile luminance of the photo's middle
 * under a scrim of `scrim`, as the grey that has it.
 */
export function printFinalKickerGround(
  sample: PrintFinalPhotoSample,
  scrim: number,
): string {
  const luminances: number[] = []
  const { widthPx, heightPx } = sample
  const rows = [
    Math.floor(heightPx * KICKER_REGION.top),
    Math.floor(heightPx * KICKER_REGION.bottom),
  ]
  const columns = [
    Math.floor(widthPx * KICKER_REGION.left),
    Math.floor(widthPx * KICKER_REGION.right),
  ]
  for (let row = rows[0] ?? 0; row < (rows[1] ?? 0); row++) {
    for (let column = columns[0] ?? 0; column < (columns[1] ?? 0); column++) {
      luminances.push(
        luminanceOfChannels(underScrim(samplePixel(sample, column, row), scrim)),
      )
    }
  }
  luminances.sort((a, b) => a - b)
  return greyOf(luminances[Math.floor(luminances.length * KICKER_PERCENTILE)] ?? 0)
}
