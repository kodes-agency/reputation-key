// The text at the top of the page, over the brightest photo a manager can upload.
//
// The hero photo is not darkened; the wordmark and the title's kicker are read
// against the photo's fade into the field and two scrims. The worst photo is a
// white one (the same worst case `immersive-look.test.ts` pins for the blurred
// backdrop), so these tests composite white through the very stops the
// stylesheet is built from, sRGB source-over like the browser, and hold WCAG AA:
// 4.5:1 for the 16 px wordmark and the 11 px kicker, 3:1 for the 44 px name.
//
// Before: the wordmark sat at about 3:1 and the kicker at about 2.2:1 on such a photo.

import { describe, expect, it } from 'vitest'
import {
  MIN_TEXT_CONTRAST,
  contrastRatio,
  parseHexColour,
} from '#/shared/domain/portal-field-colour'
import {
  HERO_PHONE_HEIGHT,
  HERO_PHOTO_MASK,
  HERO_TEXT_BANDS,
  HERO_TITLE_CLEARANCE,
  HERO_TITLE_SCRIM,
  HERO_TITLE_SCRIM_HALF_WIDTH,
  HERO_TOP_SCRIM,
  HERO_WIDE,
  heroBackgroundAt,
  heroBackgroundsOf,
  photoMaskGradient,
  scrimAlphaAt,
  scrimGradient,
  scrimReach,
} from './immersive-hero-scrim'
import {
  IMMERSIVE_TEXT_COLOUR,
  PHOTO_BACKDROP,
  resolveImmersiveLook,
} from './immersive-look'
import { IMMERSIVE_CSS } from './immersive-styles'

type Rgb = readonly [number, number, number]
const LARGE_TEXT_CONTRAST = 3
const WHITE = '#FFFFFF'
const LIGHTEST_FIELD = '#4F4F4F'
const channels = (hex: string) => parseHexColour(hex) as Rgb
const over = (top: Rgb, alpha: number, base: Rgb): Rgb => [
  alpha * top[0] + (1 - alpha) * base[0],
  alpha * top[1] + (1 - alpha) * base[1],
  alpha * top[2] + (1 - alpha) * base[2],
]

/** The blurred backdrop under a white photo, on the lightest field the resolver honours. */
const whiteBackdrop = (field: string) =>
  over(
    channels(field),
    PHOTO_BACKDROP.fieldMix,
    [255, 255, 255].map((c) => c * PHOTO_BACKDROP.brightness) as unknown as Rgb,
  )

const worstContrast = (foreground: string, backgrounds: readonly string[]) =>
  Math.min(...backgrounds.map((background) => contrastRatio(foreground, background) ?? 0))

describe('scrimAlphaAt', () => {
  const stops = [
    [0, 0.8],
    [10, 0.4],
    [30, 0],
  ] as const

  it('interpolates between the stops and holds the ends', () => {
    expect(scrimAlphaAt(stops, 0)).toBe(0.8)
    expect(scrimAlphaAt(stops, 5)).toBeCloseTo(0.6)
    expect(scrimAlphaAt(stops, 10)).toBe(0.4)
    expect(scrimAlphaAt(stops, 20)).toBeCloseTo(0.2)
    expect(scrimAlphaAt(stops, -5)).toBe(0.8)
    expect(scrimAlphaAt(stops, 99)).toBe(0)
    expect(scrimAlphaAt([], 5)).toBe(0)
  })
})

