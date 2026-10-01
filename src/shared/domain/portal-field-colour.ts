// Colour arithmetic for the Portal look: WCAG contrast, the readable foreground
// on a brand colour, and the dark "field" a guest page is painted on, derived
// from the Property's accent colour.
//
// Pure and shared, because three places must agree to the digit: the Brand
// Profile writer (which refuses unreadable text), the guest page theme (which
// picks a button's foreground) and the publication builder (which writes the
// derived field into the snapshot). It replaces the two contrast
// implementations those places used to carry.

/** WCAG 2.x AA for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5

/** Body text of the Immersive Hub on its field. Headings are white; this is the warm off-white of the board. */
export const IMMERSIVE_TEXT_COLOUR = '#F6F1E8'
/**
 * Light text must clear this on the field. AAA for normal text, because the
 * quietest text on the page (the visit notice) is drawn at two-thirds opacity
 * and still has to reach AA.
 */
export const MIN_FIELD_TEXT_CONTRAST = 7

/** The field is always this dark: light text clears AAA on it whatever the accent. */
const FIELD_LIGHTNESS = 0.07
/** The accent's hue shows through the field, but only as a tint, never a colour wash. */
const FIELD_MAX_SATURATION = 0.22

// The two foreground candidates are the EXTREMES, not the portal's own text
// colours: this choice exists to be legible on an arbitrary brand colour, and
// the extremes maximise contrast. The default indigo (#6366F1) reaches 4.47:1
// with white (below AA) and 4.70:1 with black.
const DARK_FOREGROUND = '#000000'
const LIGHT_FOREGROUND = '#ffffff'

type Rgb = readonly [number, number, number]

/**
 * The channels of a hex colour. Strict by default: `#rrggbb` only, which is
 * what the database stores. `lenient` also takes `#rgb`, a missing `#` and
 * surrounding spaces, for colours read out of loosely typed tenant JSON.
 */
