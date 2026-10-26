// Portal context — a Portal's own colours and name and logo (ADR 0070). What is
// pinned here is who may change a Portal's look and when: an Account Admin of
// the Portal's Property, never on an archived Portal, never for a Portal of
// another Property, and only while PORTAL_OWN_LOOK_ENABLED is on; and that a
// value left out is copied from the Property, so switching a group to the
// Portal's own moves nothing guests see. Colours are held to the Property
// look's own rules and the logo must be an uploaded logo of the Property.

import { describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import { propertyId } from '#/shared/domain/ids'
import { portalMediaAssetId } from '#/shared/domain/ids'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createInMemoryPortalLookRepo } from '#/shared/testing/in-memory-portal-look-repo'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { isPortalError } from '../../domain/errors'
import type { PortalLookBase } from '../../domain/portal-look'
import { savePortalLookColours, savePortalLookIdentity } from './save-portal-look'

const NOW = new Date('2026-10-26T12:00:00.000Z')
const PORTAL = buildTestPortal({ id: 'd0000000-0000-0000-0000-000000000001' })
const PROPERTY = PORTAL.propertyId
const OTHER_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000002')
const LOGO = '30000000-0000-4000-8000-000000000004'
const HERO = '30000000-0000-4000-8000-000000000005'
const OTHER_PROPERTY_LOGO = '30000000-0000-4000-8000-000000000006'
const ADMIN = buildTestAuthContext({ role: 'AccountAdmin' })
const MANAGER = buildTestAuthContext({ role: 'PropertyManager' })

const BASE: PortalLookBase = {
  profile: {
    primaryColor: '#B8860B',
    backgroundColor: '#1A1A1A',
    backgroundMode: 'auto',
    wordmark: 'AVELA',
    logoAssetId: null,
    heroAssetId: null,
    heroFocalX: null,
    heroFocalY: null,
    lookVersion: 4,
  },
  heroAltTexts: {},
}

const failsWith = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (
  options: Readonly<{
    enabled?: boolean
    archived?: boolean
    profile?: boolean
    accessible?: ReadonlyArray<PropertyId> | null
  }> = {},
) => {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([
    options.archived ? { ...PORTAL, publicationState: 'archived' } : PORTAL,
  ])
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const asset = (id: string, purpose: 'hero' | 'logo', property = PROPERTY) =>
    buildTestPortalMediaAsset({
      id: portalMediaAssetId(id),
      organizationId: PORTAL.organizationId,
      propertyId: property,
      purpose,
    })
  mediaRepo.seed([
    asset(LOGO, 'logo'),
    asset(HERO, 'hero'),
    asset(OTHER_PROPERTY_LOGO, 'logo', OTHER_PROPERTY),
  ])
  const portalLookRepo = createInMemoryPortalLookRepo()
  portalLookRepo.seedPortal({
    organizationId: PORTAL.organizationId,
    propertyId: PROPERTY,
    portalId: PORTAL.id,
  })
  if (options.profile ?? true) {
    portalLookRepo.seedProperty({
      organizationId: PORTAL.organizationId,
      propertyId: PROPERTY,
      base: BASE,
    })
  }
  return {
    portalLookRepo,
    deps: {
      portalRepo,
      portalLookRepo,
      mediaRepo,
      staffPublicApi: staffApi(options.accessible ?? null),
      clock: () => NOW,
      portalOwnLookEnabled: options.enabled ?? true,
    },
  }
}

const target = { propertyId: PROPERTY, portalId: PORTAL.id }

