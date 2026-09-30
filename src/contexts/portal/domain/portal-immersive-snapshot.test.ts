import { describe, expect, it } from 'vitest'
import {
  bulgarianPrimaryConfiguration,
  IMMERSIVE_FIXTURE_SCOPE,
  immersiveConfiguration,
} from './__fixtures__/immersive-configuration'
import {
  isCompleteImmersiveConfiguration,
  isValidTimeZone,
} from './portal-immersive-snapshot'
import type { ImmersivePortalPublicationConfiguration } from './portal-publication-snapshot'

const complete = (overrides: Partial<ImmersivePortalPublicationConfiguration> = {}) =>
  isCompleteImmersiveConfiguration(immersiveConfiguration(overrides))

const base = immersiveConfiguration()
const baseLinks = base.links
const firstLink = baseLinks[0]
const secondLink = baseLinks[1]
if (!firstLink || !secondLink) throw new Error('fixture needs two links')
const content = base.localizedContent

describe('isCompleteImmersiveConfiguration', () => {
  it('accepts the complete English-primary fixture with a fallback copy', () => {
    expect(complete()).toBe(true)
    expect(IMMERSIVE_FIXTURE_SCOPE.portalId).toBe(base.portal.id)
  })

  it('accepts a single-language portal with no links and no photo', () => {
    expect(
      complete({
        localeSet: ['en'],
        languagePackVersions: { en: 'guest-ui-en-v2' },
        localizedContent: { en: content.en },
        links: [],
        brandProfile: { ...base.brandProfile, logo: null, hero: null, wordmark: null },
      }),
    ).toBe(true)
  })

  it('accepts a Bulgarian-primary portal, primary first', () => {
    expect(isCompleteImmersiveConfiguration(bulgarianPrimaryConfiguration())).toBe(true)
  })

  it('rejects the English-primary wording declared Bulgarian-primary: the primary cannot be a copy', () => {
    expect(
      complete({
        guestLocale: 'bg',
        languagePackVersion: 'guest-ui-bg-v2',
        localeSet: ['bg', 'en'],
      }),
    ).toBe(false)
  })

  describe('locales and packs', () => {
    it('rejects a primary locale that is not first in the set', () => {
      expect(complete({ localeSet: ['bg', 'en'] })).toBe(false)
    })

    it('rejects an empty, duplicated or unknown locale set', () => {
      expect(complete({ localeSet: [] })).toBe(false)
      expect(complete({ localeSet: ['en', 'en'] })).toBe(false)
      expect(
        complete({ localeSet: ['en', 'pt'] as unknown as readonly ['en', 'bg'] }),
      ).toBe(false)
    })

    it('rejects generation 1 packs: a v3 snapshot carries only generation 2', () => {
      expect(
        complete({
          languagePackVersion: 'guest-ui-en-v1',
          languagePackVersions: { en: 'guest-ui-en-v1', bg: 'guest-ui-bg-v2' },
        }),
      ).toBe(false)
      expect(
        complete({
          languagePackVersions: { en: 'guest-ui-en-v2', bg: 'guest-ui-bg-v1' },
        }),
      ).toBe(false)
    })

    it('rejects the pack of another locale, an unknown pack and a locale with no pack', () => {
      expect(
        complete({
          languagePackVersions: { en: 'guest-ui-bg-v2', bg: 'guest-ui-bg-v2' },
        }),
      ).toBe(false)
      expect(
        complete({
          languagePackVersions: { en: 'guest-ui-en-v9', bg: 'guest-ui-bg-v2' },
        }),
      ).toBe(false)
      expect(
        complete({
          localeSet: ['en', 'de'],
          languagePackVersions: { en: 'guest-ui-en-v2', de: 'guest-ui-de-v2' },
          localizedContent: { en: content.en, de: content.bg },
          links: [],
        }),
      ).toBe(false)
    })

    it('rejects a pack map with a missing or extra locale', () => {
      expect(complete({ languagePackVersions: { en: 'guest-ui-en-v2' } })).toBe(false)
      expect(
        complete({
          languagePackVersions: {
            en: 'guest-ui-en-v2',
            bg: 'guest-ui-bg-v2',
            de: 'guest-ui-en-v2',
          },
        }),
      ).toBe(false)
    })

    it('rejects a singular pack that is not the primary locale pack', () => {
      expect(complete({ languagePackVersion: 'guest-ui-bg-v2' })).toBe(false)
    })
  })

  describe('localized content', () => {
    it('rejects a locale with no content, and content for a locale not offered', () => {
      expect(complete({ localizedContent: { en: content.en } })).toBe(false)
      expect(
        complete({
          localizedContent: { en: content.en, bg: content.bg, de: content.bg },
        }),
      ).toBe(false)
    })

    it('rejects a blank or over-long title and short description', () => {
      const withEnglish = (en: typeof content.en) =>
        complete({ localizedContent: { ...content, en } })
      expect(
        withEnglish({ ...content.en!, title: { value: ' ', fallbackFrom: null } }),
      ).toBe(false)
      expect(
        withEnglish({
          ...content.en!,
          title: { value: 'x'.repeat(121), fallbackFrom: null },
        }),
      ).toBe(false)
      expect(
        withEnglish({
          ...content.en!,
          shortDescription: { value: '', fallbackFrom: null },
        }),
      ).toBe(false)
    })

    it('needs a Linktree title only while the Linktree has links to show', () => {
      const blankTitle = (locale: 'en' | 'bg') => ({
        ...content,
        [locale]: {
          ...content[locale]!,
          linktreeTitle: { value: '', fallbackFrom: null },
        },
      })
      expect(complete({ localizedContent: blankTitle('en') })).toBe(false)
      expect(
        complete({ linktree: { enabled: false }, localizedContent: blankTitle('en') }),
      ).toBe(true)
      expect(complete({ links: [], localizedContent: blankTitle('en') })).toBe(true)
    })
  })

  describe('fallbackFrom', () => {
    const fallbackBg = (
      overrides: Partial<NonNullable<typeof content.bg>['title']>,
    ): Partial<ImmersivePortalPublicationConfiguration> => ({
      localizedContent: {
        ...content,
        bg: {
          ...content.bg!,
          title: { value: 'Tell us about your visit', ...overrides } as never,
        },
      },
    })

    it('accepts a copy of the primary text tagged with its source', () => {
      expect(complete(fallbackBg({ fallbackFrom: 'en' }))).toBe(true)
    })

    it('rejects a copy that does not say what its source says', () => {
      expect(complete(fallbackBg({ value: 'Something else', fallbackFrom: 'en' }))).toBe(
        false,
      )
    })

    it('rejects a copy from itself, from a locale outside the set, or from a copy', () => {
      expect(complete(fallbackBg({ fallbackFrom: 'bg' }))).toBe(false)
      expect(complete(fallbackBg({ fallbackFrom: 'de' }))).toBe(false)
      expect(
        complete({
          localizedContent: {
            en: { ...content.en!, title: { value: 'x', fallbackFrom: 'bg' } },
            bg: { ...content.bg!, title: { value: 'x', fallbackFrom: 'en' } },
          },
        }),
      ).toBe(false)
    })

    it('rejects a primary text that is itself a fallback', () => {
      expect(
        complete({
          localizedContent: {
            en: { ...content.en!, heroAlt: { value: 'x', fallbackFrom: 'bg' } },
            bg: { ...content.bg!, heroAlt: { value: 'x', fallbackFrom: null } },
          },
        }),
      ).toBe(false)
    })
  })

  describe('links', () => {
    const withLinks = (links: ImmersivePortalPublicationConfiguration['links']) =>
      complete({ links })

    it('rejects a link with no text for a locale, or text for a locale not offered', () => {
      const { bg: _bg, ...onlyEnglish } = firstLink.texts
      expect(withLinks([{ ...firstLink, texts: onlyEnglish }])).toBe(false)
      expect(
        withLinks([
          { ...firstLink, texts: { ...firstLink.texts, de: firstLink.texts.en! } },
        ]),
      ).toBe(false)
    })

    it('rejects blank labels, a blank line and a link that is not https', () => {
      const en = firstLink.texts.en!
      const edited = (text: typeof en) => ({
        ...firstLink,
        texts: { ...firstLink.texts, en: text },
      })
      expect(withLinks([edited({ ...en, label: ' ' })])).toBe(false)
      expect(withLinks([edited({ ...en, line: '  ' })])).toBe(false)
      expect(withLinks([{ ...firstLink, url: 'http://harbor.example.com' }])).toBe(false)
      expect(withLinks([{ ...firstLink, url: 'not a url' }])).toBe(false)
    })

    it('rejects duplicate link ids and more links than the cap', () => {
      expect(withLinks([firstLink, { ...secondLink, id: firstLink.id }])).toBe(false)
      const many = Array.from({ length: 51 }, (_, index) => ({
        ...firstLink,
        id: `link-${index}`,
      }))
      expect(withLinks(many)).toBe(false)
    })

    it('accepts a portal that keeps more than four links, up to the cap', () => {
      const five = Array.from({ length: 5 }, (_, index) => ({
        ...firstLink,
        id: `link-${index}`,
      }))
      expect(withLinks(five)).toBe(true)
    })

    it('rejects an unusable icon key and an oversized asset id', () => {
      expect(withLinks([{ ...firstLink, iconKey: 'Not An Icon' }])).toBe(false)
      expect(withLinks([{ ...firstLink, imageAssetId: 'a'.repeat(65) }])).toBe(false)
    })

    it('checks a copied link text against its source, label and line together', () => {
      const copied = (line: string | null) => ({
        ...secondLink,
        texts: {
          en: { label: 'Spa', line: null, fallbackFrom: null },
          bg: { label: 'Spa', line, fallbackFrom: 'en' as const },
        },
      })
      expect(withLinks([copied(null)])).toBe(true)
      expect(withLinks([copied('Open daily')])).toBe(false)
    })
  })

  describe('look and time zone', () => {
    const brand = base.brandProfile
    const withBrand = (overrides: Partial<typeof brand>) =>
      complete({ brandProfile: { ...brand, ...overrides } })

    it('rejects a malformed colour, look version or display name', () => {
      expect(withBrand({ accentColour: 'gold' })).toBe(false)
      expect(withBrand({ fieldColour: '#FFF' })).toBe(false)
      expect(withBrand({ lookVersion: 0 })).toBe(false)
      expect(withBrand({ displayName: ' ' })).toBe(false)
    })

    it('rejects a wordmark over 24 characters, and a blank one', () => {
      expect(withBrand({ wordmark: 'W'.repeat(25) })).toBe(false)
      expect(withBrand({ wordmark: '' })).toBe(false)
    })

    it('rejects media with impossible dimensions or a focal point off the photo', () => {
      expect(withBrand({ logo: { ...brand.logo!, width: 0 } })).toBe(false)
      expect(withBrand({ hero: { ...brand.hero!, height: 1.5 } })).toBe(false)
      expect(withBrand({ hero: { ...brand.hero!, focalX: 1.2 } })).toBe(false)
      expect(withBrand({ hero: { ...brand.hero!, focalY: -0.1 } })).toBe(false)
    })

    it('rejects an unknown time zone', () => {
      expect(complete({ timeZone: 'Mars/Olympus' })).toBe(false)
      expect(complete({ timeZone: '' })).toBe(false)
    })
  })
})

describe('isValidTimeZone', () => {
  it.each(['Europe/Sofia', 'America/New_York', 'UTC'])('accepts %s', (zone) => {
    expect(isValidTimeZone(zone)).toBe(true)
  })

  it.each(['', 'Sofia', 'Europe/Nowhere'])('rejects %j', (zone) => {
    expect(isValidTimeZone(zone)).toBe(false)
  })
})
