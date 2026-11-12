// Portal context — getPortalPreview use case tests
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { createPortalLinkRepository } from '../../infrastructure/repositories/portal-link.repository'
import { createPortalMediaAssetRepository } from '../../infrastructure/repositories/portal-media-asset.repository'
import { createPortalLookRepository } from '../../infrastructure/repositories/portal-look.repository'
import { createPortalApprovedDestinationRepository } from '../../infrastructure/repositories/portal-approved-destination.repository'
import {
  seedPortalLookOverride,
  type SeededLookOverride,
} from '../../infrastructure/testing/portal-working-copy-seed'
import { getPortalPreview } from './get-portal-preview'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalReadsWorld } from '../../infrastructure/testing/portal-reads-world'
import {
  portalApprovedDestinationId,
  propertyId,
  userId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  PORTAL_DESTINATION_VALIDATION_VERSION,
  type PortalApprovedDestination,
} from '../../domain/approved-destination'
import type { PortalPublicationSnapshot } from '../../domain/portal-publication-snapshot'
import { APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS } from '../approved-destination-age'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import {
  immersiveConfiguration,
  immersiveSnapshot,
} from '../__fixtures__/immersive-snapshot'
import type { PortalLookOverride } from '../../domain/portal-look'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import type { PortalMediaAsset } from '../../domain/portal-media-asset'
import type { PropertyPortalBrandProfile } from '../ports/portal-experience.repository'

const world = createPortalReadsWorld('preview')

// Children first: a preview built twice in one test starts from an empty store.
const STORED_TABLES = [
  'portal_look_overrides',
  'portal_link_texts',
  'portal_links',
  'portal_approved_destinations',
  'portal_link_categories',
  'portal_media_assets',
  'portals',
  'properties',
]

const { getPool } = setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: STORED_TABLES,
})

const portal = world.portal({
  name: 'Pool & Terrace',
  additionalGuestLocales: ['bg'],
  privateFeedbackThreshold: 2,
})
const AT = new Date('2026-10-01T10:00:00Z')
const APPROVED_ID = randomUUID()
const PENDING_ID = randomUUID()
const APPROVED_URL = 'https://avela.bg/menu'
const PENDING_URL = 'https://pending.example.test/secret-path'

/** The override as `portal_look_overrides` stores it: a group left out follows the Property. */
const storedLook = (override: PortalLookOverride): SeededLookOverride => ({
  lookVersion: override.lookVersion,
  ...(override.photo.mode === 'none' ? { photo: { mode: 'none' as const } } : {}),
  ...(override.photo.mode === 'own'
    ? {
        photo: {
          mode: 'own' as const,
          assetId: override.photo.heroAssetId,
          focalX: override.photo.focalX,
          focalY: override.photo.focalY,
          altTexts: override.photo.altTexts,
        },
      }
    : {}),
  ...(override.colours.mode === 'own'
    ? {
        colours: {
          accent: override.colours.accent,
          backgroundMode: override.colours.backgroundMode,
          backgroundColour: override.colours.backgroundColour,
        },
      }
    : {}),
  ...(override.identity.mode === 'own'
    ? {
        identity: {
          wordmark: override.identity.wordmark,
          logoAssetId: override.identity.logoAssetId,
        },
      }
    : {}),
})

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const destination = (
  id: string,
  uri: string,
  approvalState: PortalApprovedDestination['approvalState'],
): PortalApprovedDestination => ({
  id: portalApprovedDestinationId(id),
  organizationId: world.orgA,
  propertyId: world.propertyA,
  normalizedUri: uri,
  hostname: new URL(uri).hostname,
  sourceType: 'custom',
  approvalState,
  validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
  requestedBy: userId('user-1'),
  approvedBy: approvalState === 'approved' ? userId('admin-1') : null,
  approvedAt: approvalState === 'approved' ? AT : null,
  disabledAt: null,
  disabledReason: null,
  lastValidatedAt: AT,
  createdAt: AT,
  updatedAt: AT,
})

type Options = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  active?: PortalPublicationSnapshot | null
  approvedUris?: readonly string[]
  timeZone?: string | null
  /** The Brand Profile the Property has; none by default. */
  profile?: PropertyPortalBrandProfile | null
  /** The stored images of the Property. */
  assets?: ReadonlyArray<PortalMediaAsset>
  /** The Portal's own look; none follows the Property look. */
  override?: PortalLookOverride
  /** The Property's description of its photograph, in English. */
  heroAltText?: string | null
}>

