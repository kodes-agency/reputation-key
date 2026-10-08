// The geometry that keeps the page's top legible over any photo.
//
// The sharp hero photo is not darkened, so the wordmark and the title's kicker
// that sit on it have only what is painted over it to read against: a fade of
// the photo into the field and two scrims. This file is the one home of those
// numbers. The stylesheet is built from them (`immersive-styles.ts`) and
// `immersive-hero-scrim.test.ts` composites the worst photo a manager can
// upload, a white one, through the same stops and holds AA on the text, so the
// page cannot promise more than the paint delivers.
//
// All three layers are measured from an edge, not as a share of the hero's
// height, because the hero grows on a wide screen (`HERO_HEIGHT`) while the
// text on it does not: the header stays at the top and the title block stays
// the same distance above the hero's bottom edge.

/** A point of a gradient: how far from its edge, in px, and the alpha there. */
export type ScrimStop = readonly [distance: number, alpha: number]

/** The scrim's ink: the page's near-black, so a scrim darkens without tinting. */
export const HERO_SCRIM_RGB = [6, 9, 8] as const

/** The hero's height on a phone, and the least it is anywhere. */
export const HERO_PHONE_HEIGHT = 236
/**
 * From `sm` up the hero grows with the viewport, so a photo is not cropped to a
 * thin strip on a tablet or laptop: 34% of the width, never under 300 px and
 * never over 440 px. It only grows on a page that has a photo; the arch of the
 * no-photo page is drawn at one size.
 */
export const HERO_WIDE = {
  minWidth: 640,
  minHeight: 300,
  vw: 34,
  maxHeight: 440,
} as const
/**
 * The title block's top margin is the hero's height less this, so the title sits
 * the same distance above the hero's bottom edge at every height: 78 px of
 * margin under the 64 px header on a phone.
 */
export const HERO_TITLE_CLEARANCE = 158

/**
 * Where the text sits on the hero, for the checks: the wordmark's line, in px
 * from the hero's top; the kicker's line and the first line of the name, in px
 * up from its bottom edge.
 */
export const HERO_TEXT_BANDS = {
  wordmark: { from: 22, to: 42 },
  kicker: { from: 80, to: 94 },
  name: { from: 28, to: 74 },
} as const

/** The photo's own opacity, by distance up from the hero's bottom edge: it fades into the field. */
export const HERO_PHOTO_MASK: readonly ScrimStop[] = [
  [0, 0],
  [57, 0.5],
  [113, 1],
]

/** Behind the header, by distance down from the top edge. */
export const HERO_TOP_SCRIM: readonly ScrimStop[] = [
  [0, 0.64],
  [48, 0.6],
  [118, 0],
]

/** Behind the title block, by distance up from the bottom edge. */
export const HERO_TITLE_SCRIM: readonly ScrimStop[] = [
  [0, 0],
  [30, 0.2],
  [70, 0.5],
  [82, 0.75],
  [98, 0.75],
  [150, 0],
]

/**
 * How far from the page's centre line the title scrim is solid, and where it has
 * faded away: wider than the 30rem (480 px) column the title sits in, so every
 * word of it has the full scrim behind it, and a wide screen gets a pool of
 * shade behind the title instead of a stripe across the whole photo.
 */
export const HERO_TITLE_SCRIM_HALF_WIDTH = { solid: 300, gone: 560 } as const

/** The alpha of a scrim at `distance`, interpolating between its stops and holding the ends. */
export function scrimAlphaAt(stops: readonly ScrimStop[], distance: number): number {
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!first || !last) return 0
  if (distance <= first[0]) return first[1]
  if (distance >= last[0]) return last[1]
  for (let index = 1; index < stops.length; index++) {
    const [from, fromAlpha] = stops[index - 1] as ScrimStop
    const [to, toAlpha] = stops[index] as ScrimStop
    if (distance <= to)
      return fromAlpha + ((toAlpha - fromAlpha) * (distance - from)) / (to - from)
  }
  return last[1]
}

/** How far a scrim reaches from its edge. */
export const scrimReach = (stops: readonly ScrimStop[]) =>
  (stops[stops.length - 1] as ScrimStop)[0]

/**
 * A CSS `linear-gradient` of the stops, in the scrim's ink. `fromTop` measures
 * the distance down from the top edge; otherwise it is measured up from the bottom.
 */
export function scrimGradient(stops: readonly ScrimStop[], fromTop: boolean): string {
  const ink = HERO_SCRIM_RGB.join(', ')
  const parts = stops.map(([distance, alpha]) => `rgba(${ink}, ${alpha}) ${distance}px`)
  return `linear-gradient(${fromTop ? '180deg' : '0deg'}, ${parts.join(', ')})`
}

/** The photo's mask as a CSS `linear-gradient`: black is the photo, transparent is the field. */
export function photoMaskGradient(stops: readonly ScrimStop[] = HERO_PHOTO_MASK): string {
  const parts = stops.map(([distance, alpha]) => `rgba(0, 0, 0, ${alpha}) ${distance}px`)
  return `linear-gradient(0deg, ${parts.join(', ')})`
}

type Rgb = readonly [number, number, number]

const mix = (top: Rgb, alpha: number, base: Rgb): Rgb => [
  alpha * top[0] + (1 - alpha) * base[0],
  alpha * top[1] + (1 - alpha) * base[1],
  alpha * top[2] + (1 - alpha) * base[2],
]

const toHex = (rgb: Rgb) =>
  `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`

/**
 * What a text on the hero is read against at one point, for a photo as bright
 * as it can be: the photo through its mask over `backdrop`, then both scrims.
 * `y` is the distance down from the hero's top edge, and the hero is `height`
 * tall. sRGB source-over, like the browser.
 */
export function heroBackgroundAt(
  y: number,
  backdrop: readonly [number, number, number],
  height: number = HERO_PHONE_HEIGHT,
): string {
  const fromBottom = height - y
  const white: Rgb = [255, 255, 255]
  const ink = HERO_SCRIM_RGB as unknown as Rgb
  const photo = mix(white, scrimAlphaAt(HERO_PHOTO_MASK, fromBottom), backdrop)
  const beneathTitle = mix(ink, scrimAlphaAt(HERO_TOP_SCRIM, y), photo)
  return toHex(mix(ink, scrimAlphaAt(HERO_TITLE_SCRIM, fromBottom), beneathTitle))
}

/**
 * Every colour a text of `band` can sit on over a white photo, one per pixel
 * row of the band, for contrast checks. The wordmark's band is measured from
 * the top edge, the other two up from the bottom.
 */
export function heroBackgroundsOf(
  band: keyof typeof HERO_TEXT_BANDS,
  backdrop: readonly [number, number, number],
  height: number = HERO_PHONE_HEIGHT,
): string[] {
  const { from, to } = HERO_TEXT_BANDS[band]
  const colours: string[] = []
  for (let distance = from; distance <= to; distance++) {
    const y = band === 'wordmark' ? distance : height - distance
    colours.push(heroBackgroundAt(y, backdrop, height))
  }
  return colours
}
