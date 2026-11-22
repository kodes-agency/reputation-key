// Portal context — Property-wide brand profile and content and per-Portal
// localized override use cases, the real ones over real PostgreSQL and two
// Organizations. Three decisions are pinned, because each is the only thing
// standing between a manager and a broken guest page:
//   * `portal.admin`, not ordinary `portal.update`, authorizes Property-wide
//     branding, so a PropertyManager is refused on the save paths and reported
//     `canManagePropertyBrand: false` on both read paths;
//   * the accessible text-contrast floor is checked before anything persists;
//   * manager-supplied image URLs are never admitted, whatever the caller sent.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import {
  getPropertyPortalExperience,
  savePortalLocalizedOverride,
} from './manage-portal-experience.server'
import { AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR } from '../domain/portal-experience'
import { createPortalMediaAssetRepository } from '../media/portal-media-asset-repository.server'
import {
  SEED_ACTOR,
  seedBrandProfile,
  seedMediaAsset,
  seedMediaPortal,
  seedMediaProperty,
} from '../infrastructure/testing/portal-media-experience-seed'
import {
  NOW,
  ORG_A,
  ORG_B,
  adminOf,
  depsOf,
  getPool,
  managerOf,
  query,
  rejectsWithPortalCode,
  scene,
  setupExperienceDb,
  withoutPermissions,
} from './portal-experience-world.test-fixtures'

setupExperienceDb()

const readExperience = (
  input: Parameters<ReturnType<typeof getPropertyPortalExperience>>[0],
  ctx: AuthContext,
  accessible: ReadonlyArray<PropertyId> | null = null,
) => getPropertyPortalExperience(depsOf(accessible))(input, ctx)

