import { describe, expect, it } from 'vitest'
import {
  assertCompletePortalPublicationExperience,
  contrastRatio,
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
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.5)
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
})
