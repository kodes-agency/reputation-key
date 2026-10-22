import { describe, expect, it } from 'vitest'
import { IMMERSIVE_TEXT_COLOUR, contrastRatio } from './portal-field-colour'
import {
  PRINT_KIT_CONTRAST,
  PRINT_KIT_WASH_ALPHA,
  immersivePrintKitPalette,
  logoNeedsPaperPlate,
  paperLogoPlate,
  paperPrintKitPalette,
  printKitPalette,
  printKitStylePalette,
} from './portal-print-kit-palette'

describe('printKitPalette', () => {
  it('sets the kicker in the accent when it reads on the field', () => {
    const palette = printKitPalette('#EAD6A8', '#15110D')
    expect(palette.field).toBe('#15110D')
    expect(palette.kicker).toBe('#EAD6A8')
  })

  it('sets the kicker in the page text colour when the accent would not read', () => {
    expect(printKitPalette('#201A12', '#15110D').kicker).toBe(IMMERSIVE_TEXT_COLOUR)
  })

  it('derives the washes from the accent, as the guest backdrop does', () => {
    const palette = printKitPalette('#EAD6A8', '#15110D')
    expect(palette.warm).toMatch(/^#[0-9A-F]{6}$/u)
    expect(palette.cool).toMatch(/^#[0-9A-F]{6}$/u)
  })

  it('keeps the field and the page text for a colour it cannot read', () => {
    const palette = printKitPalette('red', 'blue')
    expect(palette.kicker).toBe(IMMERSIVE_TEXT_COLOUR)
    expect(palette.warm).toBe(palette.field)
    expect(palette.cool).toBe(palette.field)
  })

  it('always prints the code in near-black on warm paper', () => {
    const palette = printKitPalette('#EAD6A8', '#15110D')
    expect(palette.plateInk).toBe('#121614')
    expect(palette.platePaper).toBe('#F6F1E6')
  })
})

// The spec's section 3.3: what the design boards compute for the tweak's four accents.
const WORKED = [
  {
    accent: '#EAD6A8',
    paper: {
      accentInk: '#765B1D',
      inkRatio: 6.2,
      barFill: '#EAD6A8',
      barText: '#121614',
      barRatio: 12.8,
    },
    immersive: {
      field: '#16130E',
      accentInk: '#EAD6A8',
      inkRatio: 13.0,
      accentLine: '#EAD6A8',
      lift: '#35322D',
      plateTone: '#28251F',
      mono: '#685F4C',
      monoLine: '#EAD6A8',
    },
  },
  {
    accent: '#0F8B8D',
    paper: {
      accentInk: '#0C6B6D',
      inkRatio: 6.1,
      barFill: '#0F9092',
      barText: '#121614',
      barRatio: 4.7,
    },
    immersive: {
      field: '#0E1616',
      accentInk: '#13B4B6',
      inkRatio: 7.2,
      accentLine: '#0F8B8D',
      lift: '#2E3533',
      plateTone: '#212827',
      mono: '#186B6C',
      monoLine: '#0F8B8D',
    },
  },
  {
    accent: '#C8102E',
    paper: {
      accentInk: '#BF0F2C',
      inkRatio: 6.2,
      barFill: '#C8102E',
      barText: '#FFFFFF',
      barRatio: 5.9,
    },
    immersive: {
      field: '#160E0F',
      accentInk: '#F4788C',
      inkRatio: 7.2,
      accentLine: '#C8102E',
      lift: '#352E2D',
      plateTone: '#282020',
      mono: '#B41D35',
      monoLine: '#D61131',
    },
  },
  {
    accent: '#2E5E8C',
    paper: {
      accentInk: '#2E5E8C',
      inkRatio: 6.6,
      barFill: '#2E5E8C',
      barText: '#FFFFFF',
      barRatio: 6.8,
    },
    immersive: {
      field: '#0E1216',
      accentInk: '#73A3D1',
      inkRatio: 7.1,
      accentLine: '#326698',
      lift: '#2E3133',
      plateTone: '#212427',
      mono: '#38638C',
      monoLine: '#3873AB',
    },
  },
] as const

const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 0

describe.each(WORKED)('the worked values for $accent', ({ accent, paper, immersive }) => {
  it('derives the Paper palette the boards show', () => {
    const palette = paperPrintKitPalette(accent)

    expect(palette).toMatchObject({
      style: 'paper',
      paper: '#FDFCF9',
      ink: '#121614',
      soft: '#5C5650',
      accentInk: paper.accentInk,
      barFill: paper.barFill,
      barText: paper.barText,
    })
    expect(ratio(palette.accentInk, palette.paper)).toBeCloseTo(paper.inkRatio, 1)
    expect(ratio(palette.barFill, palette.barText)).toBeCloseTo(paper.barRatio, 1)
  })

  it('derives the Immersive palette the boards show, field from the accent', () => {
    const palette = immersivePrintKitPalette(accent, null)

    const { inkRatio, ...tokens } = immersive
    expect(palette).toMatchObject({
      style: 'immersive',
      headline: '#FFFFFF',
      ...tokens,
    })
    expect(ratio(palette.accentInk, palette.field)).toBeCloseTo(inkRatio, 1)
    expect(palette.barFill).toBe(paper.barFill)
    expect(palette.barText).toBe(paper.barText)
  })

  it('holds the monogram letter at 2.4 to 2.6:1 on its ground', () => {
    const palette = immersivePrintKitPalette(accent, null)
    expect(ratio(palette.mono, palette.plateTone)).toBeGreaterThanOrEqual(2.4)
    expect(ratio(palette.mono, palette.plateTone)).toBeLessThanOrEqual(2.6)
  })
})

/** A small deterministic generator, so a failing accent can be named and run again. */
function randomAccents(count: number): readonly string[] {
  let seed = 0x9e3779b9
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from(
    { length: count },
    () =>
      `#${Array.from({ length: 3 }, () =>
        Math.floor(next() * 256)
          .toString(16)
          .padStart(2, '0'),
      )
        .join('')
        .toUpperCase()}`,
  )
}

const EXTREMES = ['#000000', '#FFFFFF', '#808080', '#FFFF00', '#0000FF', '#FF0000']

describe('the contrast floors, for any accent', () => {
  const accents = [...EXTREMES, ...randomAccents(50)]

  it.each(accents)('keeps every Paper pair readable for %s', (accent) => {
    const palette = paperPrintKitPalette(accent)
    expect(ratio(palette.accentInk, palette.paper)).toBeGreaterThanOrEqual(
      PRINT_KIT_CONTRAST.paperAccentInk,
    )
    expect(ratio(palette.barFill, palette.barText)).toBeGreaterThanOrEqual(
      PRINT_KIT_CONTRAST.bar,
    )
  })

  it.each(accents)('keeps every Immersive pair readable for %s', (accent) => {
    const palette = immersivePrintKitPalette(accent, null)
    expect(ratio(palette.accentInk, palette.field)).toBeGreaterThanOrEqual(
      PRINT_KIT_CONTRAST.immersiveAccentInk,
    )
    expect(ratio(palette.accentLine, palette.field)).toBeGreaterThanOrEqual(
      PRINT_KIT_CONTRAST.accentLine,
    )
    expect(ratio(palette.monoLine, palette.plateTone)).toBeGreaterThanOrEqual(
      PRINT_KIT_CONTRAST.monoLine,
    )
    expect(ratio(palette.barFill, palette.barText)).toBeGreaterThanOrEqual(
      PRINT_KIT_CONTRAST.bar,
    )
    expect(ratio(palette.headline, palette.field)).toBeGreaterThan(15)
    expect(ratio(palette.body, palette.field)).toBeGreaterThan(14)
  })

  it.each(accents)('keeps the monogram letter faint but present for %s', (accent) => {
    const palette = immersivePrintKitPalette(accent, null)
    expect(ratio(palette.mono, palette.plateTone)).toBeGreaterThanOrEqual(2.4)
    expect(ratio(palette.mono, palette.plateTone)).toBeLessThanOrEqual(2.6)
  })
})

describe('printKitStylePalette', () => {
  it('hands back the palette of the style asked for', () => {
    expect(printKitStylePalette('#EAD6A8', null, 'paper').style).toBe('paper')
    expect(printKitStylePalette('#EAD6A8', null, 'immersive').style).toBe('immersive')
    expect(printKitStylePalette('#EAD6A8', '#15110D', 'immersive')).toEqual(
      immersivePrintKitPalette('#EAD6A8', '#15110D'),
    )
  })

  it('uses the look’s field when it has one, and derives one when it has none', () => {
    expect(immersivePrintKitPalette('#EAD6A8', '#15110D').field).toBe('#15110D')
    expect(immersivePrintKitPalette('#EAD6A8', null).field).toBe('#16130E')
  })

  it('paints the washes at 0.30, quieter than the guest backdrop', () => {
    expect(PRINT_KIT_WASH_ALPHA).toBe(0.3)
  })

  it('derives the washes from the accent, as the guest backdrop does', () => {
    const palette = immersivePrintKitPalette('#EAD6A8', null)
    expect(palette.warm).toMatch(/^#[0-9A-F]{6}$/u)
    expect(palette.cool).toMatch(/^#[0-9A-F]{6}$/u)
  })

  it('prints in ink when the accent is not a colour it can read', () => {
    const paper = paperPrintKitPalette('red')
    const immersive = immersivePrintKitPalette('red', 'blue')
    for (const colour of [
      paper.accentInk,
      paper.barFill,
      immersive.field,
      immersive.accentLine,
      immersive.mono,
    ]) {
      expect(colour).toMatch(/^#[0-9A-F]{6}$/u)
    }
  })
})

describe('a logo on paper', () => {
  it('gets a plate when it is too light to read on the paper (under 1.6:1)', () => {
    // The cream of a logo made for a dark page, and pure white.
    expect(logoNeedsPaperPlate(0.88)).toBe(true)
    expect(logoNeedsPaperPlate(1)).toBe(true)
  })

  it('prints as supplied when it is dark, mid-toned or empty', () => {
    expect(logoNeedsPaperPlate(0.01)).toBe(false)
    expect(logoNeedsPaperPlate(0.3)).toBe(false)
    expect(logoNeedsPaperPlate(null)).toBe(false)
  })

  it('sits on the field the accent derives, as the guest page does', () => {
    expect(paperLogoPlate('#EAD6A8')).toBe('#16130E')
    expect(paperLogoPlate('#C8102E')).toBe('#160E0F')
    expect(paperLogoPlate('not a colour')).toBe('#101412')
  })
})
