// Portal context — putting an uploaded photograph or logo on the Property look.
// What this pins: only an Account Admin may, the asset must be an active image
// of the right purpose uploaded for this Property (anything else is the same
// refusal as a missing image), the focal point must be inside the photograph,
// descriptions are trimmed and bounded, the writer is handed the media alone,
// and the answer carries the media as a reader shows it.

import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalMediaAssetId, propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { isPortalError } from '../../domain/errors'
import type {
  PortalExperienceRepository,
  PropertyPortalBrandProfile,
} from '../ports/portal-experience.repository'
import { savePropertyHero, savePropertyLogo } from './save-property-media'

const NOW = new Date('2026-10-01T12:00:00.000Z')
const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const HERO_ID = '30000000-0000-4000-8000-000000000001'
const LOGO_ID = '30000000-0000-4000-8000-000000000002'

const failsWith = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

const PROFILE: PropertyPortalBrandProfile = {
  id: 'e0000000-0000-4000-8000-000000000001',
  organizationId: ORG,
  propertyId: PROPERTY,
  displayName: 'Avela Resort',
  logoUrl: null,
  defaultHeroImageUrl: null,
  logoAssetId: null,
  heroAssetId: null,
  heroFocalX: null,
  heroFocalY: null,
  primaryColor: '#2563EB',
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
  wordmark: null,
  backgroundMode: 'auto',
  defaultGuestLocales: ['en'],
  lookVersion: 2,
  version: 3,
  updatedBy: 'user-1' as never,
  createdAt: NOW,
  updatedAt: NOW,
}

const heroAsset = (overrides = {}) =>
  buildTestPortalMediaAsset({
    id: portalMediaAssetId(HERO_ID),
    purpose: 'hero',
    ...overrides,
  })
const logoAsset = (overrides = {}) =>
  buildTestPortalMediaAsset({
    id: portalMediaAssetId(LOGO_ID),
    purpose: 'logo',
    ...overrides,
  })

const setup = (
  assets: ReadonlyArray<ReturnType<typeof buildTestPortalMediaAsset>> = [
    heroAsset(),
    logoAsset(),
  ],
  profile: PropertyPortalBrandProfile | null = PROFILE,
) => {
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  mediaRepo.seed(assets)
  const experienceRepo = {
    savePropertyHero: vi.fn<PortalExperienceRepository['savePropertyHero']>(
      async (input) =>
        profile === null
          ? null
          : {
              ...profile,
              heroAssetId: input.hero?.assetId ?? null,
              heroFocalX: input.hero?.focalX ?? null,
              heroFocalY: input.hero?.focalY ?? null,
              lookVersion: profile.lookVersion + 1,
            },
    ),
    savePropertyLogo: vi.fn<PortalExperienceRepository['savePropertyLogo']>(
      async (input) =>
        profile === null
          ? null
          : {
              ...profile,
              logoAssetId: input.logoAssetId,
              lookVersion: profile.lookVersion + 1,
            },
    ),
  }
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  }
  let issuedIds = 0
  const deps = {
    experienceRepo,
    mediaRepo,
    staffPublicApi,
    idGen: () => `new-id-${++issuedIds}`,
    clock: () => NOW,
  }
  return {
    experienceRepo,
    hero: savePropertyHero(deps),
    logo: savePropertyLogo(deps),
  }
}

const admin = () => buildTestAuthContext({ role: 'AccountAdmin' })

