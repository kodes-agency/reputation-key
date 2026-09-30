import { describe, expect, it } from 'vitest'
import { getGuestPortalCopy } from './guest-language-pack'
import { resolvePortalLocale } from './portal-localization'

describe('guest Portal language packs', () => {
  it('resolves the exact immutable English and Bulgarian v1 packs', () => {
    expect(getGuestPortalCopy('en', 'guest-ui-en-v1')).toMatchObject({
      locale: 'en',
      version: 'guest-ui-en-v1',
      submitPrivateRating: 'Submit private rating',
    })
    expect(getGuestPortalCopy('bg', 'guest-ui-bg-v1')).toMatchObject({
      locale: 'bg',
      version: 'guest-ui-bg-v1',
      submitPrivateRating: 'Изпрати непубличната оценка',
    })
  })

  it('fails closed instead of rendering copy from a different pinned locale', () => {
    expect(() => getGuestPortalCopy('bg', 'guest-ui-en-v1')).toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })

  it('defaults to the locale\u2019s current pack when none is pinned', () => {
    expect(getGuestPortalCopy('en').version).toBe('guest-ui-en-v1')
    expect(getGuestPortalCopy('bg').version).toBe('guest-ui-bg-v1')
    expect(getGuestPortalCopy().locale).toBe('en')
  })

  it('throws for a locale that has no reviewed pack rather than showing another language', () => {
    expect(() => getGuestPortalCopy('de')).toThrow('No guest language pack exists')
  })
})

describe('resolvePortalLocale', () => {
  it('falls back to English with no localization state', () => {
    expect(resolvePortalLocale(undefined)).toEqual({
      selectedLocale: 'en',
      languagePackVersion: 'guest-ui-en-v1',
    })
  })

  it('uses the pack the snapshot pinned, else the locale\u2019s current pack', () => {
    const base = { primaryLocale: 'en', availableLocales: ['en', 'bg'] } as const
    expect(resolvePortalLocale({ ...base, selectedLocale: 'bg' })).toEqual({
      selectedLocale: 'bg',
      languagePackVersion: 'guest-ui-bg-v1',
    })
    expect(
      resolvePortalLocale({
        ...base,
        selectedLocale: 'en',
        languagePackVersion: 'guest-ui-en-v1',
      }).languagePackVersion,
    ).toBe('guest-ui-en-v1')
  })

  it('throws for a locale with no pack', () => {
    expect(() =>
      resolvePortalLocale({
        selectedLocale: 'fr',
        primaryLocale: 'en',
        availableLocales: ['en', 'fr'],
      }),
    ).toThrow('No guest language pack exists')
  })
})
