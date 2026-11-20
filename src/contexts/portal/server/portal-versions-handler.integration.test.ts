// Portal version reads (History tab), called as signed-in members over
// PostgreSQL with the real tenant resolution and execution policy. The three
// reads share one scope check, so each role case runs over all three.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { immersiveConfiguration } from '../application/__fixtures__/immersive-snapshot'
import { seedLiveImmersiveSnapshot } from '../infrastructure/testing/portal-live-immersive-seed'
import {
  setupServerFunctionHarness,
  type TestMember,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  getPortalVersion,
  getPortalVersionPreview,
  getPortalVersions,
} from './portal-versions'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_page_edits',
    'portal_pending_content_changes',
  ],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const ungranted = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPortal(property)
  await harness.grantProperty(manager, property)
  const seed = {
    organizationId: organization.id,
    propertyId: property.id,
    portalId: portal.id,
    configuration: immersiveConfiguration({ portal: { id: portal.id, slug: 'harbor' } }),
  }
  await seedLiveImmersiveSnapshot({ ...seed, version: 1, activation: 'replaced' })
  await seedLiveImmersiveSnapshot({ ...seed, version: 2 })
  return { organization, admin, manager, ungranted, member, portal }
}

type Portal = Awaited<ReturnType<typeof hotel>>['portal']

const reads = {
  getPortalVersions: (caller: TestMember, portal: Portal) =>
    harness.callAs(caller, () => getPortalVersions({ data: { portalId: portal.id } })),
  getPortalVersion: (caller: TestMember, portal: Portal, version = 2) =>
    harness.callAs(caller, () =>
      getPortalVersion({ data: { portalId: portal.id, version } }),
    ),
  getPortalVersionPreview: (caller: TestMember, portal: Portal, version = 2) =>
    harness.callAs(caller, () =>
      getPortalVersionPreview({ data: { portalId: portal.id, version } }),
    ),
}

const READS = Object.keys(reads) as Array<keyof typeof reads>

afterEach(resetCapabilityPolicyStore)

const switchOff = (capability: string) =>
  initCapabilityPolicyStore({
    isCapabilityKilled: (cap) => cap === capability,
    isOrgSuspended: () => false,
  })

describe('portal version reads', () => {
  it.each(['admin', 'manager'] as const)(
    'lists the published versions, newest first, to the %s',
    async (who) => {
      const world = await hotel()

      const listed = await reads.getPortalVersions(world[who], world.portal)

      expect(listed.versions.map((v) => v.version)).toEqual([2, 1])
      expect(listed.versions.map((v) => v.isLive)).toEqual([true, false])
      expect(listed.liveVersion).toBe(2)
      expect(listed).toHaveProperty('draft')
      expect(listed).toHaveProperty('truncated', false)
    },
  )

  it('returns one version with its content and what making it live would change', async () => {
    const world = await hotel()

    const read = await reads.getPortalVersion(world.admin, world.portal, 1)

    expect(read).toMatchObject({
      version: 1,
      liveVersion: 2,
      isLive: false,
      restorable: expect.any(Boolean),
      content: expect.anything(),
      changesFromLive: expect.any(Array),
    })
  })

  it('returns a preview outcome for one version', async () => {
    const world = await hotel()

    const preview = await reads.getPortalVersionPreview(world.manager, world.portal, 2)

    expect(['ready', 'earlier_design']).toContain(preview.status)
  })

  it.each(['getPortalVersion', 'getPortalVersionPreview'] as const)(
    '%s refuses a version the Portal never published',
    async (name) => {
      const world = await hotel()

      await expect(reads[name](world.admin, world.portal, 9)).rejects.toMatchObject({
        name: 'PortalError',
        code: 'publication_snapshot_unavailable',
        status: 409,
      })
    },
  )

  it.each(READS)('%s refuses a PropertyManager without a grant', async (name) => {
    const world = await hotel()

    await expect(reads[name](world.ungranted, world.portal)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'scope_denied',
      status: 403,
    })
  })

  it.each(READS)('%s refuses when Portal reads are switched off', async (name) => {
    const world = await hotel()
    switchOff('portal.read')

    await expect(reads[name](world.admin, world.portal)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })
  })

  it.each(READS)('%s refuses a Member', async (name) => {
    const world = await hotel()

    await expect(reads[name](world.member, world.portal)).rejects.toMatchObject({
      status: 403,
    })
  })

  it.each(READS)('%s does not find a Portal of another Organization', async (name) => {
    const world = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(reads[name](otherAdmin, world.portal)).rejects.toMatchObject({
      code: 'portal_not_found',
      status: 404,
    })
  })
})
