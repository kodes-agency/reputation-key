import { describe, expect, it } from 'vitest'
import {
  copiedLanguagesNote,
  copiedLookLine,
  languagesAfterChange,
} from './portal-new-follow-source'
import type { PortalNewSource } from './portal-new-types'

const options = { defaultGuestLocales: ['en'] as const }
const sources: PortalNewSource[] = [
  {
    portalId: 'a',
    name: 'Pool & Terrace',
    primaryGuestLocale: 'bg',
    additionalGuestLocales: ['en'],
  },
  { portalId: 'b', name: 'B', primaryGuestLocale: 'de', additionalGuestLocales: ['fr'] },
]

describe('languagesAfterChange', () => {
  it('brings the languages of the portal being copied', () => {
    expect(languagesAfterChange(options, sources, 'portal', 'a')).toEqual(['bg', 'en'])
  })

  it('brings the Property languages back when starting from the Property wording', () => {
    expect(languagesAfterChange(options, sources, 'property', 'a')).toEqual(['en'])
  })

  it('keeps the Property languages until a portal is chosen', () => {
    expect(languagesAfterChange(options, sources, 'portal', '')).toEqual(['en'])
  })

  it('brings the languages of a copied portal that uses German and French', () => {
    expect(languagesAfterChange(options, sources, 'portal', 'b')).toEqual(['de', 'fr'])
  })

  it('keeps the Property languages when the copied portal cannot be found', () => {
    expect(languagesAfterChange(options, sources, 'portal', 'missing')).toEqual(['en'])
  })
})

describe('copiedLanguagesNote', () => {
  it('says which languages the copy brought, by name', () => {
    expect(copiedLanguagesNote(sources, 'portal', 'a', false)).toBe(
      'Copied from Pool & Terrace: Български, English.',
    )
  })

  it('says the person’s own choice stays once they have made one', () => {
    expect(copiedLanguagesNote(sources, 'portal', 'a', true)).toBe(
      'Keeps the languages you chose, not Pool & Terrace’s.',
    )
  })

  it('says nothing for the Property wording, before a portal is chosen, or for a portal that is gone', () => {
    expect(copiedLanguagesNote(sources, 'property', 'a', false)).toBeNull()
    expect(copiedLanguagesNote(sources, 'portal', '', false)).toBeNull()
    expect(copiedLanguagesNote(sources, 'portal', 'missing', false)).toBeNull()
  })
})

describe('copiedLookLine', () => {
  const withLook: PortalNewSource[] = [
    ...sources,
    {
      portalId: 'spa',
      name: 'Spa',
      primaryGuestLocale: 'en',
      additionalGuestLocales: [],
      lookSources: { photo: 'portal', colours: 'property', identity: 'property' },
    },
    {
      portalId: 'bar',
      name: 'Bar',
      primaryGuestLocale: 'en',
      additionalGuestLocales: [],
      lookSources: { photo: 'property', colours: 'property', identity: 'property' },
    },
  ]

  it('says the new portal follows the property look when it starts from the property’s wording', () => {
    expect(copiedLookLine(withLook, 'property', 'spa')).toBe('Look: the property look')
  })

  it('says a copy of a portal with a look of its own carries it', () => {
    expect(copiedLookLine(withLook, 'portal', 'spa')).toBe('Look: same as Spa')
  })

  it('says the property look for a copy of a portal that follows it, or has no read of its look', () => {
    expect(copiedLookLine(withLook, 'portal', 'bar')).toBe('Look: the property look')
    expect(copiedLookLine(withLook, 'portal', 'a')).toBe('Look: the property look')
  })

  it('says the property look until a portal is chosen, or when it is gone', () => {
    expect(copiedLookLine(withLook, 'portal', '')).toBe('Look: the property look')
    expect(copiedLookLine(withLook, 'portal', 'missing')).toBe('Look: the property look')
  })

  it('counts a portal that shows no photo as having a look of its own', () => {
    const none: PortalNewSource[] = [
      {
        portalId: 'n',
        name: 'Kiosk',
        primaryGuestLocale: 'en',
        additionalGuestLocales: [],
        lookSources: { photo: 'none', colours: 'property', identity: 'property' },
      },
    ]

    expect(copiedLookLine(none, 'portal', 'n')).toBe('Look: same as Kiosk')
  })
})
