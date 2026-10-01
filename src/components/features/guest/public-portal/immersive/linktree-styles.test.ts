// The Linktree text sits on glass over a photo the manager chose, or on a photo
// tile of its own. Neither may depend on what the photo looks like, so the
// worst case, a white photo, is computed here with the arithmetic the shell's
// resolver tests use, and the values the stylesheet is built from are pinned.

import { describe, expect, it } from 'vitest'
import {
  MIN_TEXT_CONTRAST,
  contrastRatio,
  deriveFieldColour,
  parseHexColour,
} from '#/shared/domain/portal-field-colour'
import {
  IMMERSIVE_TEXT_COLOUR,
  PHOTO_BACKDROP,
  resolveImmersiveLook,
} from './immersive-look'
import { LINKTREE_CSS, LINKTREE_TEXT } from './linktree-styles'

type Rgb = readonly [number, number, number]
const channels = (hex: string): Rgb => parseHexColour(hex) as Rgb
const over = (top: Rgb, alpha: number, base: Rgb): Rgb => [
  alpha * top[0] + (1 - alpha) * base[0],
  alpha * top[1] + (1 - alpha) * base[1],
  alpha * top[2] + (1 - alpha) * base[2],
]
const hex = (rgb: Rgb) =>
  `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`
const WHITE: Rgb = [255, 255, 255]
const TILE_GLASS_ALPHA = 0.08

const ACCENTS = [
  '#EAD6A8',
  '#C8A45A',
  '#1F2A44',
  '#FF0000',
  '#0000FF',
  '#FFFFFF',
  '#000000',
]

function look(accent: string) {
  return resolveImmersiveLook({
    accentColour: accent,
    fieldColour: deriveFieldColour(accent) ?? '#000000',
  })
}

/** The brightest backdrop a photo can make: white, at the fixed brightness, under the field layer. */
function whitePhotoBackdrop(field: string): Rgb {
  const photo = WHITE.map((value) => value * PHOTO_BACKDROP.brightness) as unknown as Rgb
  return over(channels(field), PHOTO_BACKDROP.fieldMix, photo)
}

/** A text colour at `alpha` over a surface, as the guest sees it. */
function drawn(alpha: number, surface: Rgb): string {
  return hex(over(channels(IMMERSIVE_TEXT_COLOUR), alpha, surface))
}

describe('the tile line text on glass', () => {
  it.each(ACCENTS)('holds AA over a white photo for the accent %s', (accent) => {
    const { style, field } = look(accent)
    const base = whitePhotoBackdrop(field)
    const warm = over(channels(style['--ih-wash-warm']), PHOTO_BACKDROP.warmWash, base)
    const cool = over(channels(style['--ih-wash-cool']), PHOTO_BACKDROP.coolWash, base)
    for (const backdrop of [base, warm, cool]) {
      const glass = over(WHITE, TILE_GLASS_ALPHA, backdrop)
      expect(
        contrastRatio(drawn(LINKTREE_TEXT.lineAlpha, glass), hex(glass)) ?? 0,
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })

  it.each(ACCENTS)(
    'holds AA on the opaque fill used where backdrop-filter is missing, for %s',
    (accent) => {
      const solid = channels(look(accent).style['--ih-glass-solid'])
      expect(
        contrastRatio(drawn(LINKTREE_TEXT.lineAlpha, solid), hex(solid)) ?? 0,
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    },
  )
})

describe('the text on a photo tile', () => {
  // The tile's own photo is any photo. Its text sits on a scrim that is fully
  // painted behind the text, whatever the height of the tile, so the worst case
  // is a white photo under that scrim.
  const scrim = channels(LINKTREE_TEXT.scrimColour)
  const behindText = over(scrim, LINKTREE_TEXT.scrimAlpha, WHITE)

  it('keeps the label AA over a white photo', () => {
    expect(
      contrastRatio(IMMERSIVE_TEXT_COLOUR, hex(behindText)) ?? 0,
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
  })

  it('keeps the line AA over a white photo', () => {
    expect(
      contrastRatio(drawn(LINKTREE_TEXT.lineAlpha, behindText), hex(behindText)) ?? 0,
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
  })

  it('paints the scrim behind the whole text block, not as a fade across the tile', () => {
    // The text block carries its own scrim and starts below the fade-in strip.
    expect(LINKTREE_CSS).toMatch(
      /\.ih-tile--photo \.ih-tile__text \{[^}]*linear-gradient\(180deg, transparent 0/u,
    )
  })
})

describe('the stylesheet', () => {
  it('animates only transform, which the compositor handles', () => {
    const transitions = [...LINKTREE_CSS.matchAll(/transition:\s*([^;]+);/gu)].map(
      (match) => match[1] ?? '',
    )
    expect(transitions.length).toBeGreaterThan(0)
    for (const transition of transitions)
      expect(transition).toMatch(/^(transform\b|none$)/u)
  })

  it('stops the motion for a guest who asked for less of it', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/u.exec(
      LINKTREE_CSS,
    )
    expect(reduced?.[1]).toContain('transition: none')
    expect(reduced?.[1]).toContain('transform: none')
  })

  it('scopes every rule under the shell root or the Linktree', () => {
    const selectors = [...LINKTREE_CSS.matchAll(/^([^\s@}/][^{]*)\{/gmu)].map((match) =>
      (match[1] ?? '').trim(),
    )
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) expect(selector).toMatch(/\.ih-/u)
  })

  it('lets a lone last tile take the full row', () => {
    expect(LINKTREE_CSS).toMatch(
      /\.ih-linktree__item:last-child:nth-child\(odd\) \{[^}]*grid-column: 1 \/ -1/u,
    )
  })

  it('lets a tile grow with a long word instead of clipping it', () => {
    expect(LINKTREE_CSS).toMatch(/\.ih-tile \{[^}]*min-height: 96px/u)
    expect(LINKTREE_CSS).toMatch(/\.ih-tile__text \{[^}]*min-width: 0/u)
  })
})