export function parseHexColour(
  value: string,
  options?: Readonly<{ lenient?: boolean }>,
): Rgb | null {
  const digits =
    options?.lenient === true
      ? expandShortHex(value.trim().replace(/^#/u, ''))
      : (/^#([0-9a-f]{6})$/iu.exec(value)?.[1] ?? '')
  if (!/^[0-9a-f]{6}$/iu.test(digits)) return null
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ]
}

function expandShortHex(digits: string): string {
  return digits.length === 3
    ? [...digits].map((character) => `${character}${character}`).join('')
    : digits
}

function linearChannel(channel: number): number {
  const ratio = channel / 255
  return ratio <= 0.040_45 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
}

function luminanceOf([red, green, blue]: Rgb): number {
  return (
    0.2126 * linearChannel(red) +
    0.7152 * linearChannel(green) +
    0.0722 * linearChannel(blue)
  )
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour; null when it is not one. */
export function relativeLuminance(colour: string): number | null {
  const channels = parseHexColour(colour)
  return channels ? luminanceOf(channels) : null
}

/** WCAG 2.x contrast ratio of two `#rrggbb` colours; null when either is not one. */
export function contrastRatio(foreground: string, background: string): number | null {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  if (first === null || second === null) return null
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/**
 * The more readable of black and white on `background`. A colour this cannot
 * parse (a named colour, a gradient, anything the tenant's stored JSON may
 * hold) keeps white rather than guessing.
 */
export function readableForegroundOn(background: string): string {
  const channels = parseHexColour(background, { lenient: true })
  if (!channels) return LIGHT_FOREGROUND
  const luminance = luminanceOf(channels)
  const againstDark = (luminance + 0.05) / 0.05
  const againstLight = 1.05 / (luminance + 0.05)
  return againstDark > againstLight ? DARK_FOREGROUND : LIGHT_FOREGROUND
}

function toHslParts([red, green, blue]: Rgb): { hue: number; saturation: number } {
  const [r, g, b] = [red / 255, green / 255, blue / 255] as const
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return { hue: 0, saturation: 0 }
  const lightness = (max + min) / 2
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  const sector =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4
  return { hue: sector * 60, saturation }
}

function fromHsl(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const offset = lightness - chroma / 2
  const sector = hue / 60
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r, g, b] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second]
  const hex = [r, g, b]
    .map((part) =>
      Math.round((part as number) * 255 + offset * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()
  return `#${hex}`
}

/**
 * The dark field a guest page is painted on, derived from the accent: the
 * accent's hue at a fixed near-black lightness and a capped saturation. A
 * greyscale accent gives a neutral field. Null when `accent` is not a
 * `#rrggbb` colour.
 */
export function deriveFieldColour(accent: string): string | null {
  const channels = parseHexColour(accent)
  if (!channels) return null
  const { hue, saturation } = toHslParts(channels)
  return fromHsl(hue, Math.min(saturation, FIELD_MAX_SATURATION), FIELD_LIGHTNESS)
}

// The three washes of colour painted over the field when there is no photo
// (round-4 board G09) and, fainter, over the blurred photo (G01). Measured from
// the board's champagne accent (hue 42°, saturation .61): amber is the accent
// 5° toward red, at .8 of its saturation and a mid lightness; sage sits 83°
// around the wheel and is nearly grey; umber is amber, darker, 18° toward red.
// (Amber is 4° toward red here: the board's 5° rounds to it.)
const WARM_WASH = { hueShift: -4, saturationScale: 0.8, lightness: 0.623 } as const
const COOL_WASH = { hueShift: 83, saturation: 0.115, lightness: 0.408 } as const
const DEEP_WASH = { hueShift: -18, saturationScale: 0.8, lightness: 0.337 } as const
/** Below this an accent is a grey: its washes stay grey rather than invent a hue. */
const GREYSCALE_SATURATION = 0.05
const MAX_WASH_SATURATION = 0.55

/**
 * How strongly each wash is painted at its peak over the field (the guest
 * stylesheet reads these, so the arithmetic below and the page agree).
 */
export const BACKDROP_WASH_ALPHA = { warm: 0.55, cool: 0.55, deep: 0.62 } as const
const WASH_LIGHTNESS_STEP = 0.005
/** Headroom over AA, so the 8-bit rounding of a painted colour cannot dip below it. */
const WASH_CONTRAST_HEADROOM = 0.1

export type BackdropTones = Readonly<{ warm: string; cool: string; deep: string }>

const wrapHue = (hue: number) => ((hue % 360) + 360) % 360

/** Whether the page text keeps AA on `wash` painted at `alpha` over `field`. */
function washKeepsTextReadable(wash: Rgb, field: Rgb, alpha: number): boolean {
  const painted = wash.map(
    (channel, index) => alpha * channel + (1 - alpha) * (field[index] as number),
  ) as unknown as Rgb
  const text = luminanceOf(parseHexColour(IMMERSIVE_TEXT_COLOUR) as Rgb)
  const ratio = (text + 0.05) / (luminanceOf(painted) + 0.05)
  return ratio >= MIN_TEXT_CONTRAST + WASH_CONTRAST_HEADROOM
}

/**
 * A wash of this hue and saturation, as light as `lightness` allows while the
 * page text stays readable on it at its painted strength. A hue that is bright
 * at mid lightness (yellow-green) is darkened until it is.
 */
function boundedWash(
  hue: number,
  saturation: number,
  lightness: number,
  alpha: number,
  field: Rgb,
): string {
  for (let level = lightness; level > 0; level -= WASH_LIGHTNESS_STEP) {
    const hex = fromHsl(hue, saturation, level)
    if (washKeepsTextReadable(parseHexColour(hex) as Rgb, field, alpha)) return hex
  }
  return fromHsl(hue, saturation, 0)
}

/**
 * The warm, cool and deep washes the guest backdrop paints over the field,
 * derived from the accent. Upper-case `#RRGGBB`, all mid-to-dark so they tint
 * the field without lifting it toward the text colour: each is darkened, where
 * its hue is bright, until the page text keeps AA on it at its painted strength
 * over `field` (default: the accent's derived field). Null when `accent` or
 * `field` is not a `#rrggbb` colour.
 */
export function deriveBackdropTones(
  accent: string,
  field?: string,
): BackdropTones | null {
  const channels = parseHexColour(accent)
  const fieldChannels = parseHexColour(field ?? deriveFieldColour(accent) ?? '')
  if (!channels || !fieldChannels) return null
  const { hue, saturation } = toHslParts(channels)
  const isGrey = saturation < GREYSCALE_SATURATION
  const scaled = (scale: number) =>
    isGrey ? 0 : Math.min(saturation * scale, MAX_WASH_SATURATION)
  return {
    warm: boundedWash(
      wrapHue(hue + WARM_WASH.hueShift),
      scaled(WARM_WASH.saturationScale),
      WARM_WASH.lightness,
      BACKDROP_WASH_ALPHA.warm,
      fieldChannels,
    ),
    cool: boundedWash(
      wrapHue(hue + COOL_WASH.hueShift),
      isGrey ? 0 : COOL_WASH.saturation,
      COOL_WASH.lightness,
      BACKDROP_WASH_ALPHA.cool,
      fieldChannels,
    ),
    deep: boundedWash(
      wrapHue(hue + DEEP_WASH.hueShift),
      scaled(DEEP_WASH.saturationScale),
      DEEP_WASH.lightness,
      BACKDROP_WASH_ALPHA.deep,
      fieldChannels,
    ),
  }
}

/**
 * Whether the accent can carry text on the field: the derived field unless an
 * explicit one is given (a manual background). False for anything unreadable.
 */
export function isAccentReadableOnField(accent: string, field?: string): boolean {
  const against = field ?? deriveFieldColour(accent)
  if (against === null) return false
  const ratio = contrastRatio(accent, against)
  return ratio !== null && ratio >= MIN_TEXT_CONTRAST
}

/** Whether the page text reads on `field` at the AAA threshold: the test a manual field must pass. */
export function isFieldForLightText(field: string): boolean {
  return (contrastRatio(IMMERSIVE_TEXT_COLOUR, field) ?? 0) >= MIN_FIELD_TEXT_CONTRAST
}