describe('savePropertyHero', () => {
  it('puts the photograph on the look with its focal point, as the admin, and answers with the media', async () => {
    const { experienceRepo, hero } = setup()

    const saved = await hero(
      { propertyId: PROPERTY, assetId: HERO_ID, focalX: 0.5, focalY: 0.42 },
      admin(),
    )

    expect(experienceRepo.savePropertyHero).toHaveBeenCalledOnce()
    expect(experienceRepo.savePropertyHero.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORG,
      propertyId: PROPERTY,
      hero: { assetId: HERO_ID, focalX: 0.5, focalY: 0.42 },
      actorUserId: admin().userId,
      at: NOW,
    })
    expect(saved.media.hero).toMatchObject({
      assetId: HERO_ID,
      focalX: 0.5,
      focalY: 0.42,
      url: `/api/public/portal-media/${HERO_ID}`,
    })
  })

  it('leaves the focal point to the writer when none is given, so a kept photograph keeps its anchor', async () => {
    const { experienceRepo, hero } = setup()

    await hero({ propertyId: PROPERTY, assetId: HERO_ID }, admin())

    expect(experienceRepo.savePropertyHero.mock.calls[0]?.[0].hero).toEqual({
      assetId: HERO_ID,
    })
  })

  it('centres the missing half of a focal point that is given in part', async () => {
    const { experienceRepo, hero } = setup()

    await hero({ propertyId: PROPERTY, assetId: HERO_ID, focalX: 0.2 }, admin())

    expect(experienceRepo.savePropertyHero.mock.calls[0]?.[0].hero).toEqual({
      assetId: HERO_ID,
      focalX: 0.2,
      focalY: 0.5,
    })
  })

  it('trims each description, clears an empty one and hands them over per language', async () => {
    const { experienceRepo, hero } = setup()

    await hero(
      {
        propertyId: PROPERTY,
        assetId: HERO_ID,
        altTexts: [
          { locale: 'en', text: '  Evening on the sea terrace ' },
          { locale: 'bg', text: '   ' },
        ],
      },
      admin(),
    )

    expect(experienceRepo.savePropertyHero.mock.calls[0]?.[0].altTexts).toEqual([
      { id: 'new-id-1', locale: 'en', text: 'Evening on the sea terrace' },
      { id: 'new-id-2', locale: 'bg', text: null },
    ])
  })

  it('leaves the descriptions out of the write when none are given', async () => {
    const { experienceRepo, hero } = setup()

    await hero({ propertyId: PROPERTY, assetId: HERO_ID }, admin())

    expect(experienceRepo.savePropertyHero.mock.calls[0]?.[0]).not.toHaveProperty(
      'altTexts',
    )
  })

  it('refuses a description over 160 characters before anything persists', async () => {
    const { experienceRepo, hero } = setup()

    await expect(
      hero(
        {
          propertyId: PROPERTY,
          assetId: HERO_ID,
          altTexts: [{ locale: 'en', text: 'x'.repeat(161) }],
        },
        admin(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    expect(experienceRepo.savePropertyHero).not.toHaveBeenCalled()
  })

  it('takes the photograph off with null, keeping the descriptions it is given', async () => {
    const { experienceRepo, hero } = setup()

    const saved = await hero({ propertyId: PROPERTY, assetId: null }, admin())

    expect(experienceRepo.savePropertyHero.mock.calls[0]?.[0].hero).toBeNull()
    expect(saved.media.hero).toBeNull()
  })

  it.each([
    ['outside the photograph', { focalX: 1.2, focalY: 0.5 }],
    ['not a number', { focalX: Number.NaN, focalY: 0.5 }],
  ])('refuses a focal point %s', async (_label, focal) => {
    const { experienceRepo, hero } = setup()

    await expect(
      hero({ propertyId: PROPERTY, assetId: HERO_ID, ...focal }, admin()),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(experienceRepo.savePropertyHero).not.toHaveBeenCalled()
  })

  it.each([
    ['one that does not exist', []],
    ['one taken down', [heroAsset({ status: 'taken_down' })]],
    ['a logo', [heroAsset({ purpose: 'logo' })]],
    ['a tile picture', [heroAsset({ purpose: 'link_image' })]],
    [
      'one of another Property',
      [heroAsset({ propertyId: propertyId('a0000000-0000-0000-0000-000000000009') })],
    ],
    [
      'one of another Organization',
      [heroAsset({ organizationId: organizationId('org-other') })],
    ],
  ])('refuses %s as a missing image, before any write', async (_label, assets) => {
    const { experienceRepo, hero } = setup(assets)

    await expect(
      hero({ propertyId: PROPERTY, assetId: HERO_ID }, admin()),
    ).rejects.toSatisfy(failsWith('media_not_found'))
    expect(experienceRepo.savePropertyHero).not.toHaveBeenCalled()
  })

  it('refuses an id that is not a UUID as a missing image, without asking the store', async () => {
    const { experienceRepo, hero } = setup()

    await expect(
      hero({ propertyId: PROPERTY, assetId: 'not-an-id' }, admin()),
    ).rejects.toSatisfy(failsWith('media_not_found'))
    expect(experienceRepo.savePropertyHero).not.toHaveBeenCalled()
  })

  it.each(['PropertyManager', 'Member'] as const)('refuses a %s', async (role) => {
    const { experienceRepo, hero } = setup()

    await expect(
      hero({ propertyId: PROPERTY, assetId: HERO_ID }, buildTestAuthContext({ role })),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(experienceRepo.savePropertyHero).not.toHaveBeenCalled()
  })

  it('tells a Property with no Brand Profile to set its name first', async () => {
    const { hero } = setup(undefined, null)

    await expect(
      hero({ propertyId: PROPERTY, assetId: HERO_ID }, admin()),
    ).rejects.toSatisfy(failsWith('brand_profile_missing'))
  })
})

describe('savePropertyLogo', () => {
  it('puts the logo on the look and answers with the media', async () => {
    const { experienceRepo, logo } = setup()

    const saved = await logo({ propertyId: PROPERTY, assetId: LOGO_ID }, admin())

    expect(experienceRepo.savePropertyLogo.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORG,
      propertyId: PROPERTY,
      logoAssetId: LOGO_ID,
      actorUserId: admin().userId,
      at: NOW,
    })
    expect(saved.media.logo).toMatchObject({
      assetId: LOGO_ID,
      url: `/api/public/portal-media/${LOGO_ID}`,
    })
  })

  it('takes the logo off with null', async () => {
    const { experienceRepo, logo } = setup()

    const saved = await logo({ propertyId: PROPERTY, assetId: null }, admin())

    expect(experienceRepo.savePropertyLogo.mock.calls[0]?.[0].logoAssetId).toBeNull()
    expect(saved.media.logo).toBeNull()
  })

  it('refuses a photograph as the logo, and the reverse of the hero rule', async () => {
    const { experienceRepo, logo } = setup([
      heroAsset({ id: portalMediaAssetId(LOGO_ID) }),
    ])

    await expect(
      logo({ propertyId: PROPERTY, assetId: LOGO_ID }, admin()),
    ).rejects.toSatisfy(failsWith('media_not_found'))
    expect(experienceRepo.savePropertyLogo).not.toHaveBeenCalled()
  })

  it('refuses anyone but an Account Admin', async () => {
    const { logo } = setup()

    await expect(
      logo(
        { propertyId: PROPERTY, assetId: LOGO_ID },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
  })
})
