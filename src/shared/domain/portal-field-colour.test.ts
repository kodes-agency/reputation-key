import { describe, expect, it } from 'vitest'
import {
  MIN_TEXT_CONTRAST,
  contrastRatio,
  deriveFieldColour,
  isAccentReadableOnField,
  parseHexColour,
  readableForegroundOn,
  relativeLuminance,
} from './portal-field-colour'

/** Hue (0-360), saturation and lightness (0-1) of a parsed hex colour, computed apart from the module. */
function hsl(hex: string): { h: number; s: number; l: number } {
  const rgb = parseHexColour(hex)
  if (!rgb) throw new Error(`not a colour: ${hex}`)
  const [r, g, b] = rgb.map((channel) => channel / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60
  return { h, s, l }
}

const hueDistance = (a: number, b: number) => {
  const gap = Math.abs(a - b) % 360
  return Math.min(gap, 360 - gap)
}

describe('parseHexColour', () => {
  it('reads #rrggbb with either letter case', () => {
    expect(parseHexColour('#C8A45A')).toEqual([200, 164, 90])
    expect(parseHexColour('#c8a45a')).toEqual([200, 164, 90])
  })

  it('refuses anything but a six-digit hex unless told to be lenient', () => {
    expect(parseHexColour('#fff')).toBeNull()
    expect(parseHexColour('C8A45A')).toBeNull()
    expect(parseHexColour('rebeccapurple')).toBeNull()
    expect(parseHexColour('#12345')).toBeNull()
  })

  it('lenient reading accepts the three-digit form, a missing # and stray spaces', () => {
    expect(parseHexColour('#fff', { lenient: true })).toEqual([255, 255, 255])
    expect(parseHexColour(' C8A45A ', { lenient: true })).toEqual([200, 164, 90])
    expect(parseHexColour('var(--x)', { lenient: true })).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white, and symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
  })

  it('is 1 for a colour against itself, whatever the letter case', () => {
    expect(contrastRatio('#6366F1', '#6366f1')).toBeCloseTo(1, 5)
  })

  it('is null for a value it cannot read, never a guess', () => {
    expect(contrastRatio('rebeccapurple', '#ffffff')).toBeNull()
    expect(contrastRatio('#fff', '#000000')).toBeNull()
  })

  it('agrees with the WCAG reference pair #777777 on white (4.48:1)', () => {
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2)
    expect(contrastRatio('#777777', '#FFFFFF') ?? 99).toBeLessThan(MIN_TEXT_CONTRAST)
  })
})

describe('relativeLuminance', () => {
  it('spans 0 (black) to 1 (white)', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10)
    expect(relativeLuminance('nope')).toBeNull()
  })
})

describe('readableForegroundOn', () => {
  it('switches to dark text on the light brand that failed the a11y gate', () => {
    expect(readableForegroundOn('#a5b4fc')).toBe('#000000')
  })

  it('turns the default brand indigo dark too, because white never cleared AA', () => {
    expect(contrastRatio('#6366F1', '#ffffff') ?? 99).toBeLessThan(MIN_TEXT_CONTRAST)
    expect(readableForegroundOn('#6366F1')).toBe('#000000')
  })

  it('clears AA on every brand colour the product ships', () => {
    for (const brand of ['#6366F1', '#a5b4fc']) {
      expect(
        contrastRatio(brand, readableForegroundOn(brand)) ?? 0,
        brand,
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })

  it('accepts the three-digit form', () => {
    expect(readableForegroundOn('#fff')).toBe('#000000')
    expect(readableForegroundOn('#000')).toBe('#ffffff')
  })

  it('keeps the previous answer for a colour it cannot parse', () => {
    expect(readableForegroundOn('var(--something)')).toBe('#ffffff')
  })
})

describe('deriveFieldColour', () => {
  const vectors = [
    { name: 'champagne (light, warm)', accent: '#EAD6A8' },
    { name: 'gold (mid, warm)', accent: '#C8A45A' },
    { name: 'navy (dark, cool)', accent: '#1F2A44' },
    { name: 'pure red (saturated)', accent: '#FF0000' },
    { name: 'pure green (saturated)', accent: '#00FF00' },
    { name: 'electric blue (saturated)', accent: '#0000FF' },
    { name: 'mid grey (greyscale)', accent: '#808080' },
    { name: 'white (greyscale)', accent: '#FFFFFF' },
    { name: 'black (greyscale)', accent: '#000000' },
  ] as const

  it.each(vectors)('gives a dark, valid, upper-case field for $name', ({ accent }) => {
    const field = deriveFieldColour(accent)
    expect(field).toMatch(/^#[0-9A-F]{6}$/u)
    // Dark enough that light text clears AA on it, whatever the accent.
    expect(contrastRatio(field as string, '#FFFFFF') ?? 0).toBeGreaterThan(14)
    expect(hsl(field as string).l).toBeLessThan(0.1)
  })

  it.each(vectors.filter((v) => hsl(v.accent).s > 0.05))(
    'keeps the hue of the accent for $name',
    ({ accent }) => {
      const field = deriveFieldColour(accent) as string
      expect(hueDistance(hsl(field).h, hsl(accent).h)).toBeLessThan(6)
    },
  )

  it('holds the field nearly neutral for a saturated accent', () => {
    for (const accent of ['#FF0000', '#00FF00', '#0000FF']) {
      expect(hsl(deriveFieldColour(accent) as string).s).toBeLessThanOrEqual(0.3)
    }
  })

  it('leaves a greyscale accent a neutral field, with no invented hue', () => {
    for (const accent of ['#808080', '#FFFFFF', '#000000']) {
      const [r, g, b] = parseHexColour(deriveFieldColour(accent) as string) as [
        number,
        number,
        number,
      ]
      expect(r).toBe(g)
      expect(g).toBe(b)
    }
  })

  it('is deterministic and ignores the letter case of the accent', () => {
    expect(deriveFieldColour('#ead6a8')).toBe(deriveFieldColour('#EAD6A8'))
  })

  it('is null for an accent it cannot read', () => {
    expect(deriveFieldColour('gold')).toBeNull()
    expect(deriveFieldColour('#fff')).toBeNull()
  })
})

describe('isAccentReadableOnField', () => {
  it('passes a light accent on its own derived field', () => {
    expect(isAccentReadableOnField('#EAD6A8')).toBe(true)
    expect(isAccentReadableOnField('#C8A45A')).toBe(true)
  })

  it('refuses a dark accent on its derived field', () => {
    expect(isAccentReadableOnField('#1F2A44')).toBe(false)
    expect(isAccentReadableOnField('#000000')).toBe(false)
  })

  it('judges against an explicit field colour when one is given', () => {
    expect(isAccentReadableOnField('#1F2A44', '#FFFFFF')).toBe(true)
    expect(isAccentReadableOnField('#EAD6A8', '#FFFFFF')).toBe(false)
  })

  it('refuses a colour it cannot read', () => {
    expect(isAccentReadableOnField('gold')).toBe(false)
    expect(isAccentReadableOnField('#EAD6A8', 'dark')).toBe(false)
  })
})
