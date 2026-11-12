// Portal context — a Portal's own colours, name and logo, and photo, through
// the real use cases over real PostgreSQL and two Organizations (ADR 0070). What
// is pinned: who may change a Portal's look (an Account Admin of the Portal's
// Property), never on an archived Portal, never for a Portal of another Property
// or Organization; a value left out is copied from the Property, so taking a
// group over moves nothing guests see; colours are held to the Property look's
// own rules; the logo and photo must be uploaded images of the Property; and a
// photo is described only in the Portal's own languages.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { getDb } from '#/shared/db'
import {
  organizationId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  savePortalLookColours,
  savePortalLookIdentity,
} from '../application/use-cases/save-portal-look'
import { savePortalLookPhoto } from '../application/use-cases/save-portal-photo'
import { isPortalError } from '../domain/errors'
import { createPortalLookRepository } from './repositories/portal-look.repository'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'
import { createPortalRepository } from './repositories/portal.repository'
import {
  MEDIA_EXPERIENCE_TABLES,
  seedBrandProfile,
  seedMediaAsset,
  seedMediaPortal,
  seedMediaProperty,
} from './testing/portal-media-experience-seed'

const ORG_A = organizationId('org-portal-look-cases-0000000001')
const ORG_B = organizationId('org-portal-look-cases-0000000002')
const NOW = new Date('2026-10-26T12:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: MEDIA_EXPERIENCE_TABLES,
})

const failsWith = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const adminOf = (org: OrganizationId = ORG_A) =>
  buildTestAuthContext({ role: 'AccountAdmin', organizationId: org })
const manager = () =>
  buildTestAuthContext({ role: 'PropertyManager', organizationId: ORG_A })

type SceneOptions = Readonly<{
  archived?: boolean
  profile?: boolean
  accessible?: ReadonlyArray<PropertyId> | null
}>

async function scene(options: SceneOptions = {}) {
  const pool = getPool()
  const property = await seedMediaProperty(pool, ORG_A)
  const otherProperty = await seedMediaProperty(pool, ORG_A)
  const portal = await seedMediaPortal(pool, ORG_A, property, {
    state: options.archived ? 'archived' : 'published',
    published: !options.archived,
    additionalLocales: ['bg'],
  })
  if (options.profile ?? true) {
    await seedBrandProfile(pool, ORG_A, property, { wordmark: 'AVELA', lookVersion: 4 })
  }
  const logo = await seedMediaAsset(ORG_A, property, { purpose: 'logo' })
  const hero = await seedMediaAsset(ORG_A, property, { purpose: 'hero' })
  const otherPropertyLogo = await seedMediaAsset(ORG_A, otherProperty, {
    purpose: 'logo',
  })
  const otherPropertyHero = await seedMediaAsset(ORG_A, otherProperty, {
    purpose: 'hero',
  })
  const takenDownHero = await seedMediaAsset(ORG_A, property, {
    purpose: 'hero',
    status: 'taken_down',
    takenDownAt: NOW,
  })
  const deps = {
    portalRepo: createPortalRepository(getDb()),
    portalLookRepo: createPortalLookRepository(getDb()),
    mediaRepo: createPortalMediaAssetRepository(getDb()),
    staffPublicApi: staffApi(options.accessible ?? null),
    clock: () => NOW,
  }
  return {
    deps,
    property,
    otherProperty,
    portal,
    target: { propertyId: property, portalId: portal },
    logo,
    hero,
    otherPropertyLogo,
    otherPropertyHero,
    takenDownHero,
  }
}

async function overrideRow(portal: PortalId, org: OrganizationId = ORG_A) {
  const { rows } = await getPool().query(
    `SELECT photo_mode, hero_asset_id::text AS hero_asset_id, hero_focal_x, hero_focal_y,
            hero_alt_texts, colours_mode, primary_color, background_mode, background_color,
            identity_mode, wordmark, logo_asset_id::text AS logo_asset_id, look_version,
            updated_by
     FROM portal_look_overrides WHERE organization_id = $1 AND portal_id = $2`,
    [org, portal],
  )
  return rows[0]
}

const pageEdits = async () =>
  (
    await getPool().query(
      'SELECT change_key FROM portal_page_edits WHERE organization_id = $1 ORDER BY change_key',
      [ORG_A],
    )
  ).rows.map((row) => row.change_key as string)

