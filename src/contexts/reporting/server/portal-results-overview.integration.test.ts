// The Portals overview's results, read as signed-in members over PostgreSQL
// with the real tenant resolution and execution policy.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  type Capability,
} from '#/shared/auth/beta-capabilities'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestOrganization,
  type TestPortal,
  type TestProperty,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { PORTAL_RESULTS_PORTAL_LIMIT } from '../portal-results/get-portal-results-overview.server'
import { getPortalResultsOverviewFn } from './portal-results-overview'

const harness = setupServerFunctionHarness({
  cleanupTables: ['portal_group_memberships', 'portal_groups'],
})

async function withCapabilitiesOff<T>(
  capabilities: readonly Capability[],
  run: () => Promise<T>,
): Promise<T> {
  initCapabilityPolicyStore({
    isCapabilityKilled: (capability) => capabilities.includes(capability),
    isOrgSuspended: () => false,
  })
  try {
    return await run()
  } finally {
    initCapabilityPolicyStore(harness.container().capabilityPolicyStore)
  }
}

async function propertyIn(organization: TestOrganization, timezone: string) {
  const property = await harness.seedProperty(organization)
  await harness
    .pool()
    .query(`UPDATE properties SET timezone = $2 WHERE id = $1`, [property.id, timezone])
  return property
}

async function hotels() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const sofia = await propertyIn(organization, 'Europe/Sofia')
  const lima = await propertyIn(organization, 'America/Lima')
  const sofiaPortal = await harness.seedPortal(sofia)
  const limaPortal = await harness.seedPortal(lima)
  await harness.grantProperty(manager, sofia)
  return { organization, admin, manager, sofia, lima, sofiaPortal, limaPortal }
}

type Request = Readonly<{
  propertyId?: string
  timeRange?: '7d' | '30d' | 'all'
  compare?: boolean
}>

const overview = (data: Request = {}) =>
  getPortalResultsOverviewFn({ data: data as never })

const portalIdsOf = (result: Awaited<ReturnType<typeof overview>>) =>
  result.portals.map((row) => row.portalId).sort()

