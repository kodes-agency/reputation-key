import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  IMMERSIVE_FIXTURE_AT,
  IMMERSIVE_FIXTURE_GOOGLE_URI,
  IMMERSIVE_FIXTURE_SCOPE,
  IMMERSIVE_HERO_ASSET_ID,
  IMMERSIVE_LOGO_ASSET_ID,
  IMMERSIVE_TILE_ASSET_ID,
  immersiveConfiguration,
  immersiveSnapshot,
  immersiveSnapshotWith,
} from '../__fixtures__/immersive-snapshot'
import type { ImmersivePortalPublicationConfiguration } from '../../domain/portal-publication-snapshot'
import {
  resolvePublicPortalToken,
  type ResolvePublicPortalTokenDeps,
} from './resolve-public-portal-token'

const MENU_URL = 'https://harbor.example.com/menu'
const SPA_URL = 'https://harbor.example.com/spa'
const MEDIA = {
  [IMMERSIVE_HERO_ASSET_ID]: 'https://media.example.test/hero.webp',
  [IMMERSIVE_LOGO_ASSET_ID]: 'https://media.example.test/logo.webp',
  [IMMERSIVE_TILE_ASSET_ID]: 'https://media.example.test/tile.webp',
}

const token = {
  organizationId: IMMERSIVE_FIXTURE_SCOPE.organizationId,
  propertyId: IMMERSIVE_FIXTURE_SCOPE.propertyId,
  portalId: IMMERSIVE_FIXTURE_SCOPE.portalId,
  version: 1,
} as const

type Overrides = Partial<ResolvePublicPortalTokenDeps> & {
  snapshot?: ReturnType<typeof immersiveSnapshot>
}

function setup({ snapshot = immersiveSnapshot(), ...deps }: Overrides = {}) {
  const listApproved = vi.fn(
    async (
      _org: unknown,
      _property: unknown,
      uris: readonly string[],
    ): Promise<readonly string[]> => uris,
  )
  const resolve = resolvePublicPortalToken({
    tokenCodec: {
      digest: () => ({ tokenIdentifier: 'key', tokenHash: 'hash', tokenKeyVersion: 1 }),
    },
    portalPublicationRepo: {
      resolveActiveByTokenDigest: async () => ({ token, snapshot }),
    },
    portalHealthRepo: {
      getCurrent: async () => ({
        id: 'health-1',
        organizationId: organizationId(token.organizationId),
        propertyId: propertyId(token.propertyId),
        portalId: portalId(token.portalId),
        status: 'healthy' as const,
        reason: 'operational' as const,
        sourceVersion: '1',
        effectiveFrom: IMMERSIVE_FIXTURE_AT,
        effectiveTo: null,
        observedAt: IMMERSIVE_FIXTURE_AT,
      }),
    },
    listApprovedSecondaryDestinationUris: listApproved,
    isPropertyActive: async () => true,
    getGoogleReviewDestination: async () => ({
      state: 'verified' as const,
      uri: IMMERSIVE_FIXTURE_GOOGLE_URI,
      retrievedAt: IMMERSIVE_FIXTURE_AT,
      sourceEpoch: 2,
      profileVersion: 5,
    }),
    decidePublic: async () => ({ allowed: true }),
    clock: () => IMMERSIVE_FIXTURE_AT,
    ...deps,
  })
  return { resolve, listApproved }
}

async function found(
  resolve: ReturnType<typeof setup>['resolve'],
  preference: Parameters<ReturnType<typeof setup>['resolve']>[1] = {},
) {
  const outcome = await resolve('pt_key_secret', preference)
  if (outcome.status !== 'found') throw new Error('expected a found portal')
  return outcome.data
}

const servesAllMedia = async () => MEDIA

