// What a portal's own look editor decides without a screen: the words for what a
// portal follows, its photo's languages and descriptions, and what each write sends.
import { describe, expect, it } from 'vitest'
import { PROPERTY_LOOK_SOURCES } from '#/contexts/portal/application/public-api'
import {
  coloursAreUnchanged,
  coloursDraftOf,
  coloursFollowedValue,
  coloursInputOf,
  coloursProblemOf,
  descriptionsOf,
  FOLLOWS_THE_PROPERTY,
  focalInputOf,
  identityFollowedValue,
  logoInputOf,
  offeredLocalesOf,
  photoInputOf,
  wordmarkInputOf,
  wordmarkProblemOf,
} from './portal-look-rules'

const TARGET = { propertyId: 'prop-1', portalId: 'portal-1' } as const

describe('the words', () => {
  it('says what the property’s colours are, automatic or custom', () => {
    expect(
      coloursFollowedValue({
        primaryColor: '#b8860b',
        backgroundColor: '#14110F',
        backgroundMode: 'auto',
      }),
    ).toBe('accent #B8860B, automatic background')
    expect(
      coloursFollowedValue({
        primaryColor: '#B8860B',
        backgroundColor: '#14110f',
        backgroundMode: 'manual',
      }),
    ).toBe('accent #B8860B, custom background #14110F')
    expect(
      coloursFollowedValue({ primaryColor: '#2563EB', backgroundColor: '#FFFFFF' }),
    ).toBe('accent #2563EB, automatic background')
  })

  it('says what a guest sees at the top of a portal that follows the property’s name', () => {
    expect(identityFollowedValue('AVELA', true)).toBe('the property’s logo')
    expect(identityFollowedValue('AVELA', false)).toBe('the wordmark AVELA')
    expect(identityFollowedValue('  ', false)).toBe('the business name')
    expect(identityFollowedValue(null, false)).toBe('the business name')
    expect(identityFollowedValue(undefined, false)).toBe('the business name')
  })

  it('starts a portal with no look of its own on the property’s', () => {
    expect(FOLLOWS_THE_PROPERTY.sources).toBe(PROPERTY_LOOK_SOURCES)
    expect(FOLLOWS_THE_PROPERTY.photo).toEqual({ mode: 'inherit' })
  })
})

describe('languages and descriptions', () => {
  it('asks for a description in each of the portal’s languages, the primary first', () => {
    expect(
      offeredLocalesOf({
        primaryGuestLocale: 'bg',
        additionalGuestLocales: ['en', 'bg'],
      }),
    ).toEqual(['bg', 'en'])
    expect(offeredLocalesOf({})).toEqual(['en'])
  })

  it('keeps the descriptions that say something', () => {
    expect(descriptionsOf({ en: ' The pool at dusk ', bg: '  ' })).toEqual({
      en: 'The pool at dusk',
    })
    expect(descriptionsOf({})).toEqual({})
  })
})

describe('what each write sends', () => {
  const draft = { accent: '#B8860B', backgroundMode: 'auto', field: '#14110F' } as const

  it('sends the typed background only while it is custom', () => {
    expect(coloursInputOf(TARGET, draft)).toEqual({
      ...TARGET,
      colours: { mode: 'own', accentColour: '#B8860B', backgroundMode: 'auto' },
    })
    expect(coloursInputOf(TARGET, { ...draft, backgroundMode: 'manual' })).toEqual({
      ...TARGET,
      colours: {
        mode: 'own',
        accentColour: '#B8860B',
        backgroundMode: 'manual',
        backgroundColour: '#14110F',
      },
    })
  })

  it('reads the colours a portal owns as the colour controls edit them', () => {
    expect(
      coloursDraftOf({
        mode: 'own',
        accentColour: '#b8860b',
        backgroundMode: 'manual',
        backgroundColour: '#14110f',
      }),
    ).toEqual({ accent: '#B8860B', backgroundMode: 'manual', field: '#14110F' })
  })

  it('refuses colours the page cannot show, in the property look’s words', () => {
    expect(coloursProblemOf(draft)).toBeNull()
    expect(coloursProblemOf({ ...draft, accent: '#12' })).toBe(
      'Enter the colours as six hex digits',
    )
    expect(
      coloursProblemOf({ accent: '#B8860B', backgroundMode: 'manual', field: '#FFFFFF' }),
    ).toBe('Page text cannot be read on this background')
  })

  it('does not count a background left over from automatic as a change', () => {
    expect(coloursAreUnchanged(draft, { ...draft, field: '#000000' })).toBe(true)
    expect(coloursAreUnchanged(draft, { ...draft, accent: '#EAD6A8' })).toBe(false)
    expect(
      coloursAreUnchanged(draft, {
        ...draft,
        backgroundMode: 'manual',
        field: '#000000',
      }),
    ).toBe(false)
  })

  it('sends a wordmark trimmed, and an empty one as none', () => {
    expect(wordmarkInputOf(TARGET, '  SPA ')).toEqual({
      ...TARGET,
      identity: { mode: 'own', wordmark: 'SPA' },
    })
    expect(wordmarkInputOf(TARGET, '   ')).toEqual({
      ...TARGET,
      identity: { mode: 'own', wordmark: null },
    })
    expect(wordmarkProblemOf('A'.repeat(24))).toBeNull()
    expect(wordmarkProblemOf('A'.repeat(25))).toBe(
      'The wordmark can be at most 24 characters',
    )
  })

  it('sends the logo alone, so the wordmark is not overwritten', () => {
    expect(logoInputOf(TARGET, 'asset-1')).toEqual({
      ...TARGET,
      identity: { mode: 'own', logoAssetId: 'asset-1' },
    })
    expect(logoInputOf(TARGET, null).identity).toEqual({
      mode: 'own',
      logoAssetId: null,
    })
  })

  it('sends a moved focus point alone, so the photo and its descriptions stay', () => {
    expect(focalInputOf(TARGET, { x: 0.25, y: 0.75 })).toEqual({
      ...TARGET,
      photo: { mode: 'own', focalX: 0.25, focalY: 0.75 },
    })
  })

  it('sends what the photo dialog wrote: the photo, its point and its descriptions', () => {
    expect(
      photoInputOf(TARGET, {
        assetId: 'asset-1',
        focalX: 0.4,
        focalY: 0.6,
        altTexts: [{ locale: 'en', text: 'The pool at dusk' }],
      }),
    ).toEqual({
      ...TARGET,
      photo: {
        mode: 'own',
        heroAssetId: 'asset-1',
        focalX: 0.4,
        focalY: 0.6,
        altTexts: [{ locale: 'en', text: 'The pool at dusk' }],
      },
    })
  })

  it('leaves out what the dialog did not write, and reads no photo as none', () => {
    expect(photoInputOf(TARGET, { assetId: 'asset-1' }).photo).toEqual({
      mode: 'own',
      heroAssetId: 'asset-1',
    })
    expect(photoInputOf(TARGET, { assetId: null }).photo).toEqual({ mode: 'none' })
  })
})
