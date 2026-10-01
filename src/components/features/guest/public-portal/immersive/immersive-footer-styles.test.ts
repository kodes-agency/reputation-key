// The footer's two grey texts are white at an alpha, so their contrast depends
// on what is behind them. This pins that it holds 4.5:1 on every backdrop the
// look can paint, using the same arithmetic as the rest of the Immersive Hub
// (`immersive-look.test.ts`): the lightest field the resolver honours, the
// field look's washes at their painted strength, and the photo look's worst
// case, a white photo.

import { describe, expect, it } from 'vitest'
import {
  BACKDROP_WASH_ALPHA,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  deriveFieldColour,
  parseHexColour,
} from '#/shared/domain/portal-field-colour'
import { FOOTER_TEXT_ALPHA, IMMERSIVE_FOOTER_CSS } from './immersive-footer-styles'
import { PHOTO_BACKDROP, resolveImmersiveLook } from './immersive-look'

type Rgb = readonly [number, number, number]

const LIGHTEST_FIELD = '#4F4F4F'
const WHITE: Rgb = [255, 255, 255]
const ACCENTS = [
  '#EAD6A8',
  '#C8A45A',
  '#1F2A44',
  '#FF0000',
  '#0000FF',
  '#808080',
  '#FFFFFF',
]

const channels = (hex: string): Rgb => parseHexColour(hex) as Rgb
const over = (top: Rgb, alpha: number, base: Rgb): Rgb => [
  alpha * top[0] + (1 - alpha) * base[0],
  alpha * top[1] + (1 - alpha) * base[1],
  alpha * top[2] + (1 - alpha) * base[2],
]
const hex = (rgb: Rgb) =>
  `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`

/** Every backdrop colour the footer text can sit on, for one accent and field. */
function backdropsFor(accent: string, fieldColour: string): Rgb[] {
  const { style, field } = resolveImmersiveLook({ accentColour: accent, fieldColour })
  const fieldRgb = channels(field)
  const washes = [
    over(channels(style['--ih-wash-warm']), BACKDROP_WASH_ALPHA.warm, fieldRgb),
    over(channels(style['--ih-wash-cool']), BACKDROP_WASH_ALPHA.cool, fieldRgb),
    over(channels(style['--ih-wash-deep']), BACKDROP_WASH_ALPHA.deep, fieldRgb),
  ]
  const whitePhoto = over(
    fieldRgb,
    PHOTO_BACKDROP.fieldMix,
    WHITE.map((value) => value * PHOTO_BACKDROP.brightness) as unknown as Rgb,
  )
  const photoWashes = [
    over(channels(style['--ih-wash-warm']), PHOTO_BACKDROP.warmWash, whitePhoto),
    over(channels(style['--ih-wash-cool']), PHOTO_BACKDROP.coolWash, whitePhoto),
  ]
  return [fieldRgb, ...washes, whitePhoto, ...photoWashes]
}

const cases = [
  ...ACCENTS.map((accent) => ({
    name: `${accent} on its derived field`,
    backdrops: backdropsFor(accent, deriveFieldColour(accent) ?? '#000000'),
  })),
  ...ACCENTS.map((accent) => ({
    name: `${accent} on the lightest accepted field`,
    backdrops: backdropsFor(accent, LIGHTEST_FIELD),
  })),
]

describe('the footer text colours', () => {
  it.each(Object.entries(FOOTER_TEXT_ALPHA))(
    'holds 4.5:1 for the %s text on every backdrop of the look',
    (key, alpha) => {
      expect(alpha).toBeLessThan(1)
      for (const { name, backdrops } of cases) {
        for (const backdrop of backdrops) {
          const text = hex(over(WHITE, alpha, backdrop))
          const ratio = contrastRatio(text, hex(backdrop)) ?? 0
          expect(
            ratio,
            `${key} text, ${name}, behind ${hex(backdrop)}`,
          ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
        }
      }
    },
  )

  it('draws the stylesheet from the same constants', () => {
    expect(IMMERSIVE_FOOTER_CSS).toContain(
      `rgba(255, 255, 255, ${FOOTER_TEXT_ALPHA.notice})`,
    )
    expect(IMMERSIVE_FOOTER_CSS).toContain(
      `rgba(255, 255, 255, ${FOOTER_TEXT_ALPHA.made})`,
    )
  })
})
