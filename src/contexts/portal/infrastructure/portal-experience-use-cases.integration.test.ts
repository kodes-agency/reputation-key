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
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { getDb } from '#/shared/db'
import {
  organizationId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  ensureDefaultPublicDisplayName,
  getPropertyPortalExperience,
  savePortalLocalizedOverride,
  savePropertyDefaultGuestLocales,
  savePropertyPortalBrandContent,
  savePropertyPortalBrandProfile,
  savePropertyPublicDisplayName,
} from '../application/use-cases/manage-portal-experience'
import { isPortalError } from '../domain/errors'
import { AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR } from '../domain/portal-experience'
import { createPortalLookRepository } from './repositories/portal-look.repository'
import { createPortalExperienceRepository } from './repositories/portal-experience.repository'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'
import { createPortalRepository } from './repositories/portal.repository'
import {
  MEDIA_EXPERIENCE_TABLES,
  SEED_ACTOR,
  seedBrandProfile,
  seedMediaAsset,
  seedMediaPortal,
  seedMediaProperty,
} from './testing/portal-media-experience-seed'

const ORG_A = organizationId('org-portal-experience-cases-0001')
const ORG_B = organizationId('org-portal-experience-cases-0002')
const NOW = new Date('2026-08-27T12:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: MEDIA_EXPERIENCE_TABLES,
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

const failsWith = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

const staffApiOf = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const depsOf = (accessible: ReadonlyArray<PropertyId> | null = null) => ({
  experienceRepo: createPortalExperienceRepository(getDb()),
  mediaRepo: createPortalMediaAssetRepository(getDb()),
  portalRepo: createPortalRepository(getDb()),
  portalLookRepo: createPortalLookRepository(getDb()),
  staffPublicApi: staffApiOf(accessible),
  idGen: () => randomUUID(),
  clock: () => NOW,
})

const adminOf = (org: OrganizationId = ORG_A) =>
  buildTestAuthContext({ role: 'AccountAdmin', organizationId: org })
const managerOf = (org: OrganizationId = ORG_A) =>
  buildTestAuthContext({ role: 'PropertyManager', organizationId: org })

/** Denies every permission: the dynamic resolver path, not a built-in role. */
const withoutPermissions = (): AuthContext =>
  buildTestAuthContext({ organizationId: ORG_A, effectivePermissions: new Set() })

const query = (text: string, values: readonly unknown[] = []) =>
  getPool().query(text, [...values])

async function profileRow(property: PropertyId, org: OrganizationId = ORG_A) {
  const { rows } = await query(
    `SELECT display_name, logo_url, default_hero_image_url, primary_color, background_color,
            text_color, wordmark, background_mode, default_guest_locales, updated_by, version
     FROM property_portal_brand_profiles WHERE organization_id = $1 AND property_id = $2`,
    [org, property],
  )
  return rows[0]
}

async function contentRow(property: PropertyId, locale: string) {
  const { rows } = await query(
    `SELECT title, short_description, hero_alt_text, updated_by
     FROM property_portal_brand_contents
     WHERE organization_id = $1 AND property_id = $2 AND locale = $3`,
    [ORG_A, property, locale],
  )
  return rows[0]
}

async function overrideRowOf(portal: PortalId, locale = 'en') {
  const { rows } = await query(
    `SELECT title, short_description, hero_image_url, updated_by, organization_id
     FROM portal_localized_overrides WHERE portal_id = $1 AND locale = $2`,
    [portal, locale],
  )
  return rows[0]
}

const eventTypes = async (org: OrganizationId = ORG_A) =>
  (
    await query(
      'SELECT event_type FROM outbox_events WHERE organization_id = $1 ORDER BY event_type',
      [org],
    )
  ).rows.map((row) => row.event_type as string)

async function scene() {
  const property = await seedMediaProperty(getPool(), ORG_A)
  const otherProperty = await seedMediaProperty(getPool(), ORG_A)
  return { property, otherProperty }
}

const brandProfileInput = (
  property: PropertyId,
  overrides: Readonly<Record<string, unknown>> = {},
): Parameters<ReturnType<typeof savePropertyPortalBrandProfile>>[0] =>
  // The DTO types the two image fields as `null`, so a well-typed caller cannot
  // supply a URL. The cast reproduces a caller that got past the DTO: the
  // suppression has to hold on its own, not by grace of the type.
  ({
    propertyId: property,
    displayName: '  Seaside Retreat  ',
    primaryColor: '#6366f1',
    backgroundColor: '#ffffff',
    textColor: '#111827',
    logoUrl: 'https://cdn.example.com/logo.png',
    defaultHeroImageUrl: 'https://cdn.example.com/hero.png',
    ...overrides,
  }) as unknown as Parameters<ReturnType<typeof savePropertyPortalBrandProfile>>[0]

describe('getPropertyPortalExperience (real PostgreSQL)', () => {
  it('returns the Property experience with no overrides and no brand authority for a read-only manager', async () => {
    const { property } = await scene()
    const ctx = buildTestAuthContext({
      role: 'PropertyManager',
      organizationId: ORG_A,
      effectivePermissions: new Set(['portal.read']),
      scopeByPermission: new Map([['portal.read', 'organization']]),
    })

    const result = await getPropertyPortalExperience(depsOf([property]))(
      { propertyId: property },
      ctx,
    )

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

    const result = await getPropertyPortalExperience(depsOf())(
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
    const propertyOnly = await getPropertyPortalExperience(depsOf([property]))(
      { propertyId: property },
      ctx,
    )
    const withPortal = await getPropertyPortalExperience(depsOf([property]))(
      { propertyId: property, portalId: portal },
      ctx,
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
    const read = () =>
      getPropertyPortalExperience(depsOf())({ propertyId: property }, ctx)

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

    const result = await getPropertyPortalExperience(depsOf())(
      { propertyId: property },
      adminOf(),
    )

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

    const result = await getPropertyPortalExperience(depsOf())(
      { propertyId: property },
      adminOf(ORG_B),
    )

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

      const view = await getPropertyPortalExperience(depsOf())(
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

      const named = await getPropertyPortalExperience(depsOf())(
        { propertyId: property, portalId: portal },
        adminOf(),
      )
      const propertyOnly = await getPropertyPortalExperience(depsOf())(
        { propertyId: property },
        adminOf(),
      )

      expect(named.siblingPortalCount).toBe(2)
      expect(propertyOnly.siblingPortalCount).toBe(2)
    })

    it('reads the Portal’s own look with the images it names resolved like the Property’s', async () => {
      const { property, portal, ownHero, ownLogo } = await lookScene()
      await insertOverride(ORG_A, property, portal, ownLook(ownHero.id, ownLogo.id))

      const result = await getPropertyPortalExperience(depsOf())(
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

      const result = await getPropertyPortalExperience(depsOf())(
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

      const result = await getPropertyPortalExperience(depsOf([property]))(
        { propertyId: property, portalId: portal },
        managerOf(),
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
    await expect(
      getPropertyPortalExperience(depsOf())(
        { propertyId: property, portalId: portal },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('portal_not_found'))
  })

  it('does not find a Portal of another Organization', async () => {
    const { property } = await scene()
    const tenantB = await seedMediaProperty(getPool(), ORG_B)
    const foreign = await seedMediaPortal(getPool(), ORG_B, tenantB)

    await expect(
      getPropertyPortalExperience(depsOf())(
        { propertyId: property, portalId: foreign },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('portal_not_found'))
  })

  it('refuses a reader whose assignment excludes the Property', async () => {
    const { property } = await scene()

    await expect(
      getPropertyPortalExperience(depsOf([]))({ propertyId: property }, managerOf()),
    ).rejects.toSatisfy(failsWith('forbidden'))
  })

  it('refuses a caller without portal.read', async () => {
    const { property } = await scene()

    await expect(
      getPropertyPortalExperience(depsOf())(
        { propertyId: property },
        withoutPermissions(),
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
  })
})

describe('savePropertyPortalBrandProfile (real PostgreSQL)', () => {
  it('refuses a PropertyManager: Property-wide branding needs portal.admin', async () => {
    const { property } = await scene()

    await expect(
      savePropertyPortalBrandProfile(depsOf())(brandProfileInput(property), managerOf()),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(await profileRow(property)).toBeUndefined()
  })

  it('persists a trimmed name and upper-cased colours, and never a caller-supplied image URL', async () => {
    const { property } = await scene()
    const ctx = adminOf()

    const saved = await savePropertyPortalBrandProfile(depsOf())(
      brandProfileInput(property),
      ctx,
    )

    expect(saved.logoUrl).toBeNull()
    expect(saved.defaultHeroImageUrl).toBeNull()
    expect(await profileRow(property)).toMatchObject({
      display_name: 'Seaside Retreat',
      logo_url: null,
      default_hero_image_url: null,
      primary_color: '#6366F1',
      background_color: '#FFFFFF',
      text_color: '#111827',
      updated_by: ctx.userId,
    })
    expect(await eventTypes()).toContain('portal.property_brand_profile.updated')
  })

  it('does not reach another Organization’s Property', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    await savePropertyPortalBrandProfile(depsOf())(
      brandProfileInput(property, { displayName: 'Intruder' }),
      adminOf(ORG_B),
    ).catch(() => undefined)

    expect((await profileRow(property)).display_name).toBe('Avela Resort')
  })

  it('refuses text colour below the 4.5 contrast floor', async () => {
    const { property } = await scene()

    // #999999 on #FFFFFF is roughly 2.8:1: legible enough to look fine in a
    // colour picker and far below what a guest on a phone outdoors can read.
    await expect(
      savePropertyPortalBrandProfile(depsOf())(
        brandProfileInput(property, { textColor: '#999999' }),
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(await profileRow(property)).toBeUndefined()
  })

  it('refuses a colour that is not a six-digit hex', async () => {
    const { property } = await scene()

    await expect(
      savePropertyPortalBrandProfile(depsOf())(
        brandProfileInput(property, { primaryColor: 'rebeccapurple' }),
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    await expect(
      savePropertyPortalBrandProfile(depsOf())(
        brandProfileInput(property, { textColor: '#111' }),
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(await profileRow(property)).toBeUndefined()
  })

  it('passes a trimmed wordmark and the background mode through, and keeps them when the caller leaves them out', async () => {
    const { property } = await scene()
    const save = savePropertyPortalBrandProfile(depsOf())

    await save(
      brandProfileInput(property, { wordmark: '  HARBOUR  ', backgroundMode: 'manual' }),
      adminOf(),
    )
    expect(await profileRow(property)).toMatchObject({
      wordmark: 'HARBOUR',
      background_mode: 'manual',
    })

    await save(brandProfileInput(property), adminOf())
    expect(await profileRow(property)).toMatchObject({
      wordmark: 'HARBOUR',
      background_mode: 'manual',
    })
  })

  it('clears the wordmark when given null or only spaces', async () => {
    const { property } = await scene()
    const save = savePropertyPortalBrandProfile(depsOf())
    await save(brandProfileInput(property, { wordmark: 'HARBOUR' }), adminOf())

    await save(brandProfileInput(property, { wordmark: null }), adminOf())
    expect((await profileRow(property)).wordmark).toBeNull()

    await save(brandProfileInput(property, { wordmark: 'HARBOUR' }), adminOf())
    await save(brandProfileInput(property, { wordmark: '   ' }), adminOf())
    expect((await profileRow(property)).wordmark).toBeNull()
  })

  it('refuses a wordmark over 24 characters and an unknown background mode before anything persists', async () => {
    const { property } = await scene()
    const save = savePropertyPortalBrandProfile(depsOf())

    await expect(
      save(brandProfileInput(property, { wordmark: 'x'.repeat(25) }), adminOf()),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    await expect(
      save(brandProfileInput(property, { backgroundMode: 'dark' }), adminOf()),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(await profileRow(property)).toBeUndefined()
  })

  it('refuses a blank or over-long display name', async () => {
    const { property } = await scene()
    const save = savePropertyPortalBrandProfile(depsOf())

    await expect(
      save(brandProfileInput(property, { displayName: '   ' }), adminOf()),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    await expect(
      save(brandProfileInput(property, { displayName: 'x'.repeat(121) }), adminOf()),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    expect(await profileRow(property)).toBeUndefined()
  })
})

describe('savePropertyPublicDisplayName (real PostgreSQL)', () => {
  it('refuses a PropertyManager: the public display name is Property-wide branding', async () => {
    const { property } = await scene()

    await expect(
      savePropertyPublicDisplayName(depsOf())(
        { propertyId: property, displayName: 'Seaside Retreat' },
        managerOf(),
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(await profileRow(property)).toBeUndefined()
  })

  it('saves the trimmed name alone, as the signed-in person', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const ctx = adminOf()

    await savePropertyPublicDisplayName(depsOf())(
      { propertyId: property, displayName: '  Seaside Retreat  ' },
      ctx,
    )

    expect(await profileRow(property)).toMatchObject({
      display_name: 'Seaside Retreat',
      primary_color: '#B8860B',
      background_color: '#1A1A1A',
      updated_by: ctx.userId,
    })
  })

  it('starts a Property with no look from the name alone', async () => {
    const { property } = await scene()
    const ctx = adminOf()

    await savePropertyPublicDisplayName(depsOf())(
      { propertyId: property, displayName: 'Seaside Retreat' },
      ctx,
    )

    expect(await profileRow(property)).toMatchObject({
      display_name: 'Seaside Retreat',
      updated_by: ctx.userId,
    })
  })

  it('refuses a blank or over-long display name', async () => {
    const { property } = await scene()
    const save = savePropertyPublicDisplayName(depsOf())

    await expect(
      save({ propertyId: property, displayName: '  ' }, adminOf()),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    await expect(
      save({ propertyId: property, displayName: 'x'.repeat(121) }, adminOf()),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    expect(await profileRow(property)).toBeUndefined()
  })
})

describe('ensureDefaultPublicDisplayName (real PostgreSQL)', () => {
  it('starts the public display name as the trimmed Property name, and never replaces one', async () => {
    const { property } = await scene()
    const ensure = (displayName: string) =>
      ensureDefaultPublicDisplayName(depsOf())({
        organizationId: ORG_A,
        propertyId: property,
        displayName,
      })

    await expect(ensure('  KODES agency ')).resolves.toBe(true)
    expect(await profileRow(property)).toMatchObject({
      display_name: 'KODES agency',
      updated_by: AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR,
    })

    await expect(ensure('Another name')).resolves.toBe(false)
    expect((await profileRow(property)).display_name).toBe('KODES agency')
  })

  it('sets nothing for a name the public display name cannot hold', async () => {
    const { property } = await scene()

    for (const displayName of ['   ', 'x'.repeat(121)]) {
      await expect(
        ensureDefaultPublicDisplayName(depsOf())({
          organizationId: ORG_A,
          propertyId: property,
          displayName,
        }),
      ).resolves.toBe(false)
    }
    expect(await profileRow(property)).toBeUndefined()
  })
})

describe('savePropertyDefaultGuestLocales (real PostgreSQL)', () => {
  it('refuses a PropertyManager: default languages are Property-wide branding', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    await expect(
      savePropertyDefaultGuestLocales(depsOf())(
        { propertyId: property, locales: ['bg'] },
        managerOf(),
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect((await profileRow(property)).default_guest_locales).toEqual(['en'])
  })

  it('saves the ordered set for the signed-in organisation and returns the profile', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    const saved = await savePropertyDefaultGuestLocales(depsOf())(
      { propertyId: property, locales: ['bg', 'en'] },
      adminOf(),
    )

    expect(saved.defaultGuestLocales).toEqual(['bg', 'en'])
    expect((await profileRow(property)).default_guest_locales).toEqual(['bg', 'en'])
  })

  it('refuses an empty set and a repeated language before anything persists', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const save = savePropertyDefaultGuestLocales(depsOf())

    await expect(
      save({ propertyId: property, locales: [] }, adminOf()),
    ).rejects.toSatisfy(failsWith('locale_not_offered'))
    await expect(
      save({ propertyId: property, locales: ['en', 'en'] }, adminOf()),
    ).rejects.toSatisfy(failsWith('locale_not_offered'))
    expect((await profileRow(property)).default_guest_locales).toEqual(['en'])
  })

  it('says so when the Property has no Brand Profile to hold them', async () => {
    const { property } = await scene()

    await expect(
      savePropertyDefaultGuestLocales(depsOf())(
        { propertyId: property, locales: ['en'] },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('brand_profile_missing'))
  })

  it('does not reach another Organization’s profile', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    await expect(
      savePropertyDefaultGuestLocales(depsOf())(
        { propertyId: property, locales: ['bg'] },
        adminOf(ORG_B),
      ),
    ).rejects.toSatisfy(failsWith('brand_profile_missing'))
    expect((await profileRow(property)).default_guest_locales).toEqual(['en'])
  })
})

describe('savePropertyPortalBrandContent (real PostgreSQL)', () => {
  const contentOf = (property: PropertyId) => ({
    propertyId: property,
    locale: 'bg' as const,
    title: '  Морски бряг  ',
    shortDescription: '  Кажете ни как мина престоят ви.  ',
  })

  it('refuses a PropertyManager: Property-wide guest copy needs portal.admin', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    await expect(
      savePropertyPortalBrandContent(depsOf())(contentOf(property), managerOf()),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(await contentRow(property, 'bg')).toBeUndefined()
  })

  it('persists trimmed guest copy under the requested locale', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const ctx = adminOf()

    await savePropertyPortalBrandContent(depsOf())(contentOf(property), ctx)

    expect(await contentRow(property, 'bg')).toMatchObject({
      title: 'Морски бряг',
      short_description: 'Кажете ни как мина престоят ви.',
      updated_by: ctx.userId,
    })
    expect(await contentRow(property, 'en')).toBeUndefined()
    expect(await eventTypes()).toContain('portal.property_brand_content.updated')
  })

  it('keeps a trimmed hero alt text, clears it with null or spaces, and keeps it when left out', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const save = savePropertyPortalBrandContent(depsOf())
    const content = contentOf(property)

    await save({ ...content, heroAltText: '  Лодки в пристанището  ' }, adminOf())
    expect((await contentRow(property, 'bg')).hero_alt_text).toBe('Лодки в пристанището')

    await save(content, adminOf())
    expect((await contentRow(property, 'bg')).hero_alt_text).toBe('Лодки в пристанището')

    await save({ ...content, heroAltText: null }, adminOf())
    expect((await contentRow(property, 'bg')).hero_alt_text).toBeNull()

    await save({ ...content, heroAltText: '  Лодки  ' }, adminOf())
    await save({ ...content, heroAltText: '  ' }, adminOf())
    expect((await contentRow(property, 'bg')).hero_alt_text).toBeNull()
  })

  it('refuses a hero alt text over 160 characters', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    await expect(
      savePropertyPortalBrandContent(depsOf())(
        { ...contentOf(property), heroAltText: 'x'.repeat(161) },
        adminOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    expect(await contentRow(property, 'bg')).toBeUndefined()
  })

  it('refuses a title over 120 or a description over 500 characters', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const save = savePropertyPortalBrandContent(depsOf())

    await expect(
      save({ ...contentOf(property), title: 'x'.repeat(121) }, adminOf()),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    await expect(
      save({ ...contentOf(property), shortDescription: 'x'.repeat(501) }, adminOf()),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    expect(await contentRow(property, 'bg')).toBeUndefined()
  })

  it('accepts a title of exactly 120 and a description of exactly 500 characters', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    // Pinning the accepting side too keeps the threshold from being "fixed" by
    // tightening it: 120 and 500 are the boundaries, not merely upper bounds.
    await savePropertyPortalBrandContent(depsOf())(
      {
        ...contentOf(property),
        title: 'x'.repeat(120),
        shortDescription: 'y'.repeat(500),
      },
      adminOf(),
    )

    expect(await contentRow(property, 'bg')).toMatchObject({
      title: 'x'.repeat(120),
      short_description: 'y'.repeat(500),
    })
  })
})

describe('savePortalLocalizedOverride (real PostgreSQL)', () => {
  const withHeroImageUrl = (
    input: Parameters<ReturnType<typeof savePortalLocalizedOverride>>[0],
    heroImageUrl: string,
  ): Parameters<ReturnType<typeof savePortalLocalizedOverride>>[0] =>
    // A caller that got past the DTO carrying a hero image URL.
    ({ ...input, heroImageUrl }) as unknown as Parameters<
      ReturnType<typeof savePortalLocalizedOverride>
    >[0]

  async function overrideScene(state: 'draft' | 'archived' = 'draft') {
    const { property } = await scene()
    const portal = await seedMediaPortal(getPool(), ORG_A, property, { state })
    return { property, portal }
  }

  it('normalizes non-null override copy and drops a caller-supplied hero image URL', async () => {
    const { portal } = await overrideScene()
    const ctx = managerOf()

    await savePortalLocalizedOverride(depsOf())(
      withHeroImageUrl(
        {
          portalId: portal,
          locale: 'en',
          title: '  Rooftop Bar  ',
          shortDescription: '  Tell us about tonight.  ',
        },
        'https://cdn.example.com/hero.png',
      ),
      ctx,
    )

    expect(await overrideRowOf(portal)).toMatchObject({
      title: 'Rooftop Bar',
      short_description: 'Tell us about tonight.',
      hero_image_url: null,
      updated_by: ctx.userId,
      organization_id: ORG_A,
    })
    expect(await eventTypes()).toContain('portal.localized_override.updated')
  })

  it('carries an explicit null through as a cleared override rather than rejecting it', async () => {
    const { portal } = await overrideScene()
    const save = savePortalLocalizedOverride(depsOf())
    const clear = () =>
      save(
        { portalId: portal, locale: 'en', title: null, shortDescription: null },
        managerOf(),
      )
    await save(
      {
        portalId: portal,
        locale: 'en',
        title: 'Rooftop Bar',
        shortDescription: 'Tonight',
      },
      managerOf(),
    )

    await clear()

    // A cleared override holds nothing, so there is no row: the Property's copy shows.
    expect(await overrideRowOf(portal)).toBeUndefined()

    // A row that still carries the Linktree title is kept, with the copy cleared.
    await save(
      { portalId: portal, locale: 'en', title: 'Rooftop Bar', shortDescription: null },
      managerOf(),
    )
    await query(
      `UPDATE portal_localized_overrides SET linktree_title = 'Around us' WHERE portal_id = $1`,
      [portal],
    )
    await clear()
    expect(await overrideRowOf(portal)).toMatchObject({
      title: null,
      short_description: null,
      hero_image_url: null,
    })
  })

  it('refuses to change content on an archived Portal', async () => {
    const { portal } = await overrideScene('archived')

    await expect(
      savePortalLocalizedOverride(depsOf())(
        { portalId: portal, locale: 'en', title: 'Rooftop Bar', shortDescription: null },
        managerOf(),
      ),
    ).rejects.toSatisfy(failsWith('portal_inactive'))
    expect(await overrideRowOf(portal)).toBeUndefined()
  })

  it('refuses a Member: per-Portal guest content needs portal.update', async () => {
    const { portal } = await overrideScene()

    await expect(
      savePortalLocalizedOverride(depsOf())(
        { portalId: portal, locale: 'en', title: 'Rooftop Bar', shortDescription: null },
        buildTestAuthContext({ role: 'Member', organizationId: ORG_A }),
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(await overrideRowOf(portal)).toBeUndefined()
  })

  it('does not find a Portal of another Organization, and writes nothing for it', async () => {
    const { portal } = await overrideScene()

    await expect(
      savePortalLocalizedOverride(depsOf())(
        { portalId: portal, locale: 'en', title: 'Rooftop Bar', shortDescription: null },
        managerOf(ORG_B),
      ),
    ).rejects.toSatisfy(failsWith('portal_not_found'))
    expect(await overrideRowOf(portal)).toBeUndefined()
    expect(await eventTypes(ORG_B)).toEqual([])
  })

  it('refuses an override title over 120 or an override description over 500 characters', async () => {
    const { portal } = await overrideScene()
    const save = savePortalLocalizedOverride(depsOf())

    await expect(
      save(
        {
          portalId: portal,
          locale: 'en',
          title: 'x'.repeat(121),
          shortDescription: null,
        },
        managerOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    await expect(
      save(
        {
          portalId: portal,
          locale: 'en',
          title: null,
          shortDescription: 'x'.repeat(501),
        },
        managerOf(),
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    expect(await overrideRowOf(portal)).toBeUndefined()
  })

  it('accepts an override title of exactly 120 and a description of exactly 500 characters', async () => {
    const { portal } = await overrideScene()

    await savePortalLocalizedOverride(depsOf())(
      {
        portalId: portal,
        locale: 'en',
        title: 'x'.repeat(120),
        shortDescription: 'y'.repeat(500),
      },
      managerOf(),
    )

    expect(await overrideRowOf(portal)).toMatchObject({
      title: 'x'.repeat(120),
      short_description: 'y'.repeat(500),
      hero_image_url: null,
    })
  })
})