async function setup(options: Options = {}) {
  for (const table of STORED_TABLES) {
    await getPool().query(`DELETE FROM ${table} WHERE organization_id = $1`, [world.orgA])
  }
  const portalRepo = world.portalRepo()
  await world.seed([portal])
  await world.seedMedia(options.assets ?? [])
  const categoryId = await world.seedCategory(portal)
  await world.seedDestination(destination(APPROVED_ID, APPROVED_URL, 'approved'))
  await world.seedDestination(destination(PENDING_ID, PENDING_URL, 'pending'))
  await world.seedLink(portal, {
    categoryId,
    destinationId: APPROVED_ID,
    label: 'Menu',
    sortKey: 'a0',
  })
  await world.seedLink(portal, {
    categoryId,
    destinationId: PENDING_ID,
    label: 'Spa',
    sortKey: 'a1',
  })
  if (options.override) {
    await seedPortalLookOverride(
      getPool(),
      {
        organizationId: world.orgA,
        propertyId: world.propertyA,
        portalId: portal.id,
      },
      storedLook(options.override),
    )
  }
  const portalLinkRepo = createPortalLinkRepository(getDb())
  const mediaRepo = createPortalMediaAssetRepository(getDb())
  const destinationRepo = createPortalApprovedDestinationRepository(getDb())
  const portalLookRepo = createPortalLookRepository(getDb())
  const queried: string[][] = []
  const validatedAfter: Date[] = []
  const useCase = getPortalPreview({
    portalRepo,
    portalLinkRepo,
    mediaRepo,
    portalLookRepo,
    experienceRepo: {
      getPropertyExperience: async () => ({
        profile: options.profile ?? null,
        content: [
          {
            id: 'content-en',
            organizationId: world.orgA,
            propertyId: world.propertyA,
            locale: 'en',
            title: 'Avela Resort',
            shortDescription: 'Rate your visit.',
            heroAltText: options.heroAltText ?? null,
            version: 1,
            updatedBy: userId('user-1'),
            createdAt: AT,
            updatedAt: AT,
          },
        ],
      }),
      listPortalOverrides: async () => [],
    } as unknown as PortalExperienceRepository,
    destinationRepo: {
      list: (...args: Parameters<typeof destinationRepo.list>) =>
        destinationRepo.list(...args),
      listApprovedUris: async (_org, _property, uris, after) => {
        queried.push([...uris])
        validatedAfter.push(after)
        return uris.filter((uri) => (options.approvedUris ?? []).includes(uri))
      },
    },
    publicationRepo: { findActiveForPortal: async () => options.active ?? null },
    propertyFacts: {
      getPropertyTimezone: async () =>
        options.timeZone === undefined ? 'Europe/Sofia' : options.timeZone,
    },
    staffPublicApi: staffApi(options.accessible ?? null),
    clock: () => AT,
  })
  return { useCase, queried, validatedAfter }
}

const manager = () => world.ctx({ role: 'PropertyManager' })

describe('getPortalPreview (draft)', () => {
  it('describes the working copy in every language of the portal', async () => {
    const { useCase } = await setup()

    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())

    expect(outcome.status).toBe('ready')
    if (outcome.status !== 'ready') return
    expect(outcome.preview).toMatchObject({
      source: 'draft',
      portalId: portal.id,
      locales: ['en', 'bg'],
      privateFeedbackThreshold: 2,
    })
    expect(outcome.preview.experiences.en?.timeZone).toBe('Europe/Sofia')
    expect(outcome.preview.experiences.en?.content.title.value).toBe('Avela Resort')
  })

  it('shows a tile whose address is not approved as a placeholder', async () => {
    const { useCase } = await setup()

    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.links.map((link) => link.state)).toEqual([
      'ready',
      'awaiting_approval',
    ])
  })

  it('never includes an address that is not approved, or any other address', async () => {
    const { useCase } = await setup()

    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())

    const json = JSON.stringify(outcome)
    expect(json).not.toContain('pending.example.test')
    expect(json).not.toContain('secret-path')
    expect(json).not.toContain(APPROVED_URL)
  })

  it('reads the time zone as UTC when the Property has none on record', async () => {
    const { useCase } = await setup({ timeZone: null })

    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.timeZone).toBe('UTC')
  })
})

