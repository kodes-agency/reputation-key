// Property look server functions, called as signed-in members over PostgreSQL
// with the real tenant resolution and execution policy. Each save and each
// refusal is asserted on the stored Brand Profile.

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import type { TestProperty } from '#/shared/testing/server-function-harness'
import {
  seedBrandProfile,
  seedMediaAsset,
} from '../infrastructure/testing/portal-media-experience-seed'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  savePropertyDefaultGuestLocales,
  savePropertyHero,
  savePropertyLogo,
  savePropertyLook,
} from './property-look'

afterEach(resetCapabilityPolicyStore)

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_snapshots',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_media_assets',
  ],
})

async function hotel(options: { brandProfile?: boolean } = {}) {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  if (options.brandProfile !== false) {
    await seedBrandProfile(
      harness.pool(),
      organizationId(organization.id),
      propertyId(property.id),
      { lookVersion: 3 },
    )
  }
  return { organization, admin, manager, member, property }
}

async function profileRow(property: TestProperty) {
  const { rows } = await harness.pool().query(
    `SELECT primary_color, background_color, background_mode, wordmark, look_version,
            default_guest_locales, hero_asset_id::text AS hero_asset_id,
            hero_focal_x, hero_focal_y, logo_asset_id::text AS logo_asset_id
       FROM property_portal_brand_profiles
      WHERE organization_id = $1 AND property_id = $2`,
    [property.organizationId, property.id],
  )
  return rows[0]
}

const lookInput = (property: TestProperty) => ({
  propertyId: property.id,
  accentColour: '#ead6a8',
  backgroundMode: 'auto' as const,
})

