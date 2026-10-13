import { describe, expect, it } from 'vitest'
import { copiedLanguagesNote, languagesAfterChange } from './portal-new-follow-source'
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
