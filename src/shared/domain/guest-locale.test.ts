import { describe, expect, it } from 'vitest'
import {
  GUEST_LANGUAGE_PACKS,
  GUEST_LOCALE_METADATA,
  GUEST_LOCALES,
  OFFERED_GUEST_LOCALES,
  currentGuestLanguagePack,
  guestLocaleFormatTag,
  isGuestLocale,
  isOfferedGuestLocale,
  isValidAdditionalGuestLocales,
  MAX_ADDITIONAL_GUEST_LOCALES,
  isSupportedGuestLanguagePack,
  matchGuestLocale,
  parseGuestLocale,
} from './guest-locale'

describe('guest locale catalogue', () => {
  it('lists the six locales in their display order', () => {
    expect(GUEST_LOCALES).toEqual(['en', 'es', 'it', 'fr', 'de', 'bg'])
  })

  it('has metadata for every locale, with the Cyrillic chip label for Bulgarian', () => {
    for (const code of GUEST_LOCALES) {
      const metadata = GUEST_LOCALE_METADATA[code]
      expect(metadata.code).toBe(code)
      expect(metadata.nativeName.length).toBeGreaterThan(0)
      expect(metadata.englishName.length).toBeGreaterThan(0)
      expect(metadata.intlTag.startsWith(code)).toBe(true)
    }
    expect(GUEST_LOCALE_METADATA.bg.chipLabel).toBe('БГ')
    expect(GUEST_LOCALE_METADATA.bg.script).toBe('Cyrl')
    expect(GUEST_LOCALE_METADATA.de.chipLabel).toBe('DE')
    expect(GUEST_LOCALE_METADATA.en.script).toBe('Latn')
  })

  it('formats dates in the locale-specific tag, keeping today’s bg-BG and en', () => {
    expect(guestLocaleFormatTag('bg')).toBe('bg-BG')
    expect(guestLocaleFormatTag('en')).toBe('en')
    expect(guestLocaleFormatTag('de')).toBe('de')
  })

  it('names every supported pack after its own locale and version number', () => {
    for (const locale of GUEST_LOCALES) {
      for (const pack of GUEST_LANGUAGE_PACKS[locale].supported) {
        expect(pack.id).toMatch(new RegExp(`^guest-ui-${locale}-v[1-9]\\d*$`))
      }
    }
  })

  it('keeps each current pack inside its own supported list', () => {
    for (const locale of GUEST_LOCALES) {
      const { current, supported } = GUEST_LANGUAGE_PACKS[locale]
      if (current !== null) expect(supported.map((pack) => pack.id)).toContain(current)
    }
  })

  it('offers every catalogue locale, each with the generation 2 pack a publication writes', () => {
    expect(OFFERED_GUEST_LOCALES).toEqual(GUEST_LOCALES)
    for (const locale of OFFERED_GUEST_LOCALES) {
      expect(currentGuestLanguagePack(locale, 2)).toBe(`guest-ui-${locale}-v2`)
    }
  })

  it('keeps the generation 1 pack to the two locales the legacy page ever served', () => {
    expect(currentGuestLanguagePack('en')).toBe('guest-ui-en-v1')
    expect(currentGuestLanguagePack('bg')).toBe('guest-ui-bg-v1')
    for (const locale of ['es', 'it', 'fr', 'de'] as const) {
      expect(currentGuestLanguagePack(locale)).toBeNull()
    }
  })

  it('names the generation 1 and generation 2 pack of a locale separately', () => {
    expect(currentGuestLanguagePack('en', 1)).toBe('guest-ui-en-v1')
    expect(currentGuestLanguagePack('bg', 1)).toBe('guest-ui-bg-v1')
    expect(currentGuestLanguagePack('en', 2)).toBe('guest-ui-en-v2')
    expect(currentGuestLanguagePack('bg', 2)).toBe('guest-ui-bg-v2')
    expect(currentGuestLanguagePack('de', 2)).toBe('guest-ui-de-v2')
  })

  it('lists the v1 packs before the v2 packs and never renumbers an id', () => {
    for (const locale of ['en', 'bg'] as const) {
      expect(GUEST_LANGUAGE_PACKS[locale].supported).toEqual([
        { id: `guest-ui-${locale}-v1`, generation: 1 },
        { id: `guest-ui-${locale}-v2`, generation: 2 },
      ])
    }
  })

  it('gives es, it, fr and de a generation 2 pack only: they never had a legacy page', () => {
    for (const locale of ['es', 'it', 'fr', 'de'] as const) {
      expect(GUEST_LANGUAGE_PACKS[locale].supported).toEqual([
        { id: `guest-ui-${locale}-v2`, generation: 2 },
      ])
    }
  })
})

