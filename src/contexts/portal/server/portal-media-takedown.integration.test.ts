// Portal media takedown, called as signed-in members over PostgreSQL with the
// real tenant resolution, execution policy, media repository and an in-memory
// object store.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { portalMediaObjectKey } from '#/shared/domain/portal-media'
import {
  createInMemoryStorage,
  setupServerFunctionHarness,
  type TestProperty,
} from '#/shared/testing/server-function-harness'
import { seedMediaAsset } from '../infrastructure/testing/portal-media-experience-seed'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { takeDownPortalMedia } from './portal-media-takedown'

const storage = createInMemoryStorage()
const harness = setupServerFunctionHarness({
  providers: { storage },
  cleanupTables: ['portal_media_assets'],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property }
}

async function storedImage(property: TestProperty) {
  const asset = await seedMediaAsset(
    organizationId(property.organizationId),
    propertyId(property.id),
  )
  await storage.putObject(
    portalMediaObjectKey(asset.id),
    Buffer.from('image'),
    'image/webp',
  )
  return asset
}

async function row(assetId: string) {
  const { rows } = await harness
    .pool()
    .query(`SELECT status, object_deleted_at FROM portal_media_assets WHERE id = $1`, [
      assetId,
    ])
  return rows[0] as { status: string; object_deleted_at: Date | null }
}

const keys = async () => (await storage.listObjects('', 1000)).objects.map((o) => o.key)

afterEach(resetCapabilityPolicyStore)

const switchOff = (capability: string) =>
  initCapabilityPolicyStore({
    isCapabilityKilled: (cap) => cap === capability,
    isOrgSuspended: () => false,
  })

describe('takeDownPortalMedia', () => {
  it('takes an image down for an AccountAdmin and removes its object', async () => {
    const { admin, property } = await hotel()
    const asset = await storedImage(property)

    const result = await harness.callAs(admin, () =>
      takeDownPortalMedia({ data: { assetId: asset.id } }),
    )

    expect(result).toEqual({ assetId: asset.id, objectRemoved: true })
    expect(await row(asset.id)).toMatchObject({ status: 'taken_down' })
    expect((await row(asset.id)).object_deleted_at).not.toBeNull()
    expect(await keys()).not.toContain(asset.objectKey)
  })

  it('answers a second takedown of the same image the same way', async () => {
    const { admin, property } = await hotel()
    const asset = await storedImage(property)
    await harness.callAs(admin, () =>
      takeDownPortalMedia({ data: { assetId: asset.id } }),
    )

    const again = await harness.callAs(admin, () =>
      takeDownPortalMedia({ data: { assetId: asset.id } }),
    )

    expect(again).toEqual({ assetId: asset.id, objectRemoved: true })
  })

  it('refuses a PropertyManager even with a grant, and leaves the image alone', async () => {
    const { manager, property } = await hotel()
    const asset = await storedImage(property)

    await expect(
      harness.callAs(manager, () => takeDownPortalMedia({ data: { assetId: asset.id } })),
    ).rejects.toMatchObject({ name: 'AuthError', status: 403 })

    expect((await row(asset.id)).status).toBe('active')
    expect(await keys()).toContain(asset.objectKey)
  })

  it('refuses a Member', async () => {
    const { organization, property } = await hotel()
    const member = await harness.seedMember(organization, 'Member')
    const asset = await storedImage(property)

    await expect(
      harness.callAs(member, () => takeDownPortalMedia({ data: { assetId: asset.id } })),
    ).rejects.toMatchObject({ status: 403 })

    expect((await row(asset.id)).status).toBe('active')
  })

  it('does not find an image of another Organization', async () => {
    const { property } = await hotel()
    const asset = await storedImage(property)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        takeDownPortalMedia({ data: { assetId: asset.id } }),
      ),
    ).rejects.toMatchObject({ code: 'media_not_found', status: 404 })

    expect((await row(asset.id)).status).toBe('active')
  })

  it('refuses an image id that is not a UUID', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () => takeDownPortalMedia({ data: { assetId: 'nope' } })),
    ).rejects.toThrow(/assetId/)
  })

  it('still takes an image down when uploads are switched off', async () => {
    const { admin, property } = await hotel()
    const asset = await storedImage(property)
    switchOff('portal.upload')

    const result = await harness.callAs(admin, () =>
      takeDownPortalMedia({ data: { assetId: asset.id } }),
    )

    expect(result).toEqual({ assetId: asset.id, objectRemoved: true })
    expect(await keys()).not.toContain(asset.objectKey)
  })

  it('leaves the image alone when Portal writes are switched off', async () => {
    const { admin, property } = await hotel()
    const asset = await storedImage(property)
    switchOff('portal.write')

    await expect(
      harness.callAs(admin, () => takeDownPortalMedia({ data: { assetId: asset.id } })),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect((await row(asset.id)).status).toBe('active')
    expect(await keys()).toContain(asset.objectKey)
  })
})
