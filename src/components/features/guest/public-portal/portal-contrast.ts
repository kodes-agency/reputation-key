// Readable foreground for a tenant-chosen brand colour.
//
// The portal's primary colour is whatever the tenant saved. The guest-facing
// buttons painted with it used a hardcoded `text-white`, which is fine for the
// default indigo (#6366F1, 4.6:1) and unreadable for a light brand: the Dark
// palette preset ships #a5b4fc, where white text measures 1.99:1 — axe fails
// it, and so would a guest trying to read the button.
//
// CSS cannot pick a foreground by luminance, and `color-mix` cannot either, so
// the choice is made here from the same hex the theme variables already carry.
// The result is a VARIABLE, so every surface painted with the brand colour
// takes the same answer.

// The two candidates are the EXTREMES, not the portal's own text colours.
// This variable exists to be legible on an arbitrary brand colour, and the
// extremes are what maximise contrast: the portal default indigo (#6366F1)
// reaches 4.47:1 with white — below AA — and 4.70:1 with black. Using the
// in-palette #111827 instead would have scored 3.97 and shipped a CTA no
// standard calls readable.
const DARK_FOREGROUND = '#000000'
const LIGHT_FOREGROUND = '#ffffff'

function parseHex(value: string): readonly [number, number, number] | null {
  const hex = value.trim().replace(/^#/u, '')
  const expanded =
    hex.length === 3
      ? [...hex].map((character) => `${character}${character}`).join('')
      : hex
  if (!/^[0-9a-f]{6}$/iu.test(expanded)) return null
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ] as const
}

/** WCAG 2.x relative luminance of an sRGB channel triple (0–255). */
function relativeLuminance(channels: readonly [number, number, number]): number {
  const [red, green, blue] = channels.map((channel) => {
    const ratio = channel / 255
    return ratio <= 0.040_45 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** WCAG 2.x contrast ratio between two hex colours; 1 when either is unparseable. */
export function contrastRatio(left: string, right: string): number {
  const [a, b] = [parseHex(left), parseHex(right)]
  if (!a || !b) return 1
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (first, second) => second - first,
  ) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

/**
 * The more readable of the portal's two foregrounds on `background`.
 *
 * Returns whichever of white / portal-dark has the higher contrast ratio, so a
 * light brand colour gets dark text instead of white. A colour this cannot
 * parse (a named colour, a gradient, anything the tenant's stored JSON may
 * hold) keeps today's answer rather than guessing.
 */
export function readableForegroundOn(background: string): string {
  if (!parseHex(background)) return LIGHT_FOREGROUND
  return contrastRatio(background, DARK_FOREGROUND) >
    contrastRatio(background, LIGHT_FOREGROUND)
    ? DARK_FOREGROUND
    : LIGHT_FOREGROUND
}
