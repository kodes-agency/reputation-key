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
