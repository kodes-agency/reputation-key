// What an Immersive final face's words read against (final design spec §6.3
// and §4): the colour the face prints under each word, from the ground, the
// washes, the photo's own pixels as the face crops and fades them, and the
// scrims, with the words left out. Every word must reach 4.5:1 against the
// 95th-percentile brightness under it; a light logo straight on the photo must
// reach 4.5:1 against a 1.5 mm ring round it.
//
// The photo is read from its 240 px sample, the same sample the ground comes
// from, at a point every half millimetre across the word's ink box. Pure and
// shared, so the file and the preview deepen their scrims alike.

import { luminanceOfChannels, parseHexColour } from './portal-field-colour'
import type { PrintFinalArt } from './portal-print-final-art'
import {
  printFinalPhotoCrop,
  type PrintFinalFocal,
  type PrintFinalFraming,
} from './portal-print-final-framing'
import { layerAlpha, rampAlpha, washAlpha } from './portal-print-final-layers'
import { mmPt, type PrintFinalBox } from './portal-print-final-measures'
import type { PrintFinalPhotoPixels } from './portal-print-final-photo'
import {
  PRINT_FINAL_SCRIM_INK,
  samplePixel,
  type PrintFinalPhotoSample,
  type PrintFinalRgb,
} from './portal-print-final-photo-sample'

/** The photo as a face shows it: its sample, its own size, where it is centred and how the manager framed it. */
export type PrintFinalScenePhoto = Readonly<{
  sample: PrintFinalPhotoSample
  pixels: PrintFinalPhotoPixels
  focal: PrintFinalFocal
  framing: PrintFinalFraming
}>

/** A point every this far across a word's box is read. */
const READ_STEP_PT = mmPt(0.5)
const PERCENTILE = Object.freeze({ high: 0.95, low: 0.05 })
/** The ring round a logo that sits straight on the photo (§4). */
const LOGO_RING_PT = mmPt(1.5)

const rgbOf = (hex: string): PrintFinalRgb => parseHexColour(hex) ?? [0, 0, 0]

const over = (under: PrintFinalRgb, top: PrintFinalRgb, alpha: number): PrintFinalRgb => [
  under[0] + (top[0] - under[0]) * alpha,
  under[1] + (top[1] - under[1]) * alpha,
  under[2] + (top[2] - under[2]) * alpha,
]

const inside = (box: PrintFinalBox, x: number, y: number) =>
  x >= box.leftPt && x <= box.rightPt && y >= box.topPt && y <= box.bottomPt

/** The face's art, ready to be read at any point. */
export type PrintFinalScene = Readonly<{
  colourAt: (x: number, y: number) => PrintFinalRgb
}>

function photoReader(art: PrintFinalArt, photo: PrintFinalScenePhoto | null) {
  const shown = art.photo
  if (shown === null || photo === null) return null
  const { cover } = shown
  const coverWidth = cover.rightPt - cover.leftPt
  const coverHeight = cover.bottomPt - cover.topPt
  const crop = printFinalPhotoCrop(
    photo.pixels,
    { widthPt: coverWidth, heightPt: coverHeight },
    photo.focal,
    photo.framing,
  )
  const across = photo.sample.widthPx / photo.pixels.widthPx
  const down = photo.sample.heightPx / photo.pixels.heightPx
  return (
    x: number,
    y: number,
  ): Readonly<{ rgb: PrintFinalRgb; alpha: number }> | null => {
    if (!inside(shown.box, x, y)) return null
    const sourceX = crop.leftPx + ((x - cover.leftPt) / coverWidth) * crop.widthPx
    const sourceY = crop.topPx + ((y - cover.topPt) / coverHeight) * crop.heightPx
    return {
      rgb: samplePixel(photo.sample, sourceX * across, sourceY * down),
      alpha: rampAlpha(shown.fade, shown.fade.axis === 'x' ? x : y),
    }
  }
}

/** The colour the face's art prints at a point (the grain left out). */
export function printFinalScene(
  art: PrintFinalArt,
  photo: PrintFinalScenePhoto | null,
): PrintFinalScene {
  const ground = rgbOf(art.ground)
  const washes = art.washes.map((wash) => ({ wash, rgb: rgbOf(wash.colour) }))
  const readPhoto = photoReader(art, photo)
  return {
    colourAt: (x, y) => {
      let colour = washes.reduce(
        (under, { wash, rgb }) => over(under, rgb, washAlpha(wash, x, y)),
        ground,
      )
      const pixel = readPhoto?.(x, y) ?? null
      if (pixel !== null) colour = over(colour, pixel.rgb, pixel.alpha)
      for (const scrim of art.scrims) {
        if (inside(scrim.box, x, y)) {
          colour = over(colour, PRINT_FINAL_SCRIM_INK, layerAlpha(scrim.ramps, x, y))
        }
      }
      return colour
    },
  }
}

/** Points every half millimetre over a box, its edges included. */
function pointsOver(box: PrintFinalBox): readonly (readonly [number, number])[] {
  const across = Math.max(1, Math.ceil((box.rightPt - box.leftPt) / READ_STEP_PT))
  const down = Math.max(1, Math.ceil((box.bottomPt - box.topPt) / READ_STEP_PT))
  const points: (readonly [number, number])[] = []
  for (let i = 0; i <= across; i++) {
    for (let j = 0; j <= down; j++) {
      points.push([
        box.leftPt + ((box.rightPt - box.leftPt) * i) / across,
        box.topPt + ((box.bottomPt - box.topPt) * j) / down,
      ])
    }
  }
  return points
}

/** The contrast of a colour of luminance `lit` against what lies under it: the 95th percentile when it is lighter than most, else the 5th. */
function contrastAgainst(luminances: number[], lit: number): number {
  luminances.sort((a, b) => a - b)
  const at = (share: number) => luminances[Math.floor(luminances.length * share)] ?? 0
  const median = at(0.5)
  return lit > median
    ? (lit + 0.05) / (at(PERCENTILE.high) + 0.05)
    : (at(PERCENTILE.low) + 0.05) / (lit + 0.05)
}

const luminanceAt = (scene: PrintFinalScene, x: number, y: number) =>
  luminanceOfChannels(scene.colourAt(x, y))

/** A word's contrast against the face under its ink box (§6.3). */
export function printFinalTextContrast(
  scene: PrintFinalScene,
  box: PrintFinalBox,
  colour: string,
): number {
  const lit = luminanceOfChannels(rgbOf(colour))
  return contrastAgainst(
    pointsOver(box).map(([x, y]) => luminanceAt(scene, x, y)),
    lit,
  )
}

/** A bare logo's contrast against a 1.5 mm ring round its box, inside the trim (§4). */
export function printFinalRingContrast(
  scene: PrintFinalScene,
  logo: PrintFinalBox,
  trim: Readonly<{ widthPt: number; heightPt: number }>,
  medianInkLuminance: number,
): number {
  const ring: PrintFinalBox = {
    leftPt: Math.max(0, logo.leftPt - LOGO_RING_PT),
    topPt: Math.max(0, logo.topPt - LOGO_RING_PT),
    rightPt: Math.min(trim.widthPt, logo.rightPt + LOGO_RING_PT),
    bottomPt: Math.min(trim.heightPt, logo.bottomPt + LOGO_RING_PT),
  }
  const luminances = pointsOver(ring)
    .filter(([x, y]) => !inside(logo, x, y))
    .map(([x, y]) => luminanceAt(scene, x, y))
  return contrastAgainst(luminances, medianInkLuminance)
}
