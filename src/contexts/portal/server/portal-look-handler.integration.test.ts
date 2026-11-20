// A Portal's own look server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution and execution policy. What each
// save and each refusal leaves is asserted on the stored look and on the
// edits recorded against a live Portal.

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import {
  seedBrandProfile,
  seedMediaAsset,
  seedMediaPortal,
} from '../infrastructure/testing/portal-media-experience-seed'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  savePortalLookColours,
  savePortalLookIdentity,
  savePortalLookPhoto,
} from './portal-look'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_look_overrides',
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_categories',
    'portal_media_assets',
  ],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const org = organizationId(organization.id)
  const prop = propertyId(property.id)
  const portalId = await seedMediaPortal(harness.pool(), org, prop, {
    state: 'published',
    published: true,
    additionalLocales: ['bg'],
  })
  await seedBrandProfile(harness.pool(), org, prop, { wordmark: 'AVELA', lookVersion: 4 })
  const hero = await seedMediaAsset(org, prop, { purpose: 'hero' })
  return {
    organization,
    admin,
    manager,
    property,
    portalId,
    hero,
    target: { propertyId: property.id, portalId },
  }
}

const overrideRow = async (organization: string, portal: string) =>
  (
    await harness.pool().query(
      `SELECT photo_mode, hero_asset_id::text AS hero_asset_id, colours_mode,
              primary_color, identity_mode, wordmark
         FROM portal_look_overrides WHERE organization_id = $1 AND portal_id = $2`,
      [organization, portal],
    )
  ).rows[0]

const pageEditCount = async (organization: string, portal: string) =>
  Number(
    (
      await harness
        .pool()
        .query(
          `SELECT count(*) FROM portal_page_edits WHERE organization_id = $1 AND portal_id = $2`,
          [organization, portal],
        )
    ).rows[0].count,
  )

const colours = { mode: 'own' as const, accentColour: '#2f855a' }

afterEach(resetCapabilityPolicyStore)

const switchOff = (capability: string) =>
  initCapabilityPolicyStore({
    isCapabilityKilled: (cap) => cap === capability,
    isOrgSuspended: () => false,
  })

describe('a Portal’s own look server functions', () => {
  it('saves the colours for an AccountAdmin and records the edit on the live Portal', async () => {
    const { organization, admin, portalId, target } = await hotel()

    await harness.callAs(admin, () =>
      savePortalLookColours({ data: { ...target, colours } }),
    )

    expect(await overrideRow(organization.id, portalId)).toMatchObject({
      colours_mode: 'own',
      primary_color: '#2F855A',
    })
    expect(await pageEditCount(organization.id, portalId)).toBeGreaterThan(0)
  })

  it('saves the name and logo', async () => {
    const { organization, admin, portalId, target } = await hotel()

    await harness.callAs(admin, () =>
      savePortalLookIdentity({
        data: { ...target, identity: { mode: 'own', wordmark: 'Harbour' } },
      }),
    )

    expect(await overrideRow(organization.id, portalId)).toMatchObject({
      identity_mode: 'own',
      wordmark: 'Harbour',
    })
  })

  it('points the Portal at a stored photograph', async () => {
    const { organization, admin, portalId, hero, target } = await hotel()

    await harness.callAs(admin, () =>
      savePortalLookPhoto({
        data: {
          ...target,
          photo: {
            mode: 'own',
            heroAssetId: hero.id,
            focalX: 0.5,
            focalY: 0.4,
            altTexts: [{ locale: 'en', text: 'Treatment room' }],
          },
        },
      }),
    )

    expect(await overrideRow(organization.id, portalId)).toMatchObject({
      photo_mode: 'own',
      hero_asset_id: hero.id,
    })
  })

  it('carries a Portal that is not in the Property out as a tagged error and stores nothing', async () => {
    const { organization, admin, portalId, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        savePortalLookPhoto({
          data: {
            propertyId: property.id,
            portalId: randomUUID(),
            photo: { mode: 'none' },
          },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'portal_not_found',
      status: 404,
    })

    expect(await overrideRow(organization.id, portalId)).toBeUndefined()
  })

  it.each(['colours', 'identity', 'photo'] as const)(
    'refuses the %s save when Portal writes are switched off and stores nothing',
    async (which) => {
      const { organization, admin, portalId, target } = await hotel()
      const saves = {
        colours: () => savePortalLookColours({ data: { ...target, colours } }),
        identity: () =>
          savePortalLookIdentity({
            data: { ...target, identity: { mode: 'own', wordmark: 'Harbour' } },
          }),
        photo: () =>
          savePortalLookPhoto({ data: { ...target, photo: { mode: 'none' } } }),
      }
      switchOff('portal.write')

      await expect(harness.callAs(admin, saves[which])).rejects.toMatchObject({
        name: 'AuthError',
        code: 'capability_disabled',
        status: 403,
      })

      expect(await overrideRow(organization.id, portalId)).toBeUndefined()
    },
  )

  it('refuses a PropertyManager without a grant and stores nothing', async () => {
    const { organization, portalId, target } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        savePortalLookColours({ data: { ...target, colours } }),
      ),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'scope_denied', status: 403 })

    expect(await overrideRow(organization.id, portalId)).toBeUndefined()
  })

  it('refuses a granted PropertyManager: a Portal’s look is an AccountAdmin’s to change', async () => {
    const { organization, manager, portalId, target } = await hotel()

    await expect(
      harness.callAs(manager, () =>
        savePortalLookColours({ data: { ...target, colours } }),
      ),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'forbidden', status: 403 })

    expect(await overrideRow(organization.id, portalId)).toBeUndefined()
  })

  it('refuses a Member and stores nothing', async () => {
    const { organization, portalId, target } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        savePortalLookIdentity({
          data: { ...target, identity: { mode: 'own', wordmark: 'Harbour' } },
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'AuthError', status: 403 })

    expect(await overrideRow(organization.id, portalId)).toBeUndefined()
  })

  it('stores nothing for another Organization’s AccountAdmin', async () => {
    const { organization, portalId, target } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        savePortalLookColours({ data: { ...target, colours } }),
      ),
    ).rejects.toMatchObject({ status: expect.any(Number) })

    expect(await overrideRow(organization.id, portalId)).toBeUndefined()
  })
})
