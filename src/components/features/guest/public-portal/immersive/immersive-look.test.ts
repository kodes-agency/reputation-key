// The Immersive Hub look is resolved from the snapshot's two brand colours. A
// manager can pick any accent and (in manual mode) any field, so legibility
// cannot be left to the manager: these tests pin that every pair the resolver
// can return is readable, using the same contrast arithmetic as the writer of
// the brand profile (slice 11) and the publication builder.

import { describe, expect, it } from 'vitest'
import {
  MIN_TEXT_CONTRAST,
  contrastRatio,
  deriveFieldColour,
  parseHexColour,
} from '#/shared/domain/portal-field-colour'
import {
  DEFAULT_IMMERSIVE_ACCENT,
  IMMERSIVE_TEXT_COLOUR,
  MIN_FIELD_TEXT_CONTRAST,
  resolveImmersiveLook,
} from './immersive-look'

const ACCENTS = [
  { name: 'champagne (light, warm)', accent: '#EAD6A8' },
  { name: 'gold (mid, warm)', accent: '#C8A45A' },
  { name: 'navy (dark, cool)', accent: '#1F2A44' },
  { name: 'pure red (saturated)', accent: '#FF0000' },
  { name: 'pure blue (saturated)', accent: '#0000FF' },
  { name: 'mid grey (greyscale)', accent: '#808080' },
  { name: 'white (greyscale)', accent: '#FFFFFF' },
  { name: 'black (greyscale)', accent: '#000000' },
] as const

const HEX = /^#[0-9A-F]{6}$/u

function look(accentColour: string, fieldColour?: string) {
  return resolveImmersiveLook({
    accentColour,
    fieldColour: fieldColour ?? deriveFieldColour(accentColour) ?? '#000000',
  })
}

describe('resolveImmersiveLook', () => {
  it('keeps the champagne accent and its derived field for the default brand', () => {
    const resolved = look(DEFAULT_IMMERSIVE_ACCENT)
    expect(DEFAULT_IMMERSIVE_ACCENT).toBe('#EAD6A8')
    expect(resolved.accent).toBe('#EAD6A8')
    expect(resolved.field).toBe(deriveFieldColour('#EAD6A8'))
  })

  it.each(ACCENTS)('gives light text AAA on the field for $name', ({ accent }) => {
    const resolved = look(accent)
    expect(
      contrastRatio(IMMERSIVE_TEXT_COLOUR, resolved.field) ?? 0,
    ).toBeGreaterThanOrEqual(MIN_FIELD_TEXT_CONTRAST)
  })

  it.each(ACCENTS)(
    'draws accent text and the button fill readably on the field for $name',
    ({ accent }) => {
      const resolved = look(accent)
      expect(contrastRatio(resolved.accent, resolved.field) ?? 0).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST,
      )
    },
  )

  it.each(ACCENTS)('puts readable text on the button fill for $name', ({ accent }) => {
    const resolved = look(accent)
    expect(contrastRatio(resolved.onAccent, resolved.accent) ?? 0).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    )
  })

  it('falls back to the light text colour when the accent is unreadable on the field', () => {
    // A dark accent on its own near-black field would make the button and the
    // kicker disappear: the page uses the text colour instead of that accent.
    expect(look('#1F2A44').accent).toBe(IMMERSIVE_TEXT_COLOUR)
    expect(look('#000000').accent).toBe(IMMERSIVE_TEXT_COLOUR)
    expect(look('#C8A45A').accent).toBe('#C8A45A')
  })

  it('refuses a light manual field, which light text cannot be read on', () => {
    const resolved = look('#EAD6A8', '#FFFFFF')
    expect(resolved.field).toBe(deriveFieldColour('#EAD6A8'))
  })

  it('refuses a mid-tone manual field below the text threshold', () => {
    const resolved = look('#EAD6A8', '#808080')
    expect(resolved.field).toBe(deriveFieldColour('#EAD6A8'))
  })

  it('honours a dark manual field that clears the threshold, in upper case', () => {
    const resolved = look('#EAD6A8', '#0a2a1f')
    expect(resolved.field).toBe('#0A2A1F')
    expect(contrastRatio(resolved.accent, resolved.field) ?? 0).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    )
  })

  it.each([
    'red',
    '#fff',
    'rgb(0,0,0)',
    'red; } body { display: none',
    '#EAD6A8; background: url(//evil.example/x)',
    '',
  ])('replaces the unreadable accent %j with the default and never echoes it', (bad) => {
    const resolved = resolveImmersiveLook({
      accentColour: bad,
      fieldColour: '#15110D',
    })
    expect(resolved.accent).toBe(DEFAULT_IMMERSIVE_ACCENT)
    expect(JSON.stringify(resolved)).not.toContain('evil')
    expect(JSON.stringify(resolved)).not.toContain('display')
  })

  it('derives the field from the accent when the stored field is unreadable', () => {
    const resolved = resolveImmersiveLook({
      accentColour: '#C8A45A',
      fieldColour: 'not a colour',
    })
    expect(resolved.field).toBe(deriveFieldColour('#C8A45A'))
  })

  it('exposes only validated hex colours as custom properties', () => {
    for (const { accent } of ACCENTS) {
      const { style } = look(accent)
      expect(Object.keys(style).sort()).toEqual([
        '--ih-accent',
        '--ih-field',
        '--ih-on-accent',
        '--ih-wash-cool',
        '--ih-wash-deep',
        '--ih-wash-warm',
      ])
      for (const value of Object.values(style)) {
        expect(value).toMatch(HEX)
        expect(parseHexColour(value)).not.toBeNull()
      }
    }
  })

  it('takes the washes from the manager accent even when the page draws the text colour', () => {
    expect(look('#1F2A44').style['--ih-wash-warm']).not.toBe(
      look('#C8A45A').style['--ih-wash-warm'],
    )
  })

  it('is deterministic and ignores the letter case of its input', () => {
    expect(look('#ead6a8')).toEqual(look('#EAD6A8'))
  })
})
