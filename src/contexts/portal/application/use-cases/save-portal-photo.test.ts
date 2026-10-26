// Portal context — a Portal's own photo (ADR 0070): the same gate as the other
// own-look saves, a photo that is an uploaded photo of the Portal's Property, a
// photo described only in the Portal's own languages, and the three modes (the
// Property's photo, its own, none).

import { describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { portalMediaAssetId, propertyId } from '#/shared/domain/ids'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createInMemoryPortalLookRepo } from '#/shared/testing/in-memory-portal-look-repo'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { isPortalError } from '../../domain/errors'
import type { PortalLookBase } from '../../domain/portal-look'
import { savePortalLookPhoto } from './save-portal-photo'

const NOW = new Date('2026-10-26T12:00:00.000Z')
const PORTAL = buildTestPortal({
  id: 'd0000000-0000-0000-0000-000000000001',
  primaryGuestLocale: 'en',
  additionalGuestLocales: ['bg'],
})
const PROPERTY_HERO = '30000000-0000-4000-8000-000000000001'
const OWN_HERO = '30000000-0000-4000-8000-000000000003'
const LOGO = '30000000-0000-4000-8000-000000000004'
const OTHER_PROPERTY_HERO = '30000000-0000-4000-8000-000000000005'
const TAKEN_DOWN_HERO = '30000000-0000-4000-8000-000000000006'
const ADMIN = buildTestAuthContext({ role: 'AccountAdmin' })

const BASE: PortalLookBase = {
  profile: {
    primaryColor: '#B8860B',
    backgroundColor: '#1A1A1A',
    backgroundMode: 'auto',
    wordmark: null,
    logoAssetId: null,
    heroAssetId: PROPERTY_HERO,
    heroFocalX: 0.3,
    heroFocalY: 0.7,
    lookVersion: 4,
  },
  heroAltTexts: { en: 'The pool at dusk' },
}

const failsWith = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

const staffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const setup = (enabled = true) => {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([PORTAL])
  const portalLookRepo = createInMemoryPortalLookRepo()
  const scope = { organizationId: PORTAL.organizationId, propertyId: PORTAL.propertyId }
  portalLookRepo.seedPortal({ ...scope, portalId: PORTAL.id })
  portalLookRepo.seedProperty({ ...scope, base: BASE })
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const asset = (id: string, patch: Parameters<typeof buildTestPortalMediaAsset>[0]) =>
    buildTestPortalMediaAsset({ id: portalMediaAssetId(id), ...scope, ...patch })
  mediaRepo.seed([
    asset(OWN_HERO, { purpose: 'hero' }),
    asset(LOGO, { purpose: 'logo' }),
    asset(OTHER_PROPERTY_HERO, {
      purpose: 'hero',
      propertyId: propertyId('a0000000-0000-0000-0000-0000000000ff'),
    }),
    asset(TAKEN_DOWN_HERO, { purpose: 'hero', status: 'taken_down', takenDownAt: NOW }),
  ])
  return {
    portalLookRepo,
    deps: {
      portalRepo,
      portalLookRepo,
      mediaRepo,
      staffPublicApi: staffApi,
      clock: () => NOW,
      portalOwnLookEnabled: enabled,
    },
  }
}

const target = { propertyId: PORTAL.propertyId, portalId: PORTAL.id }