const LIVE_HERO = randomUUID()
const LIVE_LOGO = randomUUID()
// The published page names images of this suite, not the shared fixture ids.
const liveSnapshot = () => {
  const { brandProfile } = immersiveConfiguration()
  return immersiveSnapshot(
    immersiveConfiguration({
      brandProfile: {
        ...brandProfile,
        hero: brandProfile.hero && { ...brandProfile.hero, assetId: LIVE_HERO },
        logo: brandProfile.logo && { ...brandProfile.logo, assetId: LIVE_LOGO },
      },
    }),
  )
}
const HERO = randomUUID()
const LOGO = randomUUID()

const lookProfile = (): PropertyPortalBrandProfile => ({
  id: 'e0000000-0000-4000-8000-000000000001',
  organizationId: world.orgA,
  propertyId: world.propertyA,
  displayName: 'Avela Resort',
  logoUrl: null,
  defaultHeroImageUrl: null,
  logoAssetId: LOGO,
  heroAssetId: HERO,
  heroFocalX: 0.3,
  heroFocalY: 0.6,
  primaryColor: '#C8A45A',
  backgroundColor: '#14110F',
  textColor: '#111827',
  wordmark: null,
  backgroundMode: 'auto',
  defaultGuestLocales: ['en'],
  lookVersion: 2,
  version: 1,
  updatedBy: userId('user-1'),
  createdAt: AT,
  updatedAt: AT,
})

const storedImage = (id: string, purpose: 'hero' | 'logo', overrides = {}) =>
  buildTestPortalMediaAsset({
    id: id as never,
    purpose,
    organizationId: world.orgA,
    propertyId: world.propertyA,
    ...overrides,
  })

describe('getPortalPreview (draft photograph and logo)', () => {
  it('draws the uploaded photograph and logo the Brand Profile names', async () => {
    const { useCase } = await setup({
      profile: lookProfile(),
      assets: [
        storedImage(HERO, 'hero'),
        storedImage(LOGO, 'logo', { width: 480, height: 120 }),
      ],
    })

    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.brand).toMatchObject({
      hero: {
        url: `/api/public/portal-media/${HERO}`,
        width: 2400,
        height: 1600,
        focalX: 0.3,
        focalY: 0.6,
      },
      logo: { url: `/api/public/portal-media/${LOGO}`, width: 480, height: 120 },
    })
  })

  it('draws the no-photo page for a photograph that was taken down', async () => {
    const { useCase } = await setup({
      profile: lookProfile(),
      assets: [
        storedImage(HERO, 'hero', { status: 'taken_down', takenDownAt: AT }),
        storedImage(LOGO, 'logo'),
      ],
    })

    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    const brand = outcome.preview.experiences.en?.brand
    expect(brand?.hero).toBeNull()
    expect(brand?.logo).not.toBeNull()
  })
})

const OWN_HERO = randomUUID()
const OWN_LOGO = randomUUID()
const FOLLOWING: PortalLookOverride = {
  photo: { mode: 'inherit' },
  colours: { mode: 'inherit' },
  identity: { mode: 'inherit' },
  lookVersion: 3,
}