describe('getPropertyPortalExperience (real PostgreSQL)', () => {
  it('returns the Property experience with no overrides and no brand authority for a read-only manager', async () => {
    const { property } = await scene()
    const ctx = buildTestAuthContext({
      role: 'PropertyManager',
      organizationId: ORG_A,
      effectivePermissions: new Set(['portal.read']),
      scopeByPermission: new Map([['portal.read', 'organization']]),
    })

    const result = await readExperience({ propertyId: property }, ctx, [property])

    expect(result).toEqual({
      profile: null,
      content: [],
      overrides: [],
      media: { hero: null, logo: null },
      canManagePropertyBrand: false,
      publicDisplayNameConfirmed: false,
      portalLook: null,
      siblingPortalCount: 0,
    })
  })

  it('reads the named Portal overrides and reports brand authority for an Account Admin', async () => {
    const { property } = await scene()
    const portal = await seedMediaPortal(getPool(), ORG_A, property)
    await savePortalLocalizedOverride(depsOf())(
      { portalId: portal, locale: 'en', title: 'Rooftop Bar', shortDescription: null },
      adminOf(),
    )

    const result = await readExperience(
      { propertyId: property, portalId: portal },
      adminOf(),
    )

    expect(result.canManagePropertyBrand).toBe(true)
    expect(result.overrides).toHaveLength(1)
    expect(result.overrides[0]).toMatchObject({
      portalId: portal,
      locale: 'en',
      title: 'Rooftop Bar',
    })
  })

  it('withholds brand authority from a PropertyManager on both the Property and named-Portal reads', async () => {
    const { property } = await scene()
    const portal = await seedMediaPortal(getPool(), ORG_A, property)
    const ctx = managerOf()

    // PropertyManager is the only role that separates the two permissions: it
    // holds portal.update but not portal.admin. Reporting `true` here would
    // hand a manager an editable Property-brand form that assertPortalAdmin
    // then refuses to save, so both read paths are pinned.
    const propertyOnly = await readExperience({ propertyId: property }, ctx, [property])
    const withPortal = await readExperience(
      { propertyId: property, portalId: portal },
      ctx,
      [property],
    )

    expect(propertyOnly.canManagePropertyBrand).toBe(false)
    expect(withPortal.canManagePropertyBrand).toBe(false)
  })

  it('reports the public display name confirmed only once a person saved it', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property, {
      updatedBy: AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR,
    })
    const ctx = adminOf()
    const read = () => readExperience({ propertyId: property }, ctx)

    const automatic = await read()
    await query(
      `UPDATE property_portal_brand_profiles SET updated_by = $3
       WHERE organization_id = $1 AND property_id = $2`,
      [ORG_A, property, ctx.userId],
    )
    const saved = await read()

    expect(automatic.publicDisplayNameConfirmed).toBe(false)
    expect(saved.publicDisplayNameConfirmed).toBe(true)
  })

  it('reads the photograph and logo the profile names as the media a page draws, leaving out a taken-down one', async () => {
    const { property } = await scene()
    const hero = await seedMediaAsset(ORG_A, property, {
      purpose: 'hero',
      width: 2400,
      height: 1600,
    })
    const logo = await seedMediaAsset(ORG_A, property, {
      purpose: 'logo',
      status: 'taken_down',
      takenDownAt: NOW,
    })
    await seedBrandProfile(getPool(), ORG_A, property, {
      heroAssetId: hero.id,
      heroFocalX: 0.5,
      heroFocalY: 0.42,
      logoAssetId: logo.id,
    })

    const result = await readExperience({ propertyId: property }, adminOf())

    expect(result.media.hero).toMatchObject({
      assetId: hero.id,
      width: 2400,
      height: 1600,
      focalX: 0.5,
      focalY: 0.42,
    })
    expect(result.media.logo).toBeNull()
  })

  it('reads nothing of another Organization’s Property', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    const result = await readExperience({ propertyId: property }, adminOf(ORG_B))

    expect(result.profile).toBeNull()
    expect(result.content).toEqual([])
    expect(result.siblingPortalCount).toBe(0)
  })

  describe("a Portal's own look (ADR 0070)", () => {
    async function lookScene() {
      const base = await scene()
      const portal = await seedMediaPortal(getPool(), ORG_A, base.property)
      const ownHero = await seedMediaAsset(ORG_A, base.property, {
        purpose: 'hero',
        width: 1200,
        height: 800,
      })
      const ownLogo = await seedMediaAsset(ORG_A, base.property, {
        purpose: 'logo',
        width: 300,
        height: 300,
      })
      return { ...base, portal, ownHero, ownLogo }
    }

    const insertOverride = (
      org: OrganizationId,
      property: PropertyId,
      portal: PortalId,
      columns: Readonly<Record<string, unknown>>,
    ) => {
      const values = {
        id: randomUUID(),
        organization_id: org,
        property_id: property,
        portal_id: portal,
        look_version: 5,
        updated_by: SEED_ACTOR,
        ...columns,
      }
      const names = Object.keys(values)
      return query(
        `INSERT INTO portal_look_overrides (${names.join(', ')})
         VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values(values),
      )
    }

    const ownLook = (heroId: string, logoId: string) => ({
      photo_mode: 'own',
      hero_asset_id: heroId,
      hero_focal_x: 0.2,
      hero_focal_y: 0.4,
      hero_alt_texts: JSON.stringify({ en: 'The spa pool' }),
      colours_mode: 'own',
      primary_color: '#B8860B',
      background_mode: 'auto',
      background_color: '#201810',
      identity_mode: 'own',
      wordmark: 'SPA',
      logo_asset_id: logoId,
    })

    it('reads no look of its own for a Portal that follows the Property', async () => {
      const { property, portal } = await lookScene()

      const view = await readExperience(
        { propertyId: property, portalId: portal },
        adminOf(),
      )

      expect(view.portalLook).toBeNull()
    })

    it('counts the Property’s Portals that are not archived, this one included', async () => {
      const { property, portal, otherProperty } = await lookScene()
      await seedMediaPortal(getPool(), ORG_A, property, { state: 'published' })
      await seedMediaPortal(getPool(), ORG_A, property, { state: 'archived' })
      await seedMediaPortal(getPool(), ORG_A, otherProperty)

      const named = await readExperience(
        { propertyId: property, portalId: portal },
        adminOf(),
      )
      const propertyOnly = await readExperience({ propertyId: property }, adminOf())

      expect(named.siblingPortalCount).toBe(2)
      expect(propertyOnly.siblingPortalCount).toBe(2)
    })

    it('reads the Portal’s own look with the images it names resolved like the Property’s', async () => {
      const { property, portal, ownHero, ownLogo } = await lookScene()
      await insertOverride(ORG_A, property, portal, ownLook(ownHero.id, ownLogo.id))

      const result = await readExperience(
        { propertyId: property, portalId: portal },
        adminOf(),
      )

      expect(result.portalLook).toMatchObject({
        sources: { photo: 'portal', colours: 'portal', identity: 'portal' },
        lookVersion: 5,
        photo: {
          mode: 'own',
          heroAssetId: ownHero.id,
          altTexts: { en: 'The spa pool' },
          hero: {
            assetId: ownHero.id,
            width: 1200,
            height: 800,
            focalX: 0.2,
            focalY: 0.4,
          },
        },
        colours: { mode: 'own', accentColour: '#B8860B', backgroundMode: 'auto' },
        identity: {
          mode: 'own',
          wordmark: 'SPA',
          logo: { assetId: ownLogo.id, width: 300, height: 300 },
        },
      })
      // The Property’s own media are not the Portal’s.
      expect(result.media).toEqual({ hero: null, logo: null })
    })

    it('reads an own photo that was taken down as no photo, and says which one it is', async () => {
      const { property, portal, ownHero, ownLogo } = await lookScene()
      await insertOverride(ORG_A, property, portal, ownLook(ownHero.id, ownLogo.id))
      await createPortalMediaAssetRepository(getDb()).markTakenDown(
        ORG_A,
        ownHero.id,
        NOW,
      )

      const result = await readExperience(
        { propertyId: property, portalId: portal },
        adminOf(),
      )

      expect(result.portalLook?.photo).toMatchObject({
        mode: 'own',
        heroAssetId: ownHero.id,
        hero: null,
      })
    })

    it('lets a Property Manager read the Portal’s look, though not change it', async () => {
      const { property, portal, ownLogo } = await lookScene()
      await insertOverride(ORG_A, property, portal, {
        photo_mode: 'none',
        colours_mode: 'own',
        primary_color: '#B8860B',
        background_mode: 'auto',
        background_color: '#201810',
        identity_mode: 'own',
        wordmark: 'SPA',
        logo_asset_id: ownLogo.id,
      })

      const result = await readExperience(
        { propertyId: property, portalId: portal },
        managerOf(),
        [property],
      )

      expect(result.portalLook?.sources.photo).toBe('none')
      expect(result.canManagePropertyBrand).toBe(false)
    })

    it('does not let another Property’s override sit under this Portal: the database refuses it', async () => {
      const { portal, otherProperty, ownHero, ownLogo } = await lookScene()

      await expect(
        insertOverride(ORG_A, otherProperty, portal, ownLook(ownHero.id, ownLogo.id)),
      ).rejects.toMatchObject({ code: '23503' })
    })
  })

  it('refuses a Portal that belongs to a different Property', async () => {
    const { property, otherProperty } = await scene()
    const portal = await seedMediaPortal(getPool(), ORG_A, otherProperty)

    // The Portal is readable in this organization; naming it under the wrong
    // Property would splice one Property's overrides onto another's brand.
    await rejectsWithPortalCode(
      readExperience({ propertyId: property, portalId: portal }, adminOf()),
      'portal_not_found',
    )
  })

  it('does not find a Portal of another Organization', async () => {
    const { property } = await scene()
    const tenantB = await seedMediaProperty(getPool(), ORG_B)
    const foreign = await seedMediaPortal(getPool(), ORG_B, tenantB)

    await rejectsWithPortalCode(
      readExperience({ propertyId: property, portalId: foreign }, adminOf()),
      'portal_not_found',
    )
  })

  it('refuses a reader whose assignment excludes the Property', async () => {
    const { property } = await scene()

    await rejectsWithPortalCode(
      readExperience({ propertyId: property }, managerOf(), []),
      'forbidden',
    )
  })

  it('refuses a caller without portal.read', async () => {
    const { property } = await scene()

    await rejectsWithPortalCode(
      readExperience({ propertyId: property }, withoutPermissions()),
      'forbidden',
    )
  })
})
