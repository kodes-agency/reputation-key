// Portal group server functions, called as signed-in members over PostgreSQL
// with the real tenant resolution and execution policy. Rows are seeded with
// millisecond timestamps because the commands fence on the revision they read.

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import type { TestProperty } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { listPortalGroupHistory, movePortalToGroup } from './portal-groups'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'portal_group_history',
    'portal_group_memberships',
    'portal_groups',
    'portal_pending_content_changes',
    'portal_page_edits',
  ],
})

afterEach(resetCapabilityPolicyStore)

const switchOff = (capability: string) =>
  initCapabilityPolicyStore({
    isCapabilityKilled: (cap) => cap === capability,
    isOrgSuspended: () => false,
  })

async function seedGroup(property: TestProperty, name = 'Waterfront'): Promise<string> {
  const id = randomUUID()
  await harness.pool().query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, date_trunc('milliseconds', NOW()), date_trunc('milliseconds', NOW()))`,
    [id, property.organizationId, property.id, name],
  )
  return id
}

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const outsider = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPortal(property)
  await harness
    .pool()
    .query(
      `UPDATE portals SET updated_at = date_trunc('milliseconds', updated_at) WHERE id = $1`,
      [portal.id],
    )
  await harness.grantProperty(manager, property)
  const groupId = await seedGroup(property)
  return { organization, admin, manager, outsider, member, property, portal, groupId }
}

const memberships = async (organizationId: string) =>
  (
    await harness.pool().query<{ portal_id: string; portal_group_id: string }>(
      `SELECT portal_id, portal_group_id FROM portal_group_memberships
        WHERE organization_id = $1 AND effective_to IS NULL ORDER BY portal_id`,
      [organizationId],
    )
  ).rows

const addedFacts = async (organizationId: string) =>
  (
    await harness.pool().query(
      `SELECT 1 FROM outbox_events
        WHERE organization_id = $1 AND event_type = 'portal_group.portal_added'`,
      [organizationId],
    )
  ).rowCount

describe('movePortalToGroup', () => {
  it('puts the Portal in the group for an AccountAdmin and writes the fact', async () => {
    const { organization, admin, portal, groupId } = await hotel()

    const moved = await harness.callAs(admin, () =>
      movePortalToGroup({ data: { portalGroupId: groupId, portalId: portal.id } }),
    )

    expect(moved).toEqual({ moved: true })
    expect(await memberships(organization.id)).toEqual([
      { portal_id: portal.id, portal_group_id: groupId },
    ])
    expect(await addedFacts(organization.id)).toBe(1)
  })

  it('lets a PropertyManager granted on the Property move the Portal', async () => {
    const { organization, manager, portal, groupId } = await hotel()

    await harness.callAs(manager, () =>
      movePortalToGroup({ data: { portalGroupId: groupId, portalId: portal.id } }),
    )

    expect(await memberships(organization.id)).toEqual([
      { portal_id: portal.id, portal_group_id: groupId },
    ])
  })

  it('closes the old membership when the Portal moves to another group', async () => {
    const { organization, admin, property, portal, groupId } = await hotel()
    const other = await seedGroup(property, 'Garden')
    await harness.callAs(admin, () =>
      movePortalToGroup({ data: { portalGroupId: groupId, portalId: portal.id } }),
    )

    await harness.callAs(admin, () =>
      movePortalToGroup({ data: { portalGroupId: other, portalId: portal.id } }),
    )

    expect(await memberships(organization.id)).toEqual([
      { portal_id: portal.id, portal_group_id: other },
    ])
    const closed = await harness.pool().query(
      `SELECT 1 FROM portal_group_memberships
        WHERE organization_id = $1 AND portal_group_id = $2 AND effective_to IS NOT NULL`,
      [organization.id, groupId],
    )
    expect(closed.rowCount).toBe(1)
  })

  it('does not move a Portal that sits in another Property than the group', async () => {
    const { organization, admin, groupId } = await hotel()
    const elsewhere = await harness.seedProperty(organization)
    const otherPortal = await harness.seedPortal(elsewhere)

    await expect(
      harness.callAs(admin, () =>
        movePortalToGroup({ data: { portalGroupId: groupId, portalId: otherPortal.id } }),
      ),
    ).rejects.toMatchObject({
      name: 'PortalError',
      code: 'portal_not_in_group',
      status: 404,
    })

    expect(await memberships(organization.id)).toEqual([])
  })

  it("does not move a Portal into another Organization's group", async () => {
    const { organization, admin, portal } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const foreignGroup = await seedGroup(await harness.seedProperty(elsewhere))

    await expect(
      harness.callAs(admin, () =>
        movePortalToGroup({ data: { portalGroupId: foreignGroup, portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({
      name: 'PortalError',
      code: 'portal_not_in_group',
      status: 404,
    })

    expect(await memberships(organization.id)).toEqual([])
    expect(await memberships(elsewhere.id)).toEqual([])
  })

  it('refuses a PropertyManager without a grant and a Member, moving nothing', async () => {
    const { organization, outsider, member, portal, groupId } = await hotel()

    await expect(
      harness.callAs(outsider, () =>
        movePortalToGroup({ data: { portalGroupId: groupId, portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })
    await expect(
      harness.callAs(member, () =>
        movePortalToGroup({ data: { portalGroupId: groupId, portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'beta_role_inactive',
      status: 403,
    })

    expect(await memberships(organization.id)).toEqual([])
    expect(await addedFacts(organization.id)).toBe(0)
  })
})

describe('movePortalToGroup with Portal writes switched off', () => {
  it('refuses the move and writes nothing', async () => {
    const { organization, admin, portal, groupId } = await hotel()
    switchOff('portal.write')

    await expect(
      harness.callAs(admin, () =>
        movePortalToGroup({ data: { portalGroupId: groupId, portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect(await memberships(organization.id)).toEqual([])
    expect(await addedFacts(organization.id)).toBe(0)
  })
})

describe('listPortalGroupHistory', () => {
  it('returns the move in the ledger of a group the caller may read', async () => {
    const { admin, manager, portal, groupId } = await hotel()
    await harness.callAs(admin, () =>
      movePortalToGroup({ data: { portalGroupId: groupId, portalId: portal.id } }),
    )

    const asAdmin = await harness.callAs(admin, () =>
      listPortalGroupHistory({ data: { portalGroupId: groupId } }),
    )
    const asManager = await harness.callAs(manager, () =>
      listPortalGroupHistory({ data: { portalGroupId: groupId } }),
    )

    expect(asAdmin.entries).toHaveLength(1)
    expect(asManager.entries).toEqual(asAdmin.entries)
  })

  it('refuses when Portal reads are switched off', async () => {
    const { admin, groupId } = await hotel()
    switchOff('portal.read')

    await expect(
      harness.callAs(admin, () =>
        listPortalGroupHistory({ data: { portalGroupId: groupId } }),
      ),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })
  })

  it('refuses a PropertyManager without a grant', async () => {
    const { outsider, groupId } = await hotel()

    await expect(
      harness.callAs(outsider, () =>
        listPortalGroupHistory({ data: { portalGroupId: groupId } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('answers not found for a group of another Organization', async () => {
    const { admin } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const foreignGroup = await seedGroup(await harness.seedProperty(elsewhere))

    await expect(
      harness.callAs(admin, () =>
        listPortalGroupHistory({ data: { portalGroupId: foreignGroup } }),
      ),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'group_not_found', status: 404 })
  })
})