describe("getPortalPreview (draft, a Portal's own look)", () => {
  const previewOf = async (options: Options) => {
    const { useCase } = await setup({
      profile: lookProfile(),
      assets: [
        storedImage(HERO, 'hero'),
        storedImage(LOGO, 'logo'),
        storedImage(OWN_HERO, 'hero', { width: 1200, height: 800 }),
        storedImage(OWN_LOGO, 'logo', { width: 300, height: 300 }),
      ],
      ...options,
    })
    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())
    if (outcome.status !== 'ready') throw new Error('expected a preview')
    return outcome.preview.experiences.en!
  }

  it('draws the Property look for a Portal with no look of its own', async () => {
    const experience = await previewOf({ heroAltText: 'The pool' })

    expect(experience.brand).toMatchObject({
      accentColour: '#C8A45A',
      hero: { url: `/api/public/portal-media/${HERO}`, focalX: 0.3, focalY: 0.6 },
      logo: { url: `/api/public/portal-media/${LOGO}` },
    })
    expect(experience.content.heroAlt.value).toBe('The pool')
  })

  it('draws the Portal’s own photograph, and never describes it with the Property’s description', async () => {
    const experience = await previewOf({
      heroAltText: 'The pool',
      override: {
        ...FOLLOWING,
        photo: {
          mode: 'own',
          heroAssetId: OWN_HERO,
          focalX: 0.2,
          focalY: 0.4,
          altTexts: {},
        },
      },
    })

    expect(experience.brand.hero).toEqual({
      url: `/api/public/portal-media/${OWN_HERO}`,
      width: 1200,
      height: 800,
      focalX: 0.2,
      focalY: 0.4,
    })
    expect(experience.brand.logo?.url).toContain(LOGO)
    expect(experience.content.heroAlt.value).toBe('')
  })

  it('describes the Portal’s own photograph with its own description', async () => {
    const experience = await previewOf({
      heroAltText: 'The pool',
      override: {
        ...FOLLOWING,
        photo: {
          mode: 'own',
          heroAssetId: OWN_HERO,
          focalX: 0.5,
          focalY: 0.5,
          altTexts: { en: 'The spa pool' },
        },
      },
    })

    expect(experience.content.heroAlt.value).toBe('The spa pool')
  })

  it('draws no photograph, and no description, for a Portal that chose none', async () => {
    const experience = await previewOf({
      heroAltText: 'The pool',
      override: { ...FOLLOWING, photo: { mode: 'none' } },
    })

    expect(experience.brand.hero).toBeNull()
    expect(experience.brand.logo).not.toBeNull()
    expect(experience.content.heroAlt.value).toBe('')
  })

  it('draws no photograph, not the Property’s, once the Portal’s own is taken down', async () => {
    const { useCase } = await setup({
      profile: lookProfile(),
      heroAltText: 'The pool',
      assets: [
        storedImage(HERO, 'hero'),
        storedImage(OWN_HERO, 'hero', { status: 'taken_down', takenDownAt: AT }),
      ],
      override: {
        ...FOLLOWING,
        photo: {
          mode: 'own',
          heroAssetId: OWN_HERO,
          focalX: 0.5,
          focalY: 0.5,
          altTexts: { en: 'The spa pool' },
        },
      },
    })

    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    const experience = outcome.preview.experiences.en!
    expect(experience.brand.hero).toBeNull()
    expect(experience.content.heroAlt.value).toBe('')
  })

  it('draws the Portal’s own colours and derives its field as publishing does', async () => {
    const own = await previewOf({
      override: {
        ...FOLLOWING,
        colours: {
          mode: 'own',
          accent: '#B8860B',
          backgroundMode: 'manual',
          backgroundColour: '#2a1f10',
        },
      },
    })
    const automatic = await previewOf({
      override: {
        ...FOLLOWING,
        colours: {
          mode: 'own',
          accent: '#B8860B',
          backgroundMode: 'auto',
          backgroundColour: '#2a1f10',
        },
      },
    })

    // A hand-chosen background is drawn as stored; an automatic one follows the accent.
    expect(own.brand).toMatchObject({ accentColour: '#B8860B', fieldColour: '#2a1f10' })
    expect(automatic.brand.accentColour).toBe('#B8860B')
    expect(automatic.brand.fieldColour).not.toBe('#2a1f10')
  })

  it('draws the Portal’s own wordmark and logo, or neither', async () => {
    const own = await previewOf({
      override: {
        ...FOLLOWING,
        identity: { mode: 'own', wordmark: 'SPA', logoAssetId: OWN_LOGO },
      },
    })
    const bare = await previewOf({
      override: {
        ...FOLLOWING,
        identity: { mode: 'own', wordmark: null, logoAssetId: null },
      },
    })

    expect(own.brand.wordmark).toBe('SPA')
    expect(own.brand.logo).toMatchObject({ width: 300, height: 300 })
    expect(own.brand.displayName).toBe('Avela Resort')
    expect(bare.brand.wordmark).toBeNull()
    expect(bare.brand.logo).toBeNull()
  })

  it('describes nothing when the Property has no photograph to describe', async () => {
    const { useCase } = await setup({
      profile: {
        ...lookProfile(),
        heroAssetId: null,
        heroFocalX: null,
        heroFocalY: null,
      },
      heroAltText: 'The pool',
    })

    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.content.heroAlt.value).toBe('')
  })

  it('ignores the Portal’s own look while the Property has no Brand Profile', async () => {
    const { useCase } = await setup({
      profile: null,
      override: { ...FOLLOWING, photo: { mode: 'none' } },
    })

    const outcome = await useCase({ portalId: portal.id, source: 'draft' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.brand).toMatchObject({
      hero: null,
      logo: null,
      accentColour: '#EAD6A8',
    })
  })
})

