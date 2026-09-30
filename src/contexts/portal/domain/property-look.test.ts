import { describe, expect, it } from 'vitest'
import {
  HERO_ALT_TEXT_MAX_LENGTH,
  WORDMARK_MAX_LENGTH,
  changedLookFacets,
  lookPendingKey,
  normaliseDefaultGuestLocales,
  normaliseHeroAltText,
  normaliseWordmark,
  type PropertyLook,
} from './property-look'

const look = (overrides: Partial<PropertyLook> = {}): PropertyLook => ({
  primaryColor: '#2563EB',
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
  backgroundMode: 'auto',
  wordmark: null,
  logoUrl: null,
  defaultHeroImageUrl: null,
  ...overrides,
})

describe('normaliseWordmark', () => {
  it('trims, keeps a name within the limit and turns an empty one into none', () => {
    expect(normaliseWordmark('  KODES  ')).toBe('KODES')
    expect(normaliseWordmark('')).toBeNull()
    expect(normaliseWordmark('   ')).toBeNull()
    expect(normaliseWordmark(null)).toBeNull()
  })

  it('accepts exactly the limit and refuses one more', () => {
    expect(normaliseWordmark('a'.repeat(WORDMARK_MAX_LENGTH))).toHaveLength(
      WORDMARK_MAX_LENGTH,
    )
    expect(() => normaliseWordmark('a'.repeat(WORDMARK_MAX_LENGTH + 1))).toThrow(
      expect.objectContaining({ code: 'invalid_description' }),
    )
  })

  it('counts the trimmed text, not the padding', () => {
    expect(normaliseWordmark(` ${'a'.repeat(WORDMARK_MAX_LENGTH)} `)).toHaveLength(
      WORDMARK_MAX_LENGTH,
    )
  })
})

describe('normaliseHeroAltText', () => {
  it('trims, and treats empty as none', () => {
    expect(normaliseHeroAltText('  Lobby at dusk ')).toBe('Lobby at dusk')
    expect(normaliseHeroAltText(' ')).toBeNull()
    expect(normaliseHeroAltText(null)).toBeNull()
  })

  it('refuses text over the limit', () => {
    expect(() => normaliseHeroAltText('a'.repeat(HERO_ALT_TEXT_MAX_LENGTH + 1))).toThrow(
      expect.objectContaining({ code: 'invalid_description' }),
    )
  })
})

describe('normaliseDefaultGuestLocales', () => {
  it('keeps the order given, first being the primary', () => {
    expect(normaliseDefaultGuestLocales(['bg', 'en'])).toEqual(['bg', 'en'])
  })

  it('refuses an empty set', () => {
    expect(() => normaliseDefaultGuestLocales([])).toThrow(
      expect.objectContaining({ code: 'locale_not_offered' }),
    )
  })

  it('refuses a language given twice', () => {
    expect(() => normaliseDefaultGuestLocales(['en', 'en'])).toThrow(
      expect.objectContaining({ code: 'locale_not_offered' }),
    )
  })

  it('refuses a language outside the catalogue', () => {
    expect(() => normaliseDefaultGuestLocales(['en', 'xx' as never])).toThrow(
      expect.objectContaining({ code: 'locale_not_offered' }),
    )
  })

  it('refuses more than six', () => {
    expect(() =>
      normaliseDefaultGuestLocales(['en', 'es', 'it', 'fr', 'de', 'bg', 'en']),
    ).toThrow(expect.objectContaining({ code: 'locale_not_offered' }))
  })

  it('accepts all six', () => {
    expect(
      normaliseDefaultGuestLocales(['en', 'es', 'it', 'fr', 'de', 'bg']),
    ).toHaveLength(6)
  })
})

describe('lookPendingKey', () => {
  it('namespaces the facet under look:', () => {
    expect(lookPendingKey('accent')).toBe('look:accent')
    expect(lookPendingKey('wordmark')).toBe('look:wordmark')
  })
})

describe('changedLookFacets', () => {
  it('is empty when nothing moved', () => {
    expect(changedLookFacets(look(), look())).toEqual([])
  })

  it('names the accent when the primary colour moves', () => {
    expect(changedLookFacets(look(), look({ primaryColor: '#C8A45A' }))).toEqual([
      'accent',
    ])
  })

  it('names the field for a mode or background change, once', () => {
    expect(changedLookFacets(look(), look({ backgroundMode: 'manual' }))).toEqual([
      'field',
    ])
    expect(changedLookFacets(look(), look({ backgroundColor: '#000000' }))).toEqual([
      'field',
    ])
    expect(
      changedLookFacets(
        look(),
        look({ backgroundMode: 'manual', backgroundColor: '#000000' }),
      ),
    ).toEqual(['field'])
  })

  it('names text, wordmark and images separately', () => {
    expect(changedLookFacets(look(), look({ textColor: '#000000' }))).toEqual(['text'])
    expect(changedLookFacets(look(), look({ wordmark: 'KODES' }))).toEqual(['wordmark'])
    expect(changedLookFacets(look(), look({ logoUrl: 'https://x.test/l.png' }))).toEqual([
      'images',
    ])
    expect(
      changedLookFacets(look(), look({ defaultHeroImageUrl: 'https://x.test/h.png' })),
    ).toEqual(['images'])
  })

  it('lists every moved facet in a fixed order', () => {
    expect(
      changedLookFacets(
        look(),
        look({ wordmark: 'K', primaryColor: '#C8A45A', textColor: '#000000' }),
      ),
    ).toEqual(['accent', 'text', 'wordmark'])
  })
})