describe('the hero over a white photo', () => {
  it.each([
    ['the lightest manual field', LIGHTEST_FIELD],
    ['the champagne field', '#15110D'],
  ])('keeps the 16 px white wordmark at AA on %s', (_name, field) => {
    const backgrounds = heroBackgroundsOf(
      'wordmark',
      whiteBackdrop(field).map(Math.round) as unknown as Rgb,
    )
    expect(worstContrast(WHITE, backgrounds)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
  })

  it('keeps the white first line of the name above the 3:1 a 44 px text needs', () => {
    const backgrounds = heroBackgroundsOf('name', whiteBackdrop(LIGHTEST_FIELD))
    expect(worstContrast(WHITE, backgrounds)).toBeGreaterThanOrEqual(LARGE_TEXT_CONTRAST)
  })

  it('keeps the champagne kicker at AA, which was about 2.2:1 before the scrims', () => {
    const { style } = resolveImmersiveLook({
      accentColour: '#EAD6A8',
      fieldColour: LIGHTEST_FIELD,
    })
    const backgrounds = heroBackgroundsOf('kicker', whiteBackdrop(LIGHTEST_FIELD))
    expect(worstContrast(style['--ih-kicker-photo'], backgrounds)).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    )
    expect(style['--ih-kicker-photo']).not.toBe(IMMERSIVE_TEXT_COLOUR)
  })

  it('holds at every hero height, because the text keeps its place relative to the edges', () => {
    for (const height of [HERO_PHONE_HEIGHT, 300, 360, HERO_WIDE.maxHeight]) {
      const backdrop = whiteBackdrop(LIGHTEST_FIELD)
      expect(
        worstContrast(WHITE, heroBackgroundsOf('wordmark', backdrop, height)),
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      expect(
        worstContrast(WHITE, heroBackgroundsOf('kicker', backdrop, height)),
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      expect(
        worstContrast(WHITE, heroBackgroundsOf('name', backdrop, height)),
      ).toBeGreaterThanOrEqual(LARGE_TEXT_CONTRAST)
    }
  })

  it('does not make a white photo darker than it needs to be where there is no text', () => {
    // Between the header and the title the photo is still there to see.
    const between = heroBackgroundAt(86, whiteBackdrop('#15110D'))
    const [red] = channels(between)
    expect(red).toBeGreaterThan(150)
  })
})

describe('the kicker on a photo takes the accent only where the accent is readable', () => {
  const ACCENTS = ['#EAD6A8', '#C8A45A', '#FF0000', '#808080', '#1F2A44', '#3B82F6']

  it.each(ACCENTS)('keeps AA over the brightest photo for %s', (accent) => {
    for (const field of [LIGHTEST_FIELD, '#15110D']) {
      const { style } = resolveImmersiveLook({ accentColour: accent, fieldColour: field })
      const kicker = style['--ih-kicker-photo']
      // Every place the title can sit: the bare backdrop and under each wash.
      const base = whiteBackdrop(style['--ih-field'])
      const warm = over(channels(style['--ih-wash-warm']), PHOTO_BACKDROP.warmWash, base)
      const cool = over(channels(style['--ih-wash-cool']), PHOTO_BACKDROP.coolWash, base)
      for (const backdrop of [base, warm, cool]) {
        expect(
          worstContrast(kicker, heroBackgroundsOf('kicker', backdrop)),
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      }
    }
  })

  it('draws the accent where it is readable, and the page text colour where it is not', () => {
    expect(
      resolveImmersiveLook({ accentColour: '#EAD6A8', fieldColour: '#15110D' }).style[
        '--ih-kicker-photo'
      ],
    ).toBe('#EDDBB2')
    expect(
      resolveImmersiveLook({ accentColour: '#FF0000', fieldColour: '#15110D' }).style[
        '--ih-kicker-photo'
      ],
    ).toBe(IMMERSIVE_TEXT_COLOUR)
  })
})

describe('the stylesheet is built from these stops', () => {
  it('draws the fade, both scrims and the hero height from them', () => {
    expect(IMMERSIVE_CSS).toContain(photoMaskGradient())
    expect(IMMERSIVE_CSS).toContain(scrimGradient(HERO_TOP_SCRIM, true))
    expect(IMMERSIVE_CSS).toContain(scrimGradient(HERO_TITLE_SCRIM, false))
    expect(IMMERSIVE_CSS).toContain(`height: ${scrimReach(HERO_TOP_SCRIM)}px;`)
    expect(IMMERSIVE_CSS).toContain(`height: ${scrimReach(HERO_TITLE_SCRIM)}px;`)
    expect(IMMERSIVE_CSS).toContain(`--ih-hero-h: ${HERO_PHONE_HEIGHT}px;`)
  })

  it('anchors the title scrim to the hero’s bottom edge and the header’s to its top', () => {
    expect(IMMERSIVE_CSS).toMatch(/\.ih-hero__scrim--top\s*\{\s*top:\s*0;/u)
    expect(IMMERSIVE_CSS).toMatch(/\.ih-hero__scrim--title\s*\{\s*bottom:\s*0;/u)
  })

  it('has the photo fade in px from the bottom, so it does not move when the hero grows', () => {
    expect(photoMaskGradient()).toMatch(/^linear-gradient\(0deg, /u)
    expect(photoMaskGradient()).not.toContain('%')
    expect(HERO_PHOTO_MASK[0]).toEqual([0, 0])
  })

  it('is solid across the whole of the title’s column, and fades only beyond it', () => {
    // The column is 30rem (480 px) wide, so no word of the title is further than 240 px from the centre.
    expect(HERO_TITLE_SCRIM_HALF_WIDTH.solid).toBeGreaterThanOrEqual(240)
    expect(HERO_TITLE_SCRIM_HALF_WIDTH.gone).toBeGreaterThan(
      HERO_TITLE_SCRIM_HALF_WIDTH.solid,
    )
    expect(IMMERSIVE_CSS).toContain(
      `transparent calc(50% - ${HERO_TITLE_SCRIM_HALF_WIDTH.gone}px), #000 calc(50% - ${HERO_TITLE_SCRIM_HALF_WIDTH.solid}px)`,
    )
  })

  it('puts the title block where the bands say: the hero’s height less the clearance', () => {
    const titleTop = HERO_PHONE_HEIGHT - HERO_TITLE_CLEARANCE + 64
    expect(HERO_PHONE_HEIGHT - titleTop).toBe(HERO_TEXT_BANDS.kicker.to)
  })
})
