import { describe, expect, it } from 'vitest'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { contrastRatio } from '#/shared/domain/portal-field-colour'
import {
  assertCompletePortalPublicationExperience,
  selectPortalGuestLocale,
} from './portal-experience'

const experience = {
  primaryGuestLocale: 'en',
  localeSet: ['en', 'bg'],
  languagePackVersions: { en: 'guest-ui-en-v1', bg: 'guest-ui-bg-v1' },
  localizedContent: {
    en: {
      title: 'Tell us about your stay',
      shortDescription: 'Your view matters.',
      heroImageUrl: null,
    },
    bg: {
      title: 'Разкажете ни за престоя си',
      shortDescription: 'Вашето мнение е важно.',
      heroImageUrl: null,
    },
  },
  brandProfile: {
    displayName: 'Example Hotel',
    logoUrl: null,
    defaultHeroImageUrl: null,
    primaryColor: '#1D4ED8',
    backgroundColor: '#FFFFFF',
    textColor: '#111827',
    version: 2,
  },
} as const

describe('Portal localized publication experience', () => {
  it('accepts a complete accessible EN/BG experience', () => {
    expect(() => assertCompletePortalPublicationExperience(experience)).not.toThrow()
  })

  it('rejects a missing enabled translation', () => {
    expect(() =>
      assertCompletePortalPublicationExperience({
        ...experience,
        localizedContent: { en: experience.localizedContent.en },
      }),
    ).toThrow(expect.objectContaining({ code: 'publication_snapshot_unavailable' }))
  })

  it('rejects inaccessible body text', () => {
    expect(contrastRatio('#777777', '#FFFFFF') ?? 99).toBeLessThan(4.5)
    expect(() =>
      assertCompletePortalPublicationExperience({
        ...experience,
        brandProfile: { ...experience.brandProfile, textColor: '#777777' },
      }),
    ).toThrow(expect.objectContaining({ code: 'publication_snapshot_unavailable' }))
  })

  it('selects explicit locale, then signed-session locale, browser language, and primary', () => {
    expect(selectPortalGuestLocale(['en', 'bg'], 'en', 'bg', 'en', 'en-US')).toBe('bg')
    expect(selectPortalGuestLocale(['en', 'bg'], 'en', null, 'bg', 'en-US')).toBe('bg')
    expect(
      selectPortalGuestLocale(['en', 'bg'], 'en', null, null, 'de, bg-BG;q=0.9'),
    ).toBe('bg')
    expect(selectPortalGuestLocale(['en', 'bg'], 'en', null, null, 'de-DE')).toBe('en')
  })

  describe('Accept-Language', () => {
    const pick = (
      acceptLanguage: string,
      set: readonly GuestLocale[] = ['en', 'bg'],
      primary: GuestLocale = 'en',
    ) => selectPortalGuestLocale(set, primary, null, null, acceptLanguage)

    it('honours q-values rather than list order', () => {
      expect(pick('de;q=1, bg;q=0.9')).toBe('bg')
      expect(pick('en;q=0.5, bg;q=0.9')).toBe('bg')
      expect(pick('bg;q=0.2, en;q=0.8', ['en', 'bg'], 'bg')).toBe('en')
    })

    it('keeps list order between equal q-values', () => {
      expect(pick('bg, en')).toBe('bg')
      expect(pick('en;q=0.7, bg;q=0.7')).toBe('en')
    })

    it('drops q=0 entries and unparseable weights', () => {
      expect(pick('bg;q=0, en;q=0.1', ['en', 'bg'], 'bg')).toBe('en')
      expect(pick('bg;q=0', ['en', 'bg'], 'en')).toBe('en')
      expect(pick('bg;q=abc', ['en', 'bg'], 'en')).toBe('en')
    })

    it('matches region tags on their primary language', () => {
      expect(pick('bg-BG')).toBe('bg')
      expect(pick('DE-at, es-MX;q=0.8', ['en', 'es', 'de'], 'en')).toBe('de')
    })

    it('ignores unsupported languages and wildcards', () => {
      expect(pick('pt-BR, zh;q=0.9, *;q=0.1')).toBe('en')
      expect(pick('')).toBe('en')
    })

    it('never picks a locale that is not in the published set', () => {
      expect(pick('de, es', ['en', 'bg'], 'en')).toBe('en')
    })

    it('lets the requested locale and the signed session outrank Accept-Language', () => {
      expect(selectPortalGuestLocale(['en', 'bg'], 'en', 'bg', null, 'en;q=1')).toBe('bg')
      expect(selectPortalGuestLocale(['en', 'bg'], 'en', 'xx', 'bg', 'en;q=1')).toBe('bg')
    })

    it('falls back to the primary locale, not the first of the set, when nothing matches', () => {
      expect(selectPortalGuestLocale(['en', 'bg'], 'bg', null, null, 'de')).toBe('bg')
      expect(selectPortalGuestLocale(['en', 'bg'], 'bg', 'pt', null, null)).toBe('bg')
    })

    it('falls back to the first of the set only when the primary is not in it', () => {
      expect(selectPortalGuestLocale(['bg'], 'en', null, null, 'de')).toBe('bg')
    })
  })
})

describe('Portal language pack check', () => {
  it('rejects a Bulgarian pack recorded for English', () => {
    expect(() =>
      assertCompletePortalPublicationExperience({
        ...experience,
        languagePackVersions: { en: 'guest-ui-bg-v1', bg: 'guest-ui-bg-v1' },
      }),
    ).toThrow(expect.objectContaining({ code: 'publication_snapshot_unavailable' }))
  })

  it('rejects an unknown pack id and a missing pack', () => {
    expect(() =>
      assertCompletePortalPublicationExperience({
        ...experience,
        languagePackVersions: { en: 'guest-ui-en-v1', bg: 'guest-ui-bg-v9' },
      }),
    ).toThrow(expect.objectContaining({ code: 'publication_snapshot_unavailable' }))
    expect(() =>
      assertCompletePortalPublicationExperience({
        ...experience,
        languagePackVersions: { en: 'guest-ui-en-v1' },
      }),
    ).toThrow(expect.objectContaining({ code: 'publication_snapshot_unavailable' }))
  })

  it('rejects a locale that has no pack yet, however complete its content', () => {
    expect(() =>
      assertCompletePortalPublicationExperience({
        ...experience,
        localeSet: ['en', 'de'],
        languagePackVersions: { en: 'guest-ui-en-v1', de: 'guest-ui-de-v1' },
        localizedContent: {
          en: experience.localizedContent.en,
          de: experience.localizedContent.en,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'publication_snapshot_unavailable' }))
  })

  it('rejects a locale outside the catalogue', () => {
    expect(() =>
      assertCompletePortalPublicationExperience({
        ...experience,
        localeSet: ['en', 'pt'],
      } as never),
    ).toThrow(expect.objectContaining({ code: 'publication_snapshot_unavailable' }))
  })
})