describe('guest locale parsing', () => {
  it('accepts the six exact codes only', () => {
    expect(GUEST_LOCALES.every(isGuestLocale)).toBe(true)
    for (const value of ['EN', 'pt', 'en-US', '', null, undefined, 3]) {
      expect(isGuestLocale(value)).toBe(false)
    }
  })

  it('offers only the catalogue locales, by their exact code', () => {
    expect(OFFERED_GUEST_LOCALES.every(isOfferedGuestLocale)).toBe(true)
    for (const value of ['pt', 'EN', 'de-AT', '', null, undefined, 3]) {
      expect(isOfferedGuestLocale(value)).toBe(false)
    }
  })

  it('returns null instead of coercing an unknown locale to a default', () => {
    expect(parseGuestLocale('bg')).toBe('bg')
    expect(parseGuestLocale('de')).toBe('de')
    expect(parseGuestLocale('pt')).toBeNull()
    expect(parseGuestLocale(undefined)).toBeNull()
  })

  it('matches language tags by their primary subtag, ignoring case', () => {
    expect(matchGuestLocale('es-MX')).toBe('es')
    expect(matchGuestLocale('DE-at')).toBe('de')
    expect(matchGuestLocale('bg')).toBe('bg')
    expect(matchGuestLocale('zh-Hant')).toBeNull()
    expect(matchGuestLocale('pt')).toBeNull()
    expect(matchGuestLocale('')).toBeNull()
    expect(matchGuestLocale('*')).toBeNull()
  })
})

describe('guest language pack membership', () => {
  it('accepts a generation 1 pack only for its own locale', () => {
    expect(isSupportedGuestLanguagePack('en', 'guest-ui-en-v1', 1)).toBe(true)
    expect(isSupportedGuestLanguagePack('bg', 'guest-ui-bg-v1', 1)).toBe(true)
    expect(isSupportedGuestLanguagePack('en', 'guest-ui-bg-v1', 1)).toBe(false)
    expect(isSupportedGuestLanguagePack('bg', 'guest-ui-en-v1', 1)).toBe(false)
  })

  it('rejects unknown ids, non-strings, later generations and locales with no pack', () => {
    expect(isSupportedGuestLanguagePack('en', 'guest-ui-en-v9', 1)).toBe(false)
    expect(isSupportedGuestLanguagePack('en', undefined, 1)).toBe(false)
    expect(isSupportedGuestLanguagePack('en', 7, 1)).toBe(false)
    expect(isSupportedGuestLanguagePack('en', 'guest-ui-en-v1', 2)).toBe(false)
    expect(isSupportedGuestLanguagePack('en', 'guest-ui-en-v3', 2)).toBe(false)
    expect(isSupportedGuestLanguagePack('de', 'guest-ui-de-v1', 1)).toBe(false)
    expect(isSupportedGuestLanguagePack('de', 'guest-ui-de-v1', 2)).toBe(false)
  })

  it('accepts the v2 packs for generation 2 only, so v1 and v2 snapshots still reject them', () => {
    expect(isSupportedGuestLanguagePack('en', 'guest-ui-en-v2', 2)).toBe(true)
    expect(isSupportedGuestLanguagePack('bg', 'guest-ui-bg-v2', 2)).toBe(true)
    expect(isSupportedGuestLanguagePack('en', 'guest-ui-en-v2', 1)).toBe(false)
    expect(isSupportedGuestLanguagePack('bg', 'guest-ui-bg-v2', 1)).toBe(false)
    expect(isSupportedGuestLanguagePack('en', 'guest-ui-bg-v2', 2)).toBe(false)
    expect(isSupportedGuestLanguagePack('bg', 'guest-ui-en-v1', 2)).toBe(false)
  })

  it('accepts the es, it, fr and de packs for generation 2 only, and only for their own locale', () => {
    for (const locale of ['es', 'it', 'fr', 'de'] as const) {
      expect(isSupportedGuestLanguagePack(locale, `guest-ui-${locale}-v2`, 2)).toBe(true)
      expect(isSupportedGuestLanguagePack(locale, `guest-ui-${locale}-v2`, 1)).toBe(false)
      expect(isSupportedGuestLanguagePack('en', `guest-ui-${locale}-v2`, 2)).toBe(false)
    }
  })
})

// The length clause is defence in depth: a unique list of catalogue locales
// without the primary already has at most MAX_ADDITIONAL_GUEST_LOCALES entries,
// so no case here can be refused by length alone.
describe('additional guest locales beside a primary', () => {
  it('leaves room for every catalogue locale except the primary', () => {
    expect(MAX_ADDITIONAL_GUEST_LOCALES).toBe(5)
    expect(isValidAdditionalGuestLocales('de', ['en', 'es', 'it', 'fr', 'bg'])).toBe(true)
    expect(isValidAdditionalGuestLocales('en', [])).toBe(true)
  })

  it.each([
    ['repeats the primary', 'en', ['en']],
    ['repeats itself', 'en', ['bg', 'bg']],
    ['names a locale outside the catalogue', 'en', ['pt']],
    [
      'repeats a locale at the catalogue size',
      'en',
      ['es', 'it', 'fr', 'de', 'bg', 'bg'],
    ],
    ['holds a non-string', 'en', [null]],
  ] as const)('refuses a list that %s', (_label, primary, additional) => {
    expect(isValidAdditionalGuestLocales(primary, additional)).toBe(false)
  })
})