describe('savePortalLookColours (real PostgreSQL)', () => {
  it('copies the Property’s colours when the Portal takes them over, moving nothing', async () => {
    const { deps, target, portal } = await scene()
    const ctx = adminOf()

    const saved = await savePortalLookColours(deps)(
      { ...target, colours: { mode: 'own' } },
      ctx,
    )

    expect(saved).toEqual({
      portalId: portal,
      sources: { photo: 'property', colours: 'portal', identity: 'property' },
      lookVersion: 4,
      changed: false,
    })
    expect(await overrideRow(portal)).toMatchObject({
      colours_mode: 'own',
      primary_color: '#B8860B',
      background_color: '#1A1A1A',
      photo_mode: 'inherit',
      identity_mode: 'inherit',
      look_version: 4,
      updated_by: ctx.userId,
    })
    expect(await pageEdits()).toEqual([])
  })

  it('stores colours in capitals and says the look moved', async () => {
    const { deps, target, portal } = await scene()

    const saved = await savePortalLookColours(deps)(
      {
        ...target,
        colours: { mode: 'own', accentColour: '#2f855a', backgroundColour: '#0b1f14' },
      },
      adminOf(),
    )

    expect(saved).toMatchObject({ lookVersion: 5, changed: true })
    expect(await overrideRow(portal)).toMatchObject({
      primary_color: '#2F855A',
      background_color: '#0B1F14',
      look_version: 5,
    })
    expect((await pageEdits()).length).toBeGreaterThan(0)
  })

  it('puts the colours back to the Property’s', async () => {
    const { deps, target, portal } = await scene()
    await savePortalLookColours(deps)(
      { ...target, colours: { mode: 'own', accentColour: '#2F855A' } },
      adminOf(),
    )

    const saved = await savePortalLookColours(deps)(
      { ...target, colours: { mode: 'inherit' } },
      adminOf(),
    )

    expect(saved).toMatchObject({
      sources: { colours: 'property' },
      lookVersion: 6,
      changed: true,
    })
    expect(await overrideRow(portal)).toMatchObject({
      colours_mode: 'inherit',
      primary_color: null,
    })
  })

  it('lets only an account admin change a portal’s look', async () => {
    const { deps, target, portal } = await scene()

    await expect(
      savePortalLookColours(deps)({ ...target, colours: { mode: 'own' } }, manager()),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('refuses an archived portal', async () => {
    const { deps, target, portal } = await scene({ archived: true })

    await expect(
      savePortalLookColours(deps)({ ...target, colours: { mode: 'own' } }, adminOf()),
    ).rejects.toSatisfy(failsWith('portal_inactive'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('refuses a portal archived while the save was on its way', async () => {
    const { deps, target, portal } = await scene({ archived: true })
    const real = deps.portalRepo
    // The caller's check saw the Portal live; the archive landed before the save.
    const stale = {
      ...real,
      findById: async (...args: Parameters<typeof real.findById>) => {
        const found = await real.findById(...args)
        return found && { ...found, publicationState: 'published' as const }
      },
    }

    await expect(
      savePortalLookColours({ ...deps, portalRepo: stale })(
        { ...target, colours: { mode: 'own' } },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('portal_inactive'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('refuses a portal named under another property', async () => {
    const { deps, otherProperty, portal } = await scene()

    await expect(
      savePortalLookColours(deps)(
        { propertyId: otherProperty, portalId: portal, colours: { mode: 'own' } },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('portal_not_found'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('does not find a portal of another Organization, and changes nothing for it', async () => {
    const { deps, target, portal } = await scene()

    await expect(
      savePortalLookColours(deps)(
        { ...target, colours: { mode: 'own' } },
        adminOf(ORG_B),
      ),
    ).rejects.toSatisfy(failsWith('portal_not_found'))
    expect(await overrideRow(portal)).toBeUndefined()
    expect(await overrideRow(portal, ORG_B)).toBeUndefined()
  })

  it('refuses a caller who may not see the portal’s property', async () => {
    const { deps, target, otherProperty } = await scene({ accessible: [] })
    expect(otherProperty).toBeTruthy()

    await expect(
      savePortalLookColours(deps)({ ...target, colours: { mode: 'own' } }, manager()),
    ).rejects.toSatisfy(failsWith('forbidden'))
  })

  it('asks for the public display name first when the property has no look yet', async () => {
    const { deps, target } = await scene({ profile: false })

    await expect(
      savePortalLookColours(deps)({ ...target, colours: { mode: 'own' } }, adminOf()),
    ).rejects.toSatisfy(failsWith('brand_profile_missing'))
  })

  it.each([
    { accentColour: 'gold' },
    { backgroundColour: '#12345' },
    { backgroundMode: 'gradient' as never },
  ])('refuses %o before anything is saved', async (colours) => {
    const { deps, target, portal } = await scene()

    await expect(
      savePortalLookColours(deps)(
        { ...target, colours: { mode: 'own', ...colours } },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('carries an unreadable pair out as the look’s refusal', async () => {
    const { deps, target, portal } = await scene()

    await expect(
      savePortalLookColours(deps)(
        {
          ...target,
          colours: { mode: 'own', backgroundMode: 'manual', backgroundColour: '#F5F5F5' },
        },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(await overrideRow(portal)).toBeUndefined()
  })
})

describe('savePortalLookIdentity (real PostgreSQL)', () => {
  it('gives the portal its own wordmark and logo, named apart', async () => {
    const { deps, target, portal, logo } = await scene()

    const saved = await savePortalLookIdentity(deps)(
      { ...target, identity: { mode: 'own', wordmark: ' SPA ', logoAssetId: logo.id } },
      adminOf(),
    )

    expect(saved).toEqual({
      portalId: portal,
      sources: { photo: 'property', colours: 'property', identity: 'portal' },
      lookVersion: 5,
      changed: true,
    })
    expect(await overrideRow(portal)).toMatchObject({
      identity_mode: 'own',
      wordmark: 'SPA',
      logo_asset_id: logo.id,
    })
  })

  it('takes the logo off, and shows the display name for a blank wordmark', async () => {
    const { deps, target, portal } = await scene()

    await savePortalLookIdentity(deps)(
      { ...target, identity: { mode: 'own', wordmark: '   ', logoAssetId: null } },
      adminOf(),
    )

    expect(await overrideRow(portal)).toMatchObject({
      identity_mode: 'own',
      wordmark: null,
      logo_asset_id: null,
    })
  })

  it.each([
    'a photo',
    'a logo of another property',
    'an image that does not exist',
    'something that is not an image id',
  ])('refuses %s as the logo, as an image not found', async (what) => {
    const { deps, target, portal, hero, otherPropertyLogo } = await scene()
    const logoAssetId = {
      'a photo': hero.id,
      'a logo of another property': otherPropertyLogo.id,
      'an image that does not exist': randomUUID(),
      'something that is not an image id': 'logo.png',
    }[what] as string

    await expect(
      savePortalLookIdentity(deps)(
        { ...target, identity: { mode: 'own', logoAssetId } },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('media_not_found'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('refuses a logo of another Organization as an image not found', async () => {
    const { deps, target, portal } = await scene()
    const tenantB = await seedMediaProperty(getPool(), ORG_B)
    const foreign = await seedMediaAsset(ORG_B, tenantB, { purpose: 'logo' })

    await expect(
      savePortalLookIdentity(deps)(
        { ...target, identity: { mode: 'own', logoAssetId: foreign.id } },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('media_not_found'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('refuses a wordmark longer than a header holds', async () => {
    const { deps, target } = await scene()

    await expect(
      savePortalLookIdentity(deps)(
        { ...target, identity: { mode: 'own', wordmark: 'A'.repeat(25) } },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
  })

  it('leaves out what the save does not name, taking the Property’s over', async () => {
    const { deps, target, portal } = await scene()

    await savePortalLookIdentity(deps)(
      { ...target, identity: { mode: 'own' } },
      adminOf(),
    )

    expect(await overrideRow(portal)).toMatchObject({
      identity_mode: 'own',
      wordmark: 'AVELA',
      logo_asset_id: null,
    })
  })

  it('puts the name and logo back to the property’s', async () => {
    const { deps, target, portal, logo } = await scene()
    await savePortalLookIdentity(deps)(
      { ...target, identity: { mode: 'own', wordmark: 'SPA', logoAssetId: logo.id } },
      adminOf(),
    )

    await savePortalLookIdentity(deps)(
      { ...target, identity: { mode: 'inherit' } },
      adminOf(),
    )

    expect(await overrideRow(portal)).toMatchObject({
      identity_mode: 'inherit',
      wordmark: null,
      logo_asset_id: null,
    })
  })

  it('lets only an account admin change the name and logo', async () => {
    const { deps, target, portal } = await scene()

    await expect(
      savePortalLookIdentity(deps)(
        { ...target, identity: { mode: 'inherit' } },
        manager(),
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(await overrideRow(portal)).toBeUndefined()
  })
})

describe('savePortalLookPhoto (real PostgreSQL)', () => {
  it('gives the portal its own photo with a description per language', async () => {
    const { deps, target, portal, hero } = await scene()

    const saved = await savePortalLookPhoto(deps)(
      {
        ...target,
        photo: {
          mode: 'own',
          heroAssetId: hero.id,
          focalX: 0.5,
          focalY: 0.4,
          altTexts: [
            { locale: 'en', text: 'Treatment room' },
            { locale: 'bg', text: null },
          ],
        },
      },
      adminOf(),
    )

    expect(saved).toEqual({
      portalId: portal,
      sources: { photo: 'portal', colours: 'property', identity: 'property' },
      lookVersion: 5,
      changed: true,
    })
    expect(await overrideRow(portal)).toMatchObject({
      photo_mode: 'own',
      hero_asset_id: hero.id,
      hero_focal_x: 0.5,
      hero_focal_y: 0.4,
      hero_alt_texts: { en: 'Treatment room' },
    })
  })

  it('moves the anchor alone without naming the photo again', async () => {
    const { deps, target, portal, hero } = await scene()
    await savePortalLookPhoto(deps)(
      {
        ...target,
        photo: { mode: 'own', heroAssetId: hero.id, focalX: 0.2, focalY: 0.2 },
      },
      adminOf(),
    )

    await savePortalLookPhoto(deps)(
      { ...target, photo: { mode: 'own', focalY: 0.6 } },
      adminOf(),
    )

    // The missing half is the middle, as it is for the Property's photo.
    expect(await overrideRow(portal)).toMatchObject({
      hero_asset_id: hero.id,
      hero_focal_x: 0.5,
      hero_focal_y: 0.6,
    })
  })

  it.each([
    'a logo',
    'a photo of another property',
    'a photo that was taken down',
    'an image that does not exist',
  ])('refuses %s as the photo, as an image not found', async (what) => {
    const { deps, target, portal, logo, otherPropertyHero, takenDownHero } = await scene()
    const heroAssetId = {
      'a logo': logo.id,
      'a photo of another property': otherPropertyHero.id,
      'a photo that was taken down': takenDownHero.id,
      'an image that does not exist': randomUUID(),
    }[what] as string

    await expect(
      savePortalLookPhoto(deps)(
        { ...target, photo: { mode: 'own', heroAssetId } },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('media_not_found'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('refuses an anchor outside the photo before anything is saved', async () => {
    const { deps, target, portal, hero } = await scene()

    await expect(
      savePortalLookPhoto(deps)(
        { ...target, photo: { mode: 'own', heroAssetId: hero.id, focalX: 1.2 } },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('keeps each language once, the last word standing, trimmed', async () => {
    const { deps, target, portal, hero } = await scene()

    await savePortalLookPhoto(deps)(
      {
        ...target,
        photo: {
          mode: 'own',
          heroAssetId: hero.id,
          altTexts: [
            { locale: 'en', text: 'First' },
            { locale: 'en', text: '  Treatment room  ' },
            { locale: 'bg', text: '   ' },
          ],
        },
      },
      adminOf(),
    )

    expect((await overrideRow(portal)).hero_alt_texts).toEqual({ en: 'Treatment room' })
  })

  it('refuses a description in a language the portal is not in', async () => {
    const { deps, target, portal, hero } = await scene()

    await expect(
      savePortalLookPhoto(deps)(
        {
          ...target,
          photo: {
            mode: 'own',
            heroAssetId: hero.id,
            altTexts: [{ locale: 'de', text: 'Behandlungsraum' }],
          },
        },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('locale_not_offered'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it.each(['none', 'inherit'] as const)('saves the %s photo mode', async (mode) => {
    const { deps, target, portal } = await scene()
    // A Portal that already follows the Property has no row to change, so it starts without the photo.
    if (mode === 'inherit') {
      await savePortalLookPhoto(deps)({ ...target, photo: { mode: 'none' } }, adminOf())
    }

    await savePortalLookPhoto(deps)({ ...target, photo: { mode } }, adminOf())

    expect(await overrideRow(portal)).toMatchObject({
      photo_mode: mode,
      hero_asset_id: null,
    })
  })

  it('lets only an account admin change the photo', async () => {
    const { deps, target, portal } = await scene()

    await expect(
      savePortalLookPhoto(deps)({ ...target, photo: { mode: 'none' } }, manager()),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('does not find a portal of another Organization', async () => {
    const { deps, target, portal } = await scene()

    await expect(
      savePortalLookPhoto(deps)({ ...target, photo: { mode: 'none' } }, adminOf(ORG_B)),
    ).rejects.toSatisfy(failsWith('portal_not_found'))
    expect(await overrideRow(portal, ORG_B)).toBeUndefined()
  })
})