describe('savePortalLookPhoto', () => {
  it('gives the portal its own photo with a description per language', async () => {
    const { deps, portalLookRepo } = setup()

    const saved = await savePortalLookPhoto(deps)(
      {
        ...target,
        photo: {
          mode: 'own',
          heroAssetId: OWN_HERO,
          focalX: 0.5,
          focalY: 0.4,
          altTexts: [
            { locale: 'en', text: 'Treatment room' },
            { locale: 'bg', text: null },
          ],
        },
      },
      ADMIN,
    )

    expect(saved).toEqual({
      portalId: PORTAL.id,
      sources: { photo: 'portal', colours: 'property', identity: 'property' },
      lookVersion: 5,
      changed: true,
    })
    expect(portalLookRepo.saved()[0]?.change).toEqual({
      group: 'photo',
      mode: 'own',
      heroAssetId: OWN_HERO,
      focalX: 0.5,
      focalY: 0.4,
      altTexts: { en: 'Treatment room', bg: null },
    })
  })

  it('moves the anchor alone without naming the photo again', async () => {
    const { deps, portalLookRepo } = setup()

    await savePortalLookPhoto(deps)(
      { ...target, photo: { mode: 'own', focalY: 0.6 } },
      ADMIN,
    )

    // The missing half is the middle, as it is for the Property's photo.
    expect(portalLookRepo.saved()[0]?.change).toEqual({
      group: 'photo',
      mode: 'own',
      focalX: 0.5,
      focalY: 0.6,
    })
  })

  it.each([
    ['a logo', LOGO],
    ['a photo of another property', OTHER_PROPERTY_HERO],
    ['a photo that was taken down', TAKEN_DOWN_HERO],
    ['an image that does not exist', '30000000-0000-4000-8000-0000000000ff'],
  ])('refuses %s as the photo, as an image not found', async (_, heroAssetId) => {
    const { deps, portalLookRepo } = setup()

    await expect(
      savePortalLookPhoto(deps)(
        { ...target, photo: { mode: 'own', heroAssetId } },
        ADMIN,
      ),
    ).rejects.toSatisfy(failsWith('media_not_found'))
    expect(portalLookRepo.saved()).toEqual([])
  })

  it('refuses an anchor outside the photo before anything is saved', async () => {
    const { deps, portalLookRepo } = setup()

    await expect(
      savePortalLookPhoto(deps)(
        { ...target, photo: { mode: 'own', heroAssetId: OWN_HERO, focalX: 1.2 } },
        ADMIN,
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(portalLookRepo.saved()).toEqual([])
  })

  it('keeps each language once, the last word standing, trimmed', async () => {
    const { deps, portalLookRepo } = setup()

    await savePortalLookPhoto(deps)(
      {
        ...target,
        photo: {
          mode: 'own',
          heroAssetId: OWN_HERO,
          altTexts: [
            { locale: 'en', text: 'First' },
            { locale: 'en', text: '  Treatment room  ' },
            { locale: 'bg', text: '   ' },
          ],
        },
      },
      ADMIN,
    )

    expect(portalLookRepo.saved()[0]?.change).toMatchObject({
      altTexts: { en: 'Treatment room', bg: null },
    })
  })

  it('refuses a description in a language the portal is not in', async () => {
    const { deps, portalLookRepo } = setup()

    await expect(
      savePortalLookPhoto(deps)(
        {
          ...target,
          photo: {
            mode: 'own',
            heroAssetId: OWN_HERO,
            altTexts: [{ locale: 'de', text: 'Behandlungsraum' }],
          },
        },
        ADMIN,
      ),
    ).rejects.toSatisfy(failsWith('locale_not_offered'))
    expect(portalLookRepo.saved()).toEqual([])
  })

  it.each(['none', 'inherit'] as const)('saves the %s photo mode', async (mode) => {
    const { deps, portalLookRepo } = setup()

    await savePortalLookPhoto(deps)({ ...target, photo: { mode } }, ADMIN)

    expect(portalLookRepo.saved()[0]?.change).toEqual({ group: 'photo', mode })
  })

  it('refuses a save while portals may not have their own look', async () => {
    const { deps } = setup(false)

    await expect(
      savePortalLookPhoto(deps)({ ...target, photo: { mode: 'none' } }, ADMIN),
    ).rejects.toSatisfy(failsWith('feature_unavailable'))
  })

  it('lets only an account admin change the photo', async () => {
    const { deps } = setup()

    await expect(
      savePortalLookPhoto(deps)(
        { ...target, photo: { mode: 'none' } },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
  })
})
