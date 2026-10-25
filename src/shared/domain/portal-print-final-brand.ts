// The brand at the top of a final print (final design spec §4): the logo's
// optical size, the cream plate an Immersive face puts under any logo that is
// not light, and the plate's padding. The logo is measured by its drawn pixels,
// so its transparent padding never counts: `inkWidth` and `inkHeight` are the
// bounds of the pixels that print.

import { luminanceOfChannels } from './portal-field-colour'
import type { PrintFinalLook, PrintFinalPiece } from './portal-print-final'
import { mmPt } from './portal-print-final-measures'

/** The optical size rule's inputs for one piece and look, in millimetres. */
type LogoSizeMm = Readonly<{ g: number; hMax: number; hMin: number; wMax: number }>

const LOGO_SIZE_MM: Readonly<
  Record<PrintFinalPiece, Readonly<Record<PrintFinalLook, LogoSizeMm>>>
> = {
  counter: {
    paper: { g: 17, hMax: 14, hMin: 10.5, wMax: 38 },
    immersive: { g: 15, hMax: 13, hMin: 9.5, wMax: 34 },
  },
  tent: {
    paper: { g: 11, hMax: 9.5, hMin: 7, wMax: 30 },
    immersive: { g: 10, hMax: 8.5, hMin: 6.5, wMax: 26 },
  },
  small: {
    paper: { g: 9, hMax: 7.5, hMin: 6, wMax: 22 },
    immersive: { g: 8, hMax: 7, hMin: 5.5, wMax: 20 },
  },
}

/** The plate's padding round the logo, vertical and horizontal (§4). */
const PLATE_PADDING_MM: Readonly<
  Record<PrintFinalPiece, Readonly<{ v: number; h: number }>>
> = {
  counter: { v: 2, h: 3 },
  tent: { v: 1.3, h: 2 },
  small: { v: 1, h: 1.6 },
}

export const PRINT_FINAL_PLATE = Object.freeze({
  radiusPt: mmPt(1.4),
  /** A light logo has a median ink luminance of at least this... */
  lightLogoLuminance: 0.4,
  /** ...and reaches this contrast against a 1.5 mm ring round it on the photo. */
  lightLogoContrast: 4.5,
  ringPt: mmPt(1.5),
})

export type PrintFinalLogoInk = Readonly<{ inkWidth: number; inkHeight: number }>

export type PrintFinalLogoSize = Readonly<{ widthPt: number; heightPt: number }>

/**
 * The logo's printed size: height = clamp(g / √aspect, hMin, hMax), then capped
 * so the width stays within wMax. A wide logo gets lower, a tall one taller,
 * and both read about as large.
 */
export function printFinalLogoSize(
  piece: PrintFinalPiece,
  look: PrintFinalLook,
  logo: PrintFinalLogoInk,
): PrintFinalLogoSize {
  const size = LOGO_SIZE_MM[piece][look]
  const aspect = logo.inkWidth / logo.inkHeight
  const heightMm = Math.min(
    size.hMax,
    Math.max(size.hMin, size.g / Math.sqrt(aspect)),
    size.wMax / aspect,
  )
  return { widthPt: mmPt(heightMm * aspect), heightPt: mmPt(heightMm) }
}

export type PrintFinalLogoTone = Readonly<{
  /** The median luminance of the logo's printed pixels, 0 to 1. */
  medianInkLuminance: number
  /** Its contrast against a 1.5 mm ring round it on the photo, when that has been measured. */
  ringContrast: number | null
}>

/**
 * Whether an Immersive face puts the logo on the cream plate: always, unless the
 * logo is light (median ink luminance 0.4 or more) and reaches 4.5:1 against the
 * ring round it. A logo whose ring has not been measured gets the plate. Paper
 * never uses a plate: the logo sits bare on the paper.
 */
export function printFinalLogoOnPlate(
  look: PrintFinalLook,
  tone: PrintFinalLogoTone,
): boolean {
  if (look === 'paper') return false
  const light =
    tone.medianInkLuminance >= PRINT_FINAL_PLATE.lightLogoLuminance &&
    tone.ringContrast !== null &&
    tone.ringContrast >= PRINT_FINAL_PLATE.lightLogoContrast
  return !light
}

export type PrintFinalBrandBox = Readonly<{
  logo: PrintFinalLogoSize
  /** The plate's padding, zero without a plate. */
  paddingPt: Readonly<{ v: number; h: number }>
  /** What the planner places: the plate with the logo on it, or the bare logo. */
  widthPt: number
  heightPt: number
}>

/** The brand's box: the logo at its optical size, on its plate when it has one. */
export function printFinalBrandBox(
  piece: PrintFinalPiece,
  look: PrintFinalLook,
  logo: PrintFinalLogoInk,
  onPlate: boolean,
): PrintFinalBrandBox {
  const size = printFinalLogoSize(piece, look, logo)
  const padding = PLATE_PADDING_MM[piece]
  const paddingPt = onPlate ? { v: mmPt(padding.v), h: mmPt(padding.h) } : { v: 0, h: 0 }
  return {
    logo: size,
    paddingPt,
    widthPt: size.widthPt + 2 * paddingPt.h,
    heightPt: size.heightPt + 2 * paddingPt.v,
  }
}

/** A pixel this opaque or more is part of the logo's drawing when its tone is read. */
const TONE_ALPHA = 128
/** A logo is read at most this many pixels across and down for its tone. */
export const PRINT_FINAL_LOGO_TONE_SIZE_PX = 200

/**
 * The median luminance of a logo's drawn pixels (those more than half opaque),
 * read from its pixels decoded at most 200 px across and down: what the plate
 * rule calls light at 0.4 or more. Null for an image with nothing drawn.
 */
export function printFinalMedianInkLuminance(
  pixels: ArrayLike<number>,
  size: Readonly<{ width: number; height: number; channels: number }>,
): number | null {
  const { width, height, channels } = size
  const luminances: number[] = []
  for (let at = 0; at < width * height * channels; at += channels) {
    const alpha = channels === 4 ? (pixels[at + 3] ?? 0) : 255
    if (alpha <= TONE_ALPHA) continue
    luminances.push(
      luminanceOfChannels([pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0]),
    )
  }
  if (luminances.length === 0) return null
  luminances.sort((a, b) => a - b)
  return luminances[Math.floor(luminances.length / 2)] ?? null
}
