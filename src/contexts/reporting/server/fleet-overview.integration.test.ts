// The fleet overview, read as signed-in members over PostgreSQL with the real
// tenant resolution and execution policy.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  type Capability,
} from '#/shared/auth/beta-capabilities'
import {
  setupServerFunctionHarness,
  type TestOrganization,
  type TestProperty,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { getFleetOverviewFn } from './fleet-overview'

const harness = setupServerFunctionHarness()

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

async function namedProperty(organization: TestOrganization, name: string) {
  const property = await harness.seedProperty(organization)
  await harness
    .pool()
    .query(`UPDATE properties SET name = $2 WHERE id = $1`, [property.id, name])
  return property
}

async function hotels() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const alpine = await namedProperty(organization, 'Alpine Lodge')
  const bayview = await namedProperty(organization, 'Bayview Inn')
  const castle = await namedProperty(organization, 'Castle Rest')
  await harness.grantProperty(manager, bayview)
  return { organization, admin, manager, alpine, bayview, castle }
}

const fleet = (cursor?: string) => getFleetOverviewFn({ data: cursor ? { cursor } : {} })
const idsOf = (entries: readonly { propertyId: string }[]) =>
  entries.map((entry) => entry.propertyId)

describe('getFleetOverviewFn', () => {
  it('gives an AccountAdmin every Property of the Organization', async () => {
    const { admin, alpine, bayview, castle } = await hotels()

    const result = await harness.callAs(admin, () => fleet())

    expect(idsOf(result.entries)).toEqual([alpine.id, bayview.id, castle.id])
    expect(result.entries.map((entry) => entry.name)).toEqual([
      'Alpine Lodge',
      'Bayview Inn',
      'Castle Rest',
    ])
    expect(result.totals.propertyCount).toBe(3)
    expect(result.nextCursor).toBeNull()
    expect(result.entries[0]?.ratingGoal).not.toBeNull()
  })

  it('gives a PropertyManager only the Properties granted to them', async () => {
    const { manager, bayview } = await hotels()

    const result = await harness.callAs(manager, () => fleet())

    expect(idsOf(result.entries)).toEqual([bayview.id])
    expect(result.totals.propertyCount).toBe(1)
  })

  it('gives a PropertyManager with no grants an empty fleet', async () => {
    const { organization } = await hotels()
    const ungranted = await harness.seedMember(organization, 'PropertyManager')

    const result = await harness.callAs(ungranted, () => fleet())

    expect(result.entries).toEqual([])
  })

  it('never shows the Properties of another Organization', async () => {
    const { admin, alpine, bayview, castle } = await hotels()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')
    const foreign = await namedProperty(elsewhere, 'Dockside')

    const mine = await harness.callAs(admin, () => fleet())
    const theirs = await harness.callAs(otherAdmin, () => fleet())

    expect(idsOf(mine.entries)).not.toContain(foreign.id)
    expect(idsOf(mine.entries)).toEqual([alpine.id, bayview.id, castle.id])
    expect(idsOf(theirs.entries)).toEqual([foreign.id])
  })

  it('leaves the rating goal out of every entry while Goals are off', async () => {
    const { admin } = await hotels()

    const result = await harness.callAs(admin, () =>
      withCapabilitiesOff(['goal.use'], () => fleet()),
    )

    expect(result.entries).toHaveLength(3)
    expect(result.entries.every((entry) => entry.ratingGoal === null)).toBe(true)
  })

  it('refuses the fleet while the dashboard is off, although Goals are on', async () => {
    const { admin } = await hotels()

    await expect(
      harness.callAs(admin, () => withCapabilitiesOff(['dashboard.use'], () => fleet())),
    ).rejects.toMatchObject({ code: 'capability_disabled' })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await hotels()
    const member = await harness.seedMember(organization, 'Member')

    await expect(harness.callAs(member, () => fleet())).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('refuses a caller with no session', async () => {
    await expect(harness.callAs(null, () => fleet())).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('continues the list from the cursor of the previous page', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    const seeded: TestProperty[] = []
    for (let i = 0; i < 3; i += 1) seeded.push(await harness.seedProperty(organization))
    // One more than a page, named so the order is fixed.
    await harness.pool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       SELECT gen_random_uuid(), $1, 'Hotel ' || lpad(n::text, 3, '0'), 'bulk-' || n, 'UTC'
       FROM generate_series(1, 50) AS n`,
      [organization.id],
    )
    await harness
      .pool()
      .query(`UPDATE properties SET name = 'Zeta ' || id WHERE id = ANY($1)`, [
        seeded.map((property) => property.id),
      ])

    const first = await harness.callAs(admin, () => fleet())
    expect(first.entries).toHaveLength(50)
    expect(first.nextCursor).not.toBeNull()
    const second = await harness.callAs(admin, () => fleet(first.nextCursor ?? ''))

    expect(second.entries).toHaveLength(3)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...idsOf(first.entries), ...idsOf(second.entries)]).size).toBe(53)
  })

  it('refuses a malformed cursor', async () => {
    const { admin } = await hotels()

    await expect(
      harness.callAs(admin, () => fleet('not-a-cursor')),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      status: 400,
    })
    const wrongShape = Buffer.from(
      JSON.stringify({ n: 'a', i: randomUUID().slice(1) }),
    ).toString('base64url')
    await expect(harness.callAs(admin, () => fleet(wrongShape))).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