describe('savePropertyLook', () => {
  it('stores the look for an AccountAdmin and bumps the look version', async () => {
    const { admin, property } = await hotel()

    await harness.callAs(admin, () => savePropertyLook({ data: lookInput(property) }))

    expect(await profileRow(property)).toMatchObject({
      primary_color: '#EAD6A8',
      look_version: 4,
    })
  })

  it('carries a refused look out as a tagged Portal error and stores nothing', async () => {
    const { admin, property } = await hotel()
    const before = await profileRow(property)

    await expect(
      harness.callAs(admin, () =>
        savePropertyLook({
          data: {
            propertyId: property.id,
            accentColour: '#EAD6A8',
            backgroundMode: 'manual',
            backgroundColour: '#E8E8E8',
          },
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'invalid_theme' })

    expect(await profileRow(property)).toEqual(before)
  })

  it('refuses a PropertyManager without a grant and stores nothing', async () => {
    const { organization, property } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')
    const before = await profileRow(property)

    await expect(
      harness.callAs(outsider, () => savePropertyLook({ data: lookInput(property) })),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'scope_denied', status: 403 })

    expect(await profileRow(property)).toEqual(before)
  })

  it('refuses a granted PropertyManager: only an AccountAdmin changes the look', async () => {
    const { manager, property } = await hotel()
    const before = await profileRow(property)

    await expect(
      harness.callAs(manager, () => savePropertyLook({ data: lookInput(property) })),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'forbidden', status: 403 })

    expect(await profileRow(property)).toEqual(before)
  })

  it('refuses a Member and stores nothing', async () => {
    const { member, property } = await hotel()
    const before = await profileRow(property)

    await expect(
      harness.callAs(member, () => savePropertyLook({ data: lookInput(property) })),
    ).rejects.toMatchObject({
      _tag: 'AuthError',
      code: 'beta_role_inactive',
      status: 403,
    })

    expect(await profileRow(property)).toEqual(before)
  })

  it('does not change the Brand Profile of another Organization', async () => {
    const { property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')
    const before = await profileRow(property)

    await expect(
      harness.callAs(otherAdmin, () => savePropertyLook({ data: lookInput(property) })),
    ).rejects.toMatchObject({ code: 'brand_profile_missing', status: 409 })

    expect(await profileRow(property)).toEqual(before)
  })

  it('answers brand_profile_missing for a Property with no Brand Profile', async () => {
    const { admin, property } = await hotel({ brandProfile: false })

    await expect(
      harness.callAs(admin, () => savePropertyLook({ data: lookInput(property) })),
    ).rejects.toMatchObject({ code: 'brand_profile_missing', status: 409 })
  })
})

describe('savePropertyDefaultGuestLocales', () => {
  it('stores the default languages in the order given', async () => {
    const { admin, property } = await hotel()

    const saved = await harness.callAs(admin, () =>
      savePropertyDefaultGuestLocales({
        data: { propertyId: property.id, locales: ['bg', 'en'] },
      }),
    )

    expect((await profileRow(property)).default_guest_locales).toEqual(['bg', 'en'])
    expect(JSON.stringify(saved)).toContain('bg')
  })

  it('refuses a PropertyManager without a grant and stores nothing', async () => {
    const { organization, property } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')
    const before = await profileRow(property)

    await expect(
      harness.callAs(outsider, () =>
        savePropertyDefaultGuestLocales({
          data: { propertyId: property.id, locales: ['en'] },
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'scope_denied', status: 403 })

    expect(await profileRow(property)).toEqual(before)
  })

  it('refuses a granted PropertyManager: Property-wide branding is for an AccountAdmin', async () => {
    const { manager, property } = await hotel()
    const before = await profileRow(property)

    await expect(
      harness.callAs(manager, () =>
        savePropertyDefaultGuestLocales({
          data: { propertyId: property.id, locales: ['en'] },
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'forbidden', status: 403 })

    expect(await profileRow(property)).toEqual(before)
  })
})

describe('savePropertyHero', () => {
  it('stores an active hero image of the Property with its focal point and alt text', async () => {
    const { admin, property } = await hotel()
    const hero = await seedMediaAsset(
      organizationId(property.organizationId),
      propertyId(property.id),
      { purpose: 'hero' },
    )

    const saved = await harness.callAs(admin, () =>
      savePropertyHero({
        data: {
          propertyId: property.id,
          assetId: hero.id,
          focalX: 0.5,
          focalY: 0.42,
          altTexts: [{ locale: 'en', text: 'Evening on the sea terrace' }],
        },
      }),
    )

    expect(await profileRow(property)).toMatchObject({
      hero_asset_id: hero.id,
      hero_focal_x: 0.5,
      hero_focal_y: 0.42,
    })
    const { rows } = await harness.pool().query(
      `SELECT hero_alt_text FROM property_portal_brand_contents
        WHERE organization_id = $1 AND property_id = $2 AND locale = 'en'`,
      [property.organizationId, property.id],
    )
    expect(rows[0]?.hero_alt_text).toBe('Evening on the sea terrace')
    expect(JSON.stringify(saved)).toContain(hero.id)
  })

  it('still puts a photograph on the look when uploads are switched off', async () => {
    const { admin, property } = await hotel()
    const hero = await seedMediaAsset(
      organizationId(property.organizationId),
      propertyId(property.id),
      { purpose: 'hero' },
    )
    initCapabilityPolicyStore({
      isCapabilityKilled: (cap) => cap === 'portal.upload',
      isOrgSuspended: () => false,
    })

    await harness.callAs(admin, () =>
      savePropertyHero({
        data: {
          propertyId: property.id,
          assetId: hero.id,
          focalX: 0.5,
          focalY: 0.5,
          altTexts: [],
        },
      }),
    )

    expect((await profileRow(property)).hero_asset_id).toBe(hero.id)
  })

  it('answers media_not_found for an image that does not exist and stores nothing', async () => {
    const { admin, property } = await hotel()
    const before = await profileRow(property)

    await expect(
      harness.callAs(admin, () =>
        savePropertyHero({
          data: {
            propertyId: property.id,
            assetId: randomUUID(),
            focalX: 0.5,
            focalY: 0.5,
            altTexts: [],
          },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'media_not_found',
      status: 404,
    })

    expect(await profileRow(property)).toEqual(before)
  })
})

describe('savePropertyLogo', () => {
  it('answers media_not_found for an image that does not exist and stores nothing', async () => {
    const { admin, property } = await hotel()
    const before = await profileRow(property)

    await expect(
      harness.callAs(admin, () =>
        savePropertyLogo({ data: { propertyId: property.id, assetId: randomUUID() } }),
      ),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'media_not_found' })

    expect(await profileRow(property)).toEqual(before)
  })

  it('takes the logo off with null', async () => {
    const { admin, property } = await hotel()
    const logo = await seedMediaAsset(
      organizationId(property.organizationId),
      propertyId(property.id),
      { purpose: 'logo' },
    )
    await harness.callAs(admin, () =>
      savePropertyLogo({ data: { propertyId: property.id, assetId: logo.id } }),
    )
    expect((await profileRow(property)).logo_asset_id).toBe(logo.id)

    await harness.callAs(admin, () =>
      savePropertyLogo({ data: { propertyId: property.id, assetId: null } }),
    )

    expect((await profileRow(property)).logo_asset_id).toBeNull()
  })
})

describe('Property look saves with Portal writes switched off', () => {
  it.each(['look', 'locales', 'hero', 'logo'] as const)(
    'refuses the %s save and stores nothing',
    async (which) => {
      const { admin, property } = await hotel()
      const before = await profileRow(property)
      const saves: Record<typeof which, () => Promise<unknown>> = {
        look: () => savePropertyLook({ data: lookInput(property) }),
        locales: () =>
          savePropertyDefaultGuestLocales({
            data: { propertyId: property.id, locales: ['bg', 'en'] },
          }),
        hero: () =>
          savePropertyHero({
            data: {
              propertyId: property.id,
              assetId: randomUUID(),
              focalX: 0.5,
              focalY: 0.5,
              altTexts: [],
            },
          }),
        logo: () =>
          savePropertyLogo({ data: { propertyId: property.id, assetId: randomUUID() } }),
      }
      initCapabilityPolicyStore({
        isCapabilityKilled: (cap) => cap === 'portal.write',
        isOrgSuspended: () => false,
      })

      await expect(harness.callAs(admin, saves[which])).rejects.toMatchObject({
        _tag: 'AuthError',
        code: 'capability_disabled',
        status: 403,
      })

      expect(await profileRow(property)).toEqual(before)
    },
  )
})