describe('savePortalLookColours', () => {
  it('copies the Property’s colours when the Portal takes them over, moving nothing', async () => {
    const { deps, portalLookRepo } = setup()

    const saved = await savePortalLookColours(deps)(
      { ...target, colours: { mode: 'own' } },
      ADMIN,
    )

    expect(saved).toEqual({
      portalId: PORTAL.id,
      sources: { photo: 'property', colours: 'portal', identity: 'property' },
      lookVersion: 4,
      changed: false,
    })
    expect(portalLookRepo.saved()).toEqual([
      {
        organizationId: ADMIN.organizationId,
        propertyId: PROPERTY,
        portalId: PORTAL.id,
        change: { group: 'colours', mode: 'own' },
        actorUserId: ADMIN.userId,
        at: NOW,
      },
    ])
  })

  it('stores colours in capitals and says the look moved', async () => {
    const { deps, portalLookRepo } = setup()

    const saved = await savePortalLookColours(deps)(
      {
        ...target,
        colours: { mode: 'own', accentColour: '#2f855a', backgroundColour: '#0b1f14' },
      },
      ADMIN,
    )

    expect(saved).toMatchObject({ lookVersion: 5, changed: true })
    expect(portalLookRepo.saved()[0]?.change).toEqual({
      group: 'colours',
      mode: 'own',
      accent: '#2F855A',
      backgroundColour: '#0B1F14',
    })
  })

  it('puts the colours back to the Property’s', async () => {
    const { deps } = setup()
    await savePortalLookColours(deps)(
      { ...target, colours: { mode: 'own', accentColour: '#2F855A' } },
      ADMIN,
    )

    const saved = await savePortalLookColours(deps)(
      { ...target, colours: { mode: 'inherit' } },
      ADMIN,
    )

    expect(saved).toMatchObject({
      sources: { colours: 'property' },
      lookVersion: 6,
      changed: true,
    })
  })

  it('refuses every save while portals may not have their own look', async () => {
    const { deps, portalLookRepo } = setup({ enabled: false })

    await expect(
      savePortalLookColours(deps)({ ...target, colours: { mode: 'own' } }, ADMIN),
    ).rejects.toSatisfy(failsWith('feature_unavailable'))
    expect(portalLookRepo.saved()).toEqual([])
  })

  it('lets only an account admin change a portal’s look', async () => {
    const { deps, portalLookRepo } = setup()

    await expect(
      savePortalLookColours(deps)({ ...target, colours: { mode: 'own' } }, MANAGER),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(portalLookRepo.saved()).toEqual([])
  })

  it('refuses an archived portal', async () => {
    const { deps } = setup({ archived: true })

    await expect(
      savePortalLookColours(deps)({ ...target, colours: { mode: 'own' } }, ADMIN),
    ).rejects.toSatisfy(failsWith('portal_inactive'))
  })

  it('refuses a portal named under another property', async () => {
    const { deps } = setup()

    await expect(
      savePortalLookColours(deps)(
        { propertyId: OTHER_PROPERTY, portalId: PORTAL.id, colours: { mode: 'own' } },
        ADMIN,
      ),
    ).rejects.toSatisfy(failsWith('portal_not_found'))
  })

  it('refuses a caller who may not see the portal’s property', async () => {
    const { deps } = setup({ accessible: [OTHER_PROPERTY] })

    await expect(
      savePortalLookColours(deps)({ ...target, colours: { mode: 'own' } }, MANAGER),
    ).rejects.toSatisfy(failsWith('forbidden'))
  })

  it('asks for the public display name first when the property has no look yet', async () => {
    const { deps } = setup({ profile: false })

    await expect(
      savePortalLookColours(deps)({ ...target, colours: { mode: 'own' } }, ADMIN),
    ).rejects.toSatisfy(failsWith('brand_profile_missing'))
  })

  it.each([
    { accentColour: 'gold' },
    { backgroundColour: '#12345' },
    { backgroundMode: 'gradient' as never },
  ])('refuses %o before anything is saved', async (colours) => {
    const { deps, portalLookRepo } = setup()

    await expect(
      savePortalLookColours(deps)(
        { ...target, colours: { mode: 'own', ...colours } },
        ADMIN,
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(portalLookRepo.saved()).toEqual([])
  })

  it('carries an unreadable pair out as the look’s refusal', async () => {
    const { deps } = setup()

    await expect(
      savePortalLookColours(deps)(
        {
          ...target,
          colours: { mode: 'own', backgroundMode: 'manual', backgroundColour: '#F5F5F5' },
        },
        ADMIN,
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
  })
})

describe('savePortalLookIdentity', () => {
  it('gives the portal its own wordmark and logo, named apart', async () => {
    const { deps, portalLookRepo } = setup()

    const saved = await savePortalLookIdentity(deps)(
      { ...target, identity: { mode: 'own', wordmark: ' SPA ', logoAssetId: LOGO } },
      ADMIN,
    )

    expect(saved).toEqual({
      portalId: PORTAL.id,
      sources: { photo: 'property', colours: 'property', identity: 'portal' },
      lookVersion: 5,
      changed: true,
    })
    expect(portalLookRepo.saved()[0]?.change).toEqual({
      group: 'identity',
      mode: 'own',
      wordmark: 'SPA',
      logoAssetId: LOGO,
    })
  })

  it('takes the logo off, and shows the display name for a blank wordmark', async () => {
    const { deps, portalLookRepo } = setup()

    await savePortalLookIdentity(deps)(
      { ...target, identity: { mode: 'own', wordmark: '   ', logoAssetId: null } },
      ADMIN,
    )

    expect(portalLookRepo.saved()[0]?.change).toEqual({
      group: 'identity',
      mode: 'own',
      wordmark: null,
      logoAssetId: null,
    })
  })

  it.each([
    ['a photo', HERO],
    ['a logo of another property', OTHER_PROPERTY_LOGO],
    ['an image that does not exist', '30000000-0000-4000-8000-0000000000ff'],
    ['something that is not an image id', 'logo.png'],
  ])('refuses %s as the logo, as an image not found', async (_, logoAssetId) => {
    const { deps, portalLookRepo } = setup()

    await expect(
      savePortalLookIdentity(deps)(
        { ...target, identity: { mode: 'own', logoAssetId } },
        ADMIN,
      ),
    ).rejects.toSatisfy(failsWith('media_not_found'))
    expect(portalLookRepo.saved()).toEqual([])
  })

  it('refuses a wordmark longer than a header holds', async () => {
    const { deps } = setup()

    await expect(
      savePortalLookIdentity(deps)(
        { ...target, identity: { mode: 'own', wordmark: 'A'.repeat(25) } },
        ADMIN,
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
  })

  it('leaves out what the save does not name', async () => {
    const { deps, portalLookRepo } = setup()

    await savePortalLookIdentity(deps)({ ...target, identity: { mode: 'own' } }, ADMIN)

    expect(portalLookRepo.saved()[0]?.change).toEqual({ group: 'identity', mode: 'own' })
  })

  it('puts the name and logo back to the property’s', async () => {
    const { deps, portalLookRepo } = setup()

    await savePortalLookIdentity(deps)(
      { ...target, identity: { mode: 'inherit' } },
      ADMIN,
    )

    expect(portalLookRepo.saved()[0]?.change).toEqual({
      group: 'identity',
      mode: 'inherit',
    })
  })

  it('refuses a save while portals may not have their own look', async () => {
    const { deps } = setup({ enabled: false })

    await expect(
      savePortalLookIdentity(deps)({ ...target, identity: { mode: 'own' } }, ADMIN),
    ).rejects.toSatisfy(failsWith('feature_unavailable'))
  })
})
