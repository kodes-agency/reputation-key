// Portal media upload endpoint as the running app wires it, called as signed-in
// members over PostgreSQL with the real tenant resolution, execution policy,
// image ingest and an in-memory object store.

import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { getEnv } from '#/shared/config/env'
import {
  createInMemoryStorage,
  setupServerFunctionHarness,
  type TestMember,
  type TestPortal,
  type TestProperty,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { handlePortalMediaUpload } from './portal-media-upload'

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
  const portal = await harness.seedPortal(property)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property, portal }
}

const photo = () =>
  sharp({
    create: {
      width: 3200,
      height: 2000,
      channels: 3,
      background: { r: 30, g: 90, b: 160 },
    },
  })
    .jpeg()
    .toBuffer()

async function upload(
  member: TestMember | null,
  property: TestProperty,
  purpose: string,
  portal?: TestPortal,
): Promise<Response> {
  const { BETTER_AUTH_URL } = getEnv()
  const query = new URLSearchParams({
    propertyId: property.id,
    purpose,
    rightsConfirmed: 'true',
    ...(portal ? { portalId: portal.id } : {}),
  })
  const headers = new Headers({
    'content-type': 'image/jpeg',
    'sec-fetch-site': 'same-origin',
  })
  if (member) headers.set('cookie', member.cookie)
  const request = new Request(`${BETTER_AUTH_URL}/api/portal-media?${query}`, {
    method: 'POST',
    headers,
    body: new Uint8Array(await photo()),
  })
  return harness.callAs(member, () => handlePortalMediaUpload(request))
}

const assetCount = async () =>
  Number(
    (await harness.pool().query(`SELECT count(*) FROM portal_media_assets`)).rows[0]
      .count,
  )

afterEach(() => {
  vi.restoreAllMocks()
  resetCapabilityPolicyStore()
})

const switchOff = (capability: string) =>
  initCapabilityPolicyStore({
    isCapabilityKilled: (cap) => cap === capability,
    isOrgSuspended: () => false,
  })

describe('handlePortalMediaUpload', () => {
  it.each(['hero', 'logo'])(
    'stores a %s uploaded by an AccountAdmin',
    async (purpose) => {
      const { admin, property } = await hotel()
      const before = (await storage.listObjects('', 1000)).objects.length

      const response = await upload(admin, property, purpose)

      expect(response.status).toBe(201)
      const { asset } = await response.json()
      expect(asset).toMatchObject({ purpose })
      expect((await storage.listObjects('', 1000)).objects).toHaveLength(before + 1)
      expect(await assetCount()).toBeGreaterThanOrEqual(1)
    },
  )

  it('lets a granted PropertyManager upload a link image', async () => {
    const { manager, property, portal } = await hotel()

    const response = await upload(manager, property, 'link_image', portal)

    expect(response.status).toBe(201)
    expect((await response.json()).asset).toMatchObject({ purpose: 'link_image' })
  })

  it.each(['hero', 'logo'])(
    'refuses a %s from a granted PropertyManager and stores nothing',
    async (purpose) => {
      const { manager, property } = await hotel()
      const before = (await storage.listObjects('', 1000)).objects.length

      const response = await upload(manager, property, purpose)

      expect(response.status).toBe(403)
      expect((await storage.listObjects('', 1000)).objects).toHaveLength(before)
      expect(await assetCount()).toBe(0)
    },
  )

  it('refuses a PropertyManager without a grant on the Property', async () => {
    const { organization, property, portal } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    const response = await upload(outsider, property, 'link_image', portal)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'scope_denied' })
    expect(await assetCount()).toBe(0)
  })

  it('refuses a Member', async () => {
    const { organization, property } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    const response = await upload(member, property, 'hero')

    expect(response.status).toBe(403)
    expect(await assetCount()).toBe(0)
  })

  it('refuses a visitor with no session', async () => {
    const { property } = await hotel()

    const response = await upload(null, property, 'hero')

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(await assetCount()).toBe(0)
  })

  it('does not find a Property of another Organization', async () => {
    const { property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    const response = await upload(otherAdmin, property, 'hero')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'property_not_found' })
    expect(await assetCount()).toBe(0)
  })

  it.each(['hero', 'logo', 'link_image'])(
    'stops a %s before the rate allowance when uploads are switched off',
    async (purpose) => {
      const { admin, property, portal } = await hotel()
      const check = vi.spyOn(harness.container().rateLimiter, 'check')
      switchOff('portal.upload')

      const response = await upload(admin, property, purpose, portal)

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'capability_disabled' })
      expect(check).not.toHaveBeenCalled()
      expect(await assetCount()).toBe(0)
    },
  )

  it('spends the rate allowance on an upload that is allowed', async () => {
    const { admin, property } = await hotel()
    const check = vi.spyOn(harness.container().rateLimiter, 'check')

    const response = await upload(admin, property, 'hero')

    expect(response.status).toBe(201)
    expect(check).toHaveBeenCalled()
  })

  it('stores nothing when uploads are switched off', async () => {
    const { admin, property } = await hotel()
    const before = (await storage.listObjects('', 1000)).objects.length
    switchOff('portal.upload')

    const response = await upload(admin, property, 'hero')

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'capability_disabled' })
    expect((await storage.listObjects('', 1000)).objects).toHaveLength(before)
    expect(await assetCount()).toBe(0)
  })
})