describe('resolvePublicPortalToken for a schema version 3 publication', () => {
  it('serves the Immersive Hub surface with the selected locale and generation 2 pack', async () => {
    const data = await found(setup({ resolvePortalMediaUrls: servesAllMedia }).resolve)

    expect(data.guestSurface).toBe('immersive')
    expect(data.localization).toEqual({
      selectedLocale: 'en',
      primaryLocale: 'en',
      availableLocales: ['en', 'bg'],
      languagePackVersion: 'guest-ui-en-v2',
    })
    expect(data.responseConfiguration).toMatchObject({
      guestLocale: 'en',
      languagePackVersion: 'guest-ui-en-v2',
      privateFeedbackThreshold: 3,
    })
    expect(data.categories).toEqual([])
    expect(data.portal).toMatchObject({
      id: IMMERSIVE_FIXTURE_SCOPE.portalId,
      name: 'Tell us about your visit',
      description: 'Rate your visit to the Harbor Hotel.',
      organizationName: 'The Harbor Hotel',
      heroImageUrl: MEDIA[IMMERSIVE_HERO_ASSET_ID],
      logoUrl: MEDIA[IMMERSIVE_LOGO_ASSET_ID],
    })
  })

  it('maps the look, time zone, Linktree and ordered links for the page', async () => {
    const data = await found(setup({ resolvePortalMediaUrls: servesAllMedia }).resolve)

    expect(data.immersive).toEqual({
      timeZone: 'Europe/Sofia',
      brand: {
        displayName: 'The Harbor Hotel',
        wordmark: 'HARBOR',
        logo: { url: MEDIA[IMMERSIVE_LOGO_ASSET_ID], width: 480, height: 120 },
        hero: {
          url: MEDIA[IMMERSIVE_HERO_ASSET_ID],
          width: 1600,
          height: 1000,
          focalX: 0.4,
          focalY: 0.6,
        },
        accentColour: '#C8A45A',
        fieldColour: '#14110F',
      },
      content: {
        title: { value: 'Tell us about your visit', fallbackFrom: null },
        shortDescription: {
          value: 'Rate your visit to the Harbor Hotel.',
          fallbackFrom: null,
        },
        heroAlt: { value: 'The Harbor Hotel at dusk', fallbackFrom: null },
        linktreeTitle: { value: 'Useful links', fallbackFrom: null },
      },
      linktree: { enabled: true },
      links: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          iconKey: 'utensils',
          imageUrl: null,
          label: 'Menu',
          line: 'Breakfast until 11',
          fallbackFrom: null,
        },
        {
          id: '30000000-0000-4000-8000-000000000002',
          iconKey: null,
          imageUrl: MEDIA[IMMERSIVE_TILE_ASSET_ID],
          label: 'Spa',
          line: null,
          fallbackFrom: null,
        },
      ],
    })
  })

  it('keeps the legacy link shape for click tracking, in the published order', async () => {
    const data = await found(setup({ resolvePortalMediaUrls: servesAllMedia }).resolve)

    expect(data.links).toEqual([
      {
        id: '30000000-0000-4000-8000-000000000001',
        label: 'Menu',
        url: MENU_URL,
        categoryId: null,
        sortKey: '0000',
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        label: 'Spa',
        url: SPA_URL,
        categoryId: null,
        sortKey: '0001',
      },
    ])
  })

  it('serves the requested locale with its own pack and keeps fallback tags', async () => {
    const data = await found(setup().resolve, { requestedLocale: 'bg' })

    expect(data.localization).toMatchObject({
      selectedLocale: 'bg',
      primaryLocale: 'en',
      languagePackVersion: 'guest-ui-bg-v2',
    })
    expect(data.immersive?.content.title.value).toBe('Разкажете ни за посещението си')
    expect(data.immersive?.content.heroAlt).toEqual({
      value: 'The Harbor Hotel at dusk',
      fallbackFrom: 'en',
    })
    expect(data.immersive?.links.map((link) => [link.label, link.fallbackFrom])).toEqual([
      ['Меню', null],
      ['Spa', 'en'],
    ])
  })

  it('never serves a locale outside the published set', async () => {
    const data = await found(setup().resolve, { requestedLocale: 'de' })

    expect(data.localization.selectedLocale).toBe('en')
  })

  describe('media', () => {
    it('asks for each referenced asset once, for the token scope', async () => {
      const resolvePortalMediaUrls = vi.fn(servesAllMedia)
      await found(setup({ resolvePortalMediaUrls }).resolve)

      expect(resolvePortalMediaUrls).toHaveBeenCalledExactlyOnceWith(
        organizationId(token.organizationId),
        propertyId(token.propertyId),
        [IMMERSIVE_LOGO_ASSET_ID, IMMERSIVE_HERO_ASSET_ID, IMMERSIVE_TILE_ASSET_ID],
      )
    })

    it('never lets an asset id reach the served result', async () => {
      const data = await found(setup({ resolvePortalMediaUrls: servesAllMedia }).resolve)
      const serialized = JSON.stringify(data)

      for (const assetId of Object.keys(MEDIA)) expect(serialized).not.toContain(assetId)
    })

    it('serves no photo, logo or tile image for an asset that was taken down', async () => {
      const data = await found(
        setup({
          resolvePortalMediaUrls: async () => ({
            [IMMERSIVE_LOGO_ASSET_ID]: MEDIA[IMMERSIVE_LOGO_ASSET_ID],
          }),
        }).resolve,
      )

      expect(data.immersive?.brand.hero).toBeNull()
      expect(data.portal.heroImageUrl).toBeNull()
      expect(data.immersive?.brand.logo?.url).toBe(MEDIA[IMMERSIVE_LOGO_ASSET_ID])
      expect(data.immersive?.links.map((link) => link.imageUrl)).toEqual([null, null])
    })

    it('serves no media until Portal media exists', async () => {
      const data = await found(setup().resolve)

      expect(data.immersive?.brand.hero).toBeNull()
      expect(data.immersive?.brand.logo).toBeNull()
    })

    it('degrades to no media, and reports, when the lookup fails', async () => {
      const failure = new Error('asset store unreachable')
      const reportPortalMediaFailure = vi.fn()
      const data = await found(
        setup({
          resolvePortalMediaUrls: async () => {
            throw failure
          },
          reportPortalMediaFailure,
        }).resolve,
      )

      expect(data.immersive?.brand.hero).toBeNull()
      expect(data.immersive?.brand.displayName).toBe('The Harbor Hotel')
      expect(reportPortalMediaFailure).toHaveBeenCalledWith(failure)
    })

    it('does not look anything up for a portal with no media', async () => {
      const resolvePortalMediaUrls = vi.fn(servesAllMedia)
      const base = immersiveConfiguration()
      const noMedia = immersiveSnapshot(
        immersiveConfiguration({
          links: base.links.map((link) => ({ ...link, imageAssetId: null })),
          brandProfile: { ...base.brandProfile, logo: null, hero: null },
        }),
      )
      await found(setup({ snapshot: noMedia, resolvePortalMediaUrls }).resolve)

      expect(resolvePortalMediaUrls).not.toHaveBeenCalled()
    })
  })

  describe('secondary links', () => {
    it('serves only approved links, in both shapes', async () => {
      const reportApprovedDestinationsDropped = vi.fn()
      const data = await found(
        setup({
          listApprovedSecondaryDestinationUris: async () => [SPA_URL],
          reportApprovedDestinationsDropped,
        }).resolve,
      )

      expect(data.links.map((link) => link.url)).toEqual([SPA_URL])
      expect(data.immersive?.links.map((link) => link.label)).toEqual(['Spa'])
      expect(reportApprovedDestinationsDropped).toHaveBeenCalledWith({
        published: 2,
        served: 1,
      })
    })

    it('hides every link when the approval lookup fails, and keeps the rest of the page', async () => {
      const data = await found(
        setup({
          listApprovedSecondaryDestinationUris: async () => {
            throw new Error('approval authority down')
          },
        }).resolve,
      )

      expect(data.links).toEqual([])
      expect(data.immersive?.links).toEqual([])
      expect(data.immersive?.linktree.enabled).toBe(true)
      expect(data.reviewGateway.googleReview.status).toBe('available')
    })
  })

  describe('failing closed', () => {
    it('is unavailable when the pack of the selected locale is the wrong generation', async () => {
      const snapshot = immersiveSnapshotWith({
        languagePackVersions: { en: 'guest-ui-en-v2', bg: 'guest-ui-bg-v1' },
      })
      const { resolve } = setup({ snapshot })

      await expect(resolve('pt_key_secret', { requestedLocale: 'bg' })).resolves.toEqual({
        status: 'unavailable',
      })
    })

    it('is unavailable when the selected locale has no content', async () => {
      const snapshot = immersiveSnapshotWith({
        localizedContent: { en: immersiveConfiguration().localizedContent.en },
      })
      const { resolve } = setup({ snapshot })

      await expect(resolve('pt_key_secret', { requestedLocale: 'bg' })).resolves.toEqual({
        status: 'unavailable',
      })
    })

    it('is unavailable when a link has no wording in the selected locale', async () => {
      const base = immersiveConfiguration()
      const [first, second] = base.links
      if (!first || !second) throw new Error('fixture needs two links')
      const { bg: _bg, ...englishOnly } = second.texts
      const snapshot = immersiveSnapshotWith({
        links: [first, { ...second, texts: englishOnly }],
      })
      const { resolve } = setup({ snapshot })

      await expect(resolve('pt_key_secret', { requestedLocale: 'bg' })).resolves.toEqual({
        status: 'unavailable',
      })
    })

    it.each([null, { status: 'unavailable' as const }])(
      'is unavailable without an available Portal Health record (%j)',
      async (health) => {
        const { resolve } = setup({
          portalHealthRepo: {
            getCurrent: async () =>
              health && {
                id: 'health-1',
                organizationId: organizationId(token.organizationId),
                propertyId: propertyId(token.propertyId),
                portalId: portalId(token.portalId),
                status: health.status,
                reason: 'publication_disabled' as const,
                sourceVersion: '1',
                effectiveFrom: IMMERSIVE_FIXTURE_AT,
                effectiveTo: null,
                observedAt: IMMERSIVE_FIXTURE_AT,
              },
          },
        })

        await expect(resolve('pt_key_secret')).resolves.toEqual({ status: 'unavailable' })
      },
    )
  })

  describe('a disabled Linktree', () => {
    const disabled = () => immersiveSnapshotWith({ linktree: { enabled: false } })

    it('serves no links in either shape and skips the approval lookup', async () => {
      const reportApprovedDestinationsDropped = vi.fn()
      const { resolve, listApproved } = setup({
        snapshot: disabled(),
        reportApprovedDestinationsDropped,
      })
      const data = await found(resolve)

      expect(data.immersive?.linktree.enabled).toBe(false)
      expect(data.immersive?.links).toEqual([])
      expect(data.links).toEqual([])
      expect(listApproved).not.toHaveBeenCalled()
      expect(reportApprovedDestinationsDropped).not.toHaveBeenCalled()
    })

    it('leaves no published link id for click tracking to redirect to', async () => {
      const data = await found(setup({ snapshot: disabled() }).resolve)
      const publishedIds = immersiveConfiguration().links.map((link) => link.id)

      for (const id of publishedIds) {
        expect(data.links.find((link) => link.id === id)).toBeUndefined()
      }
    })

    it('does not carry a link label to the browser', async () => {
      const data = await found(setup({ snapshot: disabled() }).resolve)

      expect(JSON.stringify(data)).not.toContain('Breakfast until 11')
      expect(JSON.stringify(data)).not.toContain(MENU_URL)
    })
  })

  describe('content addressing', () => {
    // The row digest is held at the base snapshot's value, so a difference in the
    // resolved digest can only come from the field the variant changed.
    const base = immersiveConfiguration()
    const baseDigest = immersiveSnapshot(base).configurationDigest
    const digestOf = async (
      overrides: Partial<ImmersivePortalPublicationConfiguration>,
      media: () => Promise<Record<string, string>> = servesAllMedia,
    ) => {
      const snapshot = immersiveSnapshot(immersiveConfiguration(overrides), {
        configurationDigest: baseDigest,
      })
      const data = await found(setup({ snapshot, resolvePortalMediaUrls: media }).resolve)
      return data.responseConfiguration.configurationDigest
    }
    const [menu, spa] = base.links
    if (!menu || !spa) throw new Error('fixture needs two links')
    const english = base.localizedContent.en
    if (!english) throw new Error('fixture needs English content')

    it.each<[string, Partial<ImmersivePortalPublicationConfiguration>]>([
      ['time zone', { timeZone: 'Europe/London' }],
      [
        'accent colour',
        { brandProfile: { ...base.brandProfile, accentColour: '#112233' } },
      ],
      [
        'field colour',
        { brandProfile: { ...base.brandProfile, fieldColour: '#445566' } },
      ],
      ['wordmark', { brandProfile: { ...base.brandProfile, wordmark: 'HBR' } }],
      ['Linktree switch', { linktree: { enabled: false } }],
      [
        'hero alt text',
        {
          localizedContent: {
            ...base.localizedContent,
            en: {
              ...english,
              heroAlt: { value: 'A different view', fallbackFrom: null },
            },
          },
        },
      ],
      [
        'link fallback tag',
        {
          links: [
            {
              ...menu,
              texts: {
                ...menu.texts,
                en: { label: 'Menu', line: 'Breakfast until 11', fallbackFrom: 'bg' },
              },
            },
            spa,
          ],
        },
      ],
    ])('changes with the %s', async (_name, overrides) => {
      const reference = await digestOf({})

      expect(await digestOf(overrides)).not.toBe(reference)
    })

    it('changes with a taken-down photo', async () => {
      const withPhoto = await digestOf({})
      const withoutPhoto = await digestOf({}, async () => ({}))

      expect(withoutPhoto).not.toBe(withPhoto)
    })
  })

  it('never exposes provenance, which is history only', async () => {
    const snapshot = immersiveSnapshotWith({
      provenance: { aiDraftTextKeys: ['title:bg', 'link:1:label:bg'] },
    })
    const data = await found(setup({ snapshot }).resolve, { requestedLocale: 'bg' })

    const serialized = JSON.stringify(data)
    expect(serialized).not.toContain('aiDraftTextKeys')
    expect(serialized).not.toContain('provenance')
    expect(serialized).not.toContain('link:1:label:bg')
  })
})