describe('getPortalPreview (live)', () => {
  const live = liveSnapshot
  const published = ['https://harbor.example.com/menu', 'https://harbor.example.com/spa']

  it('presents the version guests can open now', async () => {
    const { useCase } = await setup({ active: live(), approvedUris: published })

    const outcome = await useCase({ portalId: portal.id, source: 'live' }, manager())

    expect(outcome.status).toBe('ready')
    if (outcome.status !== 'ready') return
    expect(outcome.preview).toMatchObject({ source: 'live', version: 6 })
  })

  it('shows the version its photograph and logo while they may be served, and not a taken-down one', async () => {
    const { useCase } = await setup({
      active: live(),
      approvedUris: published,
      assets: [
        storedImage(LIVE_HERO, 'hero'),
        storedImage(LIVE_LOGO, 'logo', {
          status: 'taken_down',
          takenDownAt: AT,
        }),
      ],
    })

    const outcome = await useCase({ portalId: portal.id, source: 'live' }, manager())

    if (outcome.status !== 'ready') throw new Error('expected a preview')
    const brand = outcome.preview.experiences.en?.brand
    expect(brand?.hero?.url).toBe(`/api/public/portal-media/${LIVE_HERO}`)
    expect(brand?.logo).toBeNull()
  })

  it('asks which of the published addresses are still approved, as the guest page does', async () => {
    const { useCase, queried } = await setup({
      active: live(),
      approvedUris: ['https://harbor.example.com/menu'],
    })

    const outcome = await useCase({ portalId: portal.id, source: 'live' }, manager())

    expect(queried).toEqual([published])
    if (outcome.status !== 'ready') throw new Error('expected a preview')
    expect(outcome.preview.experiences.en?.links).toHaveLength(1)
  })

  it('applies the guest edge approval cut-off to the addresses', async () => {
    const { useCase, validatedAfter } = await setup({
      active: live(),
      approvedUris: published,
    })

    await useCase({ portalId: portal.id, source: 'live' }, manager())

    expect(validatedAfter).toEqual([
      new Date(AT.getTime() - APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS),
    ])
    expect(APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS).toBe(30 * 60 * 1_000)
  })

  it('says so when nothing is published', async () => {
    const { useCase } = await setup({ active: null })

    expect(await useCase({ portalId: portal.id, source: 'live' }, manager())).toEqual({
      status: 'unavailable',
      source: 'live',
      reason: 'not_published',
    })
  })

  it('says so when the live version predates the new page design', async () => {
    const legacy = {
      ...live(),
      configuration: { ...live().configuration, schemaVersion: 2 },
    } as unknown as PortalPublicationSnapshot
    const { useCase } = await setup({ active: legacy })

    expect(await useCase({ portalId: portal.id, source: 'live' }, manager())).toEqual({
      status: 'unavailable',
      source: 'live',
      reason: 'earlier_design',
    })
  })
})

describe('getPortalPreview (access)', () => {
  it('refuses a caller who holds no Portal read permission', async () => {
    const { useCase } = await setup()

    await expect(
      useCase(
        { portalId: portal.id, source: 'draft' },
        world.ctx({ effectivePermissions: new Set() }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { useCase } = await setup({
      accessible: [propertyId(randomUUID())],
    })

    await expect(
      useCase({ portalId: portal.id, source: 'draft' }, manager()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('does not find a Portal of another organization', async () => {
    const { useCase } = await setup()

    await expect(
      useCase(
        { portalId: portal.id, source: 'draft' },
        world.ctx({
          role: 'PropertyManager',
          organizationId: world.orgB,
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })
})
