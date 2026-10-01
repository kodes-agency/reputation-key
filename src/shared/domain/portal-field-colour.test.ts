import { describe, expect, it } from 'vitest'
import {
  BACKDROP_WASH_ALPHA,
  IMMERSIVE_TEXT_COLOUR,
  MIN_FIELD_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  deriveBackdropTones,
  deriveFieldColour,
  isAccentReadableOnField,
  isFieldForLightText,
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

describe('deriveBackdropTones', () => {
  const channelGap = (a: string, b: string) => {
    const [ar, ag, ab] = parseHexColour(a) as [number, number, number]
    const [br, bg, bb] = parseHexColour(b) as [number, number, number]
    return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb))
  }

  it('is null for an accent it cannot read', () => {
    expect(deriveBackdropTones('gold')).toBeNull()
    expect(deriveBackdropTones('#fff')).toBeNull()
  })

  it('gives champagne the amber, sage and umber washes of the round-4 no-photo board', () => {
    const tones = deriveBackdropTones('#EAD6A8')
    expect(tones).not.toBeNull()
    // The board paints rgb(206,170,112), rgb(92,116,94) and rgb(128,78,44).
    expect(channelGap(tones?.warm as string, '#CEAA70')).toBeLessThanOrEqual(12)
    expect(channelGap(tones?.cool as string, '#5C745E')).toBeLessThanOrEqual(12)
    expect(channelGap(tones?.deep as string, '#804E2C')).toBeLessThanOrEqual(12)
  })

  it.each(['#EAD6A8', '#C8A45A', '#1F2A44', '#FF0000', '#00FF00', '#0000FF', '#FFFFFF'])(
    'gives %s three valid, upper-case tones that tint a dark field without washing it out',
    (accent) => {
      const tones = deriveBackdropTones(accent)
      for (const tone of [tones?.warm, tones?.cool, tones?.deep]) {
        expect(tone).toMatch(/^#[0-9A-F]{6}$/u)
        expect(hsl(tone as string).l).toBeLessThan(0.66)
        expect(hsl(tone as string).s).toBeLessThanOrEqual(0.56)
      }
    },
  )

  it('keeps the warm and deep tones on the accent hue and moves the cool one away', () => {
    const tones = deriveBackdropTones('#C8A45A')
    const accentHue = hsl('#C8A45A').h
    expect(hueDistance(hsl(tones?.warm as string).h, accentHue)).toBeLessThan(12)
    expect(hueDistance(hsl(tones?.deep as string).h, accentHue)).toBeLessThan(24)
    expect(hueDistance(hsl(tones?.cool as string).h, accentHue)).toBeGreaterThan(60)
  })

  it('leaves a greyscale accent neutral tones, with no invented hue', () => {
    for (const accent of ['#808080', '#FFFFFF', '#000000']) {
      const tones = deriveBackdropTones(accent)
      for (const tone of [tones?.warm, tones?.cool, tones?.deep]) {
        const [r, g, b] = parseHexColour(tone as string) as [number, number, number]
        expect(r).toBe(g)
        expect(g).toBe(b)
      }
    }
  })

  it('ignores the letter case of the accent', () => {
    expect(deriveBackdropTones('#ead6a8')).toEqual(deriveBackdropTones('#EAD6A8'))
  })
})

/** `#RRGGBB` for a hue (0-360), saturation and lightness (0-1), computed apart from the module. */
function hslToHex(h: number, s: number, l: number): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const second = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const offset = l - chroma / 2
  const sector = Math.floor(h / 60) % 6
  const [r, g, b] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ][sector] as [number, number, number]
  return `#${[r, g, b]
    .map((part) =>
      Math.round((part + offset) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`
}

/** A wash painted at `alpha` over `field`, as the browser composites it in sRGB. */
function paintedOver(wash: string, field: string, alpha: number): string {
  const [wr, wg, wb] = parseHexColour(wash) as [number, number, number]
  const [fr, fg, fb] = parseHexColour(field) as [number, number, number]
  const channel = (top: number, base: number) =>
    Math.round(alpha * top + (1 - alpha) * base)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(wr, fr)}${channel(wg, fg)}${channel(wb, fb)}`
}

describe('the backdrop washes are bounded by the text they sit under', () => {
  const hues = Array.from({ length: 24 }, (_, step) => step * 15)

  it.each([1, 0.6, 0.3])(
    'keeps the page text at AA on every wash at its painted strength (saturation %s)',
    (saturation) => {
      for (const hue of hues) {
        const accent = hslToHex(hue, saturation, 0.55)
        const field = deriveFieldColour(accent) as string
        const tones = deriveBackdropTones(accent, field) as NonNullable<
          ReturnType<typeof deriveBackdropTones>
        >
        for (const key of ['warm', 'cool', 'deep'] as const) {
          const painted = paintedOver(tones[key], field, BACKDROP_WASH_ALPHA[key])
          expect(
            contrastRatio(IMMERSIVE_TEXT_COLOUR, painted) ?? 0,
            `${accent} ${key}`,
          ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        }
      }
    },
  )

  it('darkens the yellow-green accent whose uncapped warm wash fell to 3.7:1', () => {
    const field = deriveFieldColour('#CCDD00') as string
    const tones = deriveBackdropTones('#CCDD00', field) as NonNullable<
      ReturnType<typeof deriveBackdropTones>
    >
    const painted = paintedOver(tones.warm, field, BACKDROP_WASH_ALPHA.warm)
    expect(contrastRatio(IMMERSIVE_TEXT_COLOUR, painted) ?? 0).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    )
    expect(hsl(tones.warm).l).toBeLessThan(0.6)
  })

  it('leaves the board champagne washes as measured', () => {
    const field = deriveFieldColour('#EAD6A8') as string
    expect(deriveBackdropTones('#EAD6A8', field)).toEqual(deriveBackdropTones('#EAD6A8'))
  })

  it('bounds the washes against a manual field as well as a derived one', () => {
    const field = '#2A2A2A'
    for (const hue of hues) {
      const accent = hslToHex(hue, 1, 0.55)
      const tones = deriveBackdropTones(accent, field) as NonNullable<
        ReturnType<typeof deriveBackdropTones>
      >
      for (const key of ['warm', 'cool', 'deep'] as const) {
        const painted = paintedOver(tones[key], field, BACKDROP_WASH_ALPHA[key])
        expect(contrastRatio(IMMERSIVE_TEXT_COLOUR, painted) ?? 0).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST,
        )
      }
    }
  })
})

describe('isFieldForLightText', () => {
  it('accepts a field the page text reads on at the AAA threshold, and refuses the rest', () => {
    expect(MIN_FIELD_TEXT_CONTRAST).toBe(7)
    expect(isFieldForLightText('#15110D')).toBe(true)
    expect(isFieldForLightText('#0A2A1F')).toBe(true)
    expect(isFieldForLightText('#808080')).toBe(false)
    expect(isFieldForLightText('#FFFFFF')).toBe(false)
    expect(isFieldForLightText('not a colour')).toBe(false)
  })
})
