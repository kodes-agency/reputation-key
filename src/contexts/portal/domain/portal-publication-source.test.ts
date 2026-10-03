import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PORTAL_ACCENT,
  resolvePortalPublication,
  type PortalPublicationSource,
} from './portal-publication-source'
import { isCompleteImmersiveConfiguration } from './portal-immersive-snapshot'
import { immersiveConfiguration } from './__fixtures__/immersive-configuration'
import {
  publicationSource,
  SOURCE_HERO_ASSET_ID,
  SOURCE_TILE_ASSET_ID,
} from './__fixtures__/publication-source'

const resolve = (overrides: Partial<PortalPublicationSource> = {}) =>
  resolvePortalPublication(publicationSource(overrides))

/** The resolved content, wrapped in a configuration the verifier can judge. */
const verifies = (content: ReturnType<typeof resolve>['content']) =>
  isCompleteImmersiveConfiguration({
    ...immersiveConfiguration(),
    ...content,
  })

describe('resolvePortalPublication', () => {
  describe('a complete source', () => {
    it('has nothing to block or warn about', () => {
      const { blockers, warnings } = resolve()

      expect(blockers).toEqual([])
      expect(warnings).toEqual([])
    })

    it('writes every text as written in its own language', () => {
      const { content } = resolve()

      expect(content.localizedContent.bg?.title).toEqual({
        value: 'Разкажете ни за посещението си',
        fallbackFrom: null,
      })
      expect(content.links[0]?.texts.bg).toEqual({
        label: 'Меню',
        line: 'Закуска до 11',
        fallbackFrom: null,
      })
    })

    it('carries the scope-free facts the page needs, primary first', () => {
      const { content } = resolve({ primaryGuestLocale: 'bg', localeSet: ['bg', 'en'] })

      expect(content).toMatchObject({
        portal: { id: '10000000-0000-4000-8000-000000000001', slug: 'harbor' },
        guestLocale: 'bg',
        languagePackVersion: 'guest-ui-bg-v2',
        localeSet: ['bg', 'en'],
        languagePackVersions: { bg: 'guest-ui-bg-v2', en: 'guest-ui-en-v2' },
        linktree: { enabled: true },
        timeZone: 'Europe/Sofia',
      })
    })

    it('resolves to content the verifier accepts', () => {
      expect(verifies(resolve().content)).toBe(true)
    })

    it('keeps the links in the order the reader gave them', () => {
      const { content } = resolve()

      expect(content.links.map((link) => link.id)).toEqual([
        '30000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000002',
      ])
      expect(content.links[1]).toMatchObject({
        iconKey: null,
        imageAssetId: SOURCE_TILE_ASSET_ID,
        url: 'https://harbor.example.com/spa',
      })
    })
  })

  describe('gaps in a language that is not the primary', () => {
    const gapped = () =>
      resolve({
        wording: {
          en: publicationSource().wording.en!,
          bg: { title: null, shortDescription: null, heroAlt: null, linktreeTitle: null },
        },
        links: [
          {
            ...publicationSource().links[0]!,
            texts: { en: { label: 'Menu', line: 'Soon', provenance: null } },
          },
        ],
      })

    it('copies the primary language in and tags where it came from', () => {
      const { content } = gapped()

      expect(content.localizedContent.bg).toMatchObject({
        title: { value: 'Tell us about your visit', fallbackFrom: 'en' },
        shortDescription: {
          value: 'Rate your visit to the Harbor Hotel.',
          fallbackFrom: 'en',
        },
        heroAlt: { value: 'The Harbor Hotel at dusk', fallbackFrom: 'en' },
      })
      expect(content.links[0]?.texts.bg).toEqual({
        label: 'Menu',
        line: 'Soon',
        fallbackFrom: 'en',
      })
    })

    it('is a warning for each copied text, never a blocker', () => {
      const { blockers, warnings } = gapped()

      expect(blockers).toEqual([])
      expect(warnings).toEqual(
        expect.arrayContaining([
          { code: 'text_copied_from_primary', locale: 'bg', key: 'title' },
          { code: 'text_copied_from_primary', locale: 'bg', key: 'shortDescription' },
          { code: 'text_copied_from_primary', locale: 'bg', key: 'heroAlt' },
          {
            code: 'text_copied_from_primary',
            locale: 'bg',
            key: 'link:30000000-0000-4000-8000-000000000001',
          },
        ]),
      )
    })

    it('still verifies, because the tag is honest', () => {
      expect(verifies(gapped().content)).toBe(true)
    })

    it('copies the label and the line as one unit', () => {
      const { content } = resolve({
        links: [
          {
            ...publicationSource().links[0]!,
            texts: {
              en: { label: 'Menu', line: 'English line', provenance: null },
              bg: { label: 'Меню', line: null, provenance: null },
            },
          },
        ],
      })

      expect(content.links[0]?.texts.bg).toEqual({
        label: 'Меню',
        line: null,
        fallbackFrom: null,
      })
    })
  })

  describe('gaps in the primary language', () => {
    it('blocks when the title is missing', () => {
      const { blockers } = resolve({
        wording: {
          en: { ...publicationSource().wording.en!, title: null },
          bg: publicationSource().wording.bg!,
        },
      })

      expect(blockers).toEqual([
        { code: 'primary_text_missing', locale: 'en', key: 'title' },
      ])
    })

    it('blocks when the primary language has no wording at all', () => {
      const { blockers } = resolve({ wording: { bg: publicationSource().wording.bg! } })

      expect(blockers).toEqual([
        { code: 'primary_text_missing', locale: 'en', key: 'title' },
        { code: 'primary_text_missing', locale: 'en', key: 'shortDescription' },
      ])
    })

    it('blocks when a link has no primary wording', () => {
      const { blockers } = resolve({
        links: [{ ...publicationSource().links[0]!, texts: {} }],
      })

      expect(blockers).toEqual([
        {
          code: 'primary_text_missing',
          locale: 'en',
          key: 'link:30000000-0000-4000-8000-000000000001',
        },
      ])
    })

    it('treats blank wording as missing', () => {
      const { blockers } = resolve({
        wording: {
          en: { ...publicationSource().wording.en!, shortDescription: '   ' },
        },
      })

      expect(blockers).toEqual([
        { code: 'primary_text_missing', locale: 'en', key: 'shortDescription' },
      ])
    })
  })

  describe('the photo description', () => {
    it('is empty when there is no hero photo, whatever was written', () => {
      const { content } = resolve({
        look: { ...publicationSource().look!, hero: null },
      })

      expect(content.localizedContent.en?.heroAlt).toEqual({
        value: '',
        fallbackFrom: null,
      })
      expect(content.localizedContent.bg?.heroAlt).toEqual({
        value: '',
        fallbackFrom: null,
      })
      expect(content.brandProfile.hero).toBeNull()
    })

    it('is empty everywhere when the primary language wrote none: decorative, not missing', () => {
      const { content, blockers, warnings } = resolve({
        wording: {
          en: { ...publicationSource().wording.en!, heroAlt: null },
          bg: publicationSource().wording.bg!,
        },
      })

      expect(blockers).toEqual([])
      expect(content.localizedContent.en?.heroAlt.value).toBe('')
      expect(warnings.some((warning) => warning.key === 'heroAlt')).toBe(false)
    })
  })

  describe('the Linktree title', () => {
    it('reads the language pack default when none was written, never another language', () => {
      const { content } = resolve()

      expect(content.localizedContent.en?.linktreeTitle).toEqual({
        value: 'Useful links',
        fallbackFrom: null,
      })
      expect(content.localizedContent.bg?.linktreeTitle).toEqual({
        value: 'Полезни връзки',
        fallbackFrom: null,
      })
    })

    it('uses a title the manager wrote', () => {
      const { content } = resolve({
        wording: {
          en: { ...publicationSource().wording.en!, linktreeTitle: 'Around the hotel' },
          bg: publicationSource().wording.bg!,
        },
      })

      expect(content.localizedContent.en?.linktreeTitle.value).toBe('Around the hotel')
    })

    it('carries the switch', () => {
      expect(resolve({ linktreeEnabled: false }).content.linktree).toEqual({
        enabled: false,
      })
    })
  })

  describe('the look', () => {
    it('gives a property with no brand profile the default: champagne on a dark field', () => {
      const { content, blockers } = resolve({ look: null })

      expect(blockers).toEqual([])
      expect(content.brandProfile).toMatchObject({
        displayName: 'Harbor lobby',
        wordmark: null,
        logo: null,
        hero: null,
        accentColour: DEFAULT_PORTAL_ACCENT,
        lookVersion: 1,
      })
      expect(content.brandProfile.fieldColour).toMatch(/^#[0-9a-f]{6}$/iu)
      expect(verifies(content)).toBe(true)
    })

    it('derives the field from the accent unless the Property chose it by hand', () => {
      const auto = resolve().content.brandProfile.fieldColour
      const manual = resolve({
        look: {
          ...publicationSource().look!,
          backgroundMode: 'manual',
          backgroundColour: '#202A30',
        },
      }).content.brandProfile.fieldColour

      expect(auto).not.toBe('#101010')
      expect(manual).toBe('#202A30')
    })

    it('names the hero and logo by asset, with the focal point', () => {
      const { brandProfile } = resolve().content

      expect(brandProfile.hero).toEqual({
        assetId: SOURCE_HERO_ASSET_ID,
        width: 1600,
        height: 1000,
        focalX: 0.4,
        focalY: 0.6,
      })
      expect(brandProfile.logo).toMatchObject({ width: 480, height: 120 })
      expect(brandProfile.lookVersion).toBe(3)
    })
  })

  describe('what the property and the languages must provide', () => {
    it('does not block a language whose generation 2 pack exists', () => {
      const { blockers, content } = resolve({
        localeSet: ['en', 'es'],
        wording: {
          en: publicationSource().wording.en!,
          es: publicationSource().wording.en!,
        },
        links: [],
      })

      expect(blockers).toEqual([])
      expect(content.languagePackVersions).toEqual({
        en: 'guest-ui-en-v2',
        es: 'guest-ui-es-v2',
      })
    })

    it.each([null, 'EST', '+02:00', 'europe/sofia'])(
      'blocks an unusable time zone: %s',
      (timeZone) => {
        expect(resolve({ timeZone }).blockers).toEqual([{ code: 'time_zone_invalid' }])
      },
    )
  })

  describe('provenance', () => {
    it('is absent when every text was written by a person', () => {
      expect(resolve().content).not.toHaveProperty('provenance')
    })

    it('names the link texts that began as AI drafts, for history only', () => {
      const { content } = resolve({
        links: [
          {
            ...publicationSource().links[0]!,
            texts: {
              en: { label: 'Menu', line: null, provenance: null },
              bg: { label: 'Меню', line: null, provenance: 'ai_draft' },
            },
          },
        ],
      })

      expect(content.provenance).toEqual({
        aiDraftTextKeys: ['link:30000000-0000-4000-8000-000000000001:text:bg'],
      })
    })
  })
})