async function groupPortal(portal: TestPortal, by: TestMember) {
  const groupId = randomUUID()
  await harness.pool().query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name)
     VALUES ($1, $2, $3, 'Front of house')`,
    [groupId, portal.organizationId, portal.propertyId],
  )
  await harness.pool().query(
    `INSERT INTO portal_group_memberships
       (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, NOW() - interval '1 day', $5)`,
    [portal.organizationId, portal.propertyId, portal.id, groupId, by.userId],
  )
  return groupId
}

async function manyPortals(property: TestProperty, count: number) {
  await harness.pool().query(
    `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, theme)
     SELECT gen_random_uuid(), $1, $2::uuid, $2::text, 'Bulk ' || n, 'bulk-' || n,
            '{"primaryColor":"#6366F1"}'
     FROM generate_series(1, $3::int) AS n`,
    [property.organizationId, property.id, count],
  )
}

describe('getPortalResultsOverviewFn for one Property', () => {
  it('gives an AccountAdmin the results of the Property’s Portals in its own time zone', async () => {
    const { admin, sofia, sofiaPortal, limaPortal } = await hotels()

    const result = await harness.callAs(admin, () =>
      overview({ propertyId: sofia.id, timeRange: '7d', compare: false }),
    )

    expect(portalIdsOf(result)).toEqual([sofiaPortal.id])
    expect(portalIdsOf(result)).not.toContain(limaPortal.id)
    expect(result.properties).toHaveLength(1)
    expect(result.properties[0]).toMatchObject({
      propertyId: sofia.id,
      timezone: 'Europe/Sofia',
      comparePeriod: null,
    })
  })

  it('reads the window before as well when the caller asks to compare', async () => {
    const { admin, sofia } = await hotels()

    const result = await harness.callAs(admin, () =>
      overview({ propertyId: sofia.id, timeRange: '7d', compare: true }),
    )

    expect(result.properties[0]?.comparePeriod).not.toBeNull()
  })

  it('gives a PropertyManager the Property was granted to the same results', async () => {
    const { manager, sofia, sofiaPortal } = await hotels()

    const result = await harness.callAs(manager, () => overview({ propertyId: sofia.id }))

    expect(portalIdsOf(result)).toEqual([sofiaPortal.id])
  })

  it('places a Portal in the group it is in today', async () => {
    const { admin, sofia, sofiaPortal } = await hotels()
    const groupId = await groupPortal(sofiaPortal, admin)

    const result = await harness.callAs(admin, () => overview({ propertyId: sofia.id }))

    expect(result.portals[0]).toMatchObject({ portalId: sofiaPortal.id, groupId })
    expect(result.groups.map((group) => group.groupId)).toEqual([groupId])
  })

  it('gives empty results for a Property with no Portals', async () => {
    const { organization, admin } = await hotels()
    const empty = await propertyIn(organization, 'UTC')

    const result = await harness.callAs(admin, () => overview({ propertyId: empty.id }))

    expect(result.portals).toEqual([])
    expect(result.groups).toEqual([])
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { manager, lima } = await hotels()

    await expect(
      harness.callAs(manager, () => overview({ propertyId: lima.id })),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { sofia } = await hotels()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () => overview({ propertyId: sofia.id })),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('answers a Property with too many Portals with a 422 the page can tell from a failure', async () => {
    const { admin, sofia } = await hotels()
    await manyPortals(sofia, PORTAL_RESULTS_PORTAL_LIMIT)

    await expect(
      harness.callAs(admin, () => overview({ propertyId: sofia.id })),
    ).rejects.toMatchObject({ code: 'too_many_portals', status: 422 })
  })
})

describe('getPortalResultsOverviewFn for the whole Organization', () => {
  it('gives an AccountAdmin the Portals of every Property, each in its own time zone', async () => {
    const { admin, sofia, lima, sofiaPortal, limaPortal } = await hotels()

    const result = await harness.callAs(admin, () => overview())

    expect(portalIdsOf(result)).toEqual([sofiaPortal.id, limaPortal.id].sort())
    const zones = Object.fromEntries(
      result.properties.map((row) => [row.propertyId, row.timezone]),
    )
    expect(zones).toEqual({ [sofia.id]: 'Europe/Sofia', [lima.id]: 'America/Lima' })
  })

  it('gives a PropertyManager only the Portals of the Properties granted to them', async () => {
    const { manager, sofia, sofiaPortal } = await hotels()

    const result = await harness.callAs(manager, () => overview())

    expect(portalIdsOf(result)).toEqual([sofiaPortal.id])
    expect(result.properties.map((row) => row.propertyId)).toEqual([sofia.id])
  })

  it('gives empty results to a PropertyManager with no grants', async () => {
    const { organization } = await hotels()
    const ungranted = await harness.seedMember(organization, 'PropertyManager')

    const result = await harness.callAs(ungranted, () => overview())

    expect(result.portals).toEqual([])
    expect(result.properties).toEqual([])
  })

  it('gives empty results for an Organization with no Portals', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    await propertyIn(organization, 'UTC')

    const result = await harness.callAs(admin, () => overview())

    expect(result.portals).toEqual([])
  })

  it('never shows the Portals of another Organization', async () => {
    const { sofiaPortal, limaPortal } = await hotels()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')
    const foreign = await harness.seedPortal(await propertyIn(elsewhere, 'UTC'))

    const result = await harness.callAs(otherAdmin, () => overview())

    expect(portalIdsOf(result)).toEqual([foreign.id])
    expect(portalIdsOf(result)).not.toContain(sofiaPortal.id)
    expect(portalIdsOf(result)).not.toContain(limaPortal.id)
  })

  it('answers an Organization with too many Portals with a 422', async () => {
    const { admin, sofia } = await hotels()
    await manyPortals(sofia, PORTAL_RESULTS_PORTAL_LIMIT)

    await expect(harness.callAs(admin, () => overview())).rejects.toMatchObject({
      code: 'too_many_portals',
      status: 422,
    })
  })
})

describe('getPortalResultsOverviewFn requests', () => {
  describe('while a feature is off', () => {
    it.each([
      ['Portal reads are off', 'portal.read'],
      ['the dashboard is off', 'dashboard.use'],
    ] as const)('refuses a Property read when %s', async (_name, capability) => {
      const { admin, sofia } = await hotels()

      await expect(
        harness.callAs(admin, () =>
          withCapabilitiesOff([capability], () => overview({ propertyId: sofia.id })),
        ),
      ).rejects.toMatchObject({ code: 'capability_disabled' })
    })

    it.each([
      ['Portal reads are off', 'portal.read'],
      ['the dashboard is off', 'dashboard.use'],
    ] as const)('refuses an Organization read when %s', async (_name, capability) => {
      const { admin } = await hotels()

      await expect(
        harness.callAs(admin, () => withCapabilitiesOff([capability], () => overview())),
      ).rejects.toMatchObject({ code: 'capability_disabled' })
    })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await hotels()
    const member = await harness.seedMember(organization, 'Member')

    await expect(harness.callAs(member, () => overview())).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('refuses a caller with no session', async () => {
    await expect(harness.callAs(null, () => overview())).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('refuses All Time, which the overview does not compare', async () => {
    const { admin } = await hotels()

    await expect(
      harness.callAs(admin, () => overview({ timeRange: 'all' })),
    ).rejects.toThrow(/timeRange/)
  })
})
