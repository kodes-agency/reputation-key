// Listing the history of a Portal Group and deleting a Portal, on real PostgreSQL
// with two organizations: the results a manager sees, the refusals, the facts
// recorded and the ledger written.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { OrganizationId, PortalId } from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import { PORTAL_GROUP_HISTORY_PAGE } from '../groups/list-portal-group-history.server'
import {
  createGroupLifecycleHarness,
  ctxOf,
  EARLIER,
  expectCode,
  GROUP_LIFECYCLE_TABLES,
  MANAGER,
  NEXT,
  NOW,
  ORG_A,
  ORG_B,
  wire,
} from './portal-group-lifecycle.test-fixtures'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [...GROUP_LIFECYCLE_TABLES],
})
const { seedProperty, seedPortal, seedGroup, factsOf } =
  createGroupLifecycleHarness(getPool)

describe.sequential('listPortalGroupHistory (real PostgreSQL, two tenants)', () => {
  const readOnly = (org: OrganizationId) =>
    buildTestAuthContext({
      organizationId: org,
      userId: MANAGER,
      role: 'Member',
      effectivePermissions: new Set<Permission>(['dashboard.read']),
    })

  it('returns the ledger of a group, one page', async () => {
    const property = await seedProperty(ORG_A)
    const { create, list } = wire()
    const group = await create({ name: 'Lobby', propertyId: property }, ctxOf(ORG_A))

    const result = await list({ portalGroupId: group.id }, ctxOf(ORG_A))

    expect(result).toEqual([
      expect.objectContaining({
        organizationId: ORG_A,
        propertyId: property,
        portalGroupId: group.id,
        kind: 'created',
        portalId: null,
        otherGroupId: null,
        name: 'Lobby',
        previousName: null,
        actorUserId: MANAGER,
        occurredAt: NOW,
      }),
    ])
  })

  it('stops at one page of a longer ledger', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Lobby')
    await getPool().query(
      `INSERT INTO portal_group_history
         (organization_id, property_id, portal_group_id, kind, name, previous_name,
          actor_user_id, occurred_at)
       SELECT $1, $2, $3, 'renamed', 'Name ' || n, 'Name ' || (n - 1), $4,
              $5::timestamptz + n * interval '1 second'
       FROM generate_series(1, $6::int) AS n`,
      [ORG_A, property, group, MANAGER, EARLIER, PORTAL_GROUP_HISTORY_PAGE + 5],
    )

    const result = await wire().list({ portalGroupId: group }, ctxOf(ORG_A))

    expect(result).toHaveLength(PORTAL_GROUP_HISTORY_PAGE)
    expect(result[0]?.name).toBe(`Name ${PORTAL_GROUP_HISTORY_PAGE + 5}`)
  })

  it('refuses a role that cannot read Portals', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Lobby')

    await expectCode(wire().list({ portalGroupId: group }, readOnly(ORG_A)), 'forbidden')
  })

  it('refuses a group that is not in the Organization', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Lobby')
    const { list } = wire()

    await expectCode(
      list({ portalGroupId: randomUUID() }, ctxOf(ORG_A)),
      'group_not_found',
    )
    await expectCode(list({ portalGroupId: group }, ctxOf(ORG_B)), 'group_not_found')
  })

  it('refuses a manager who is not assigned to the group Property', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Lobby')

    await expectCode(wire([]).list({ portalGroupId: group }, ctxOf(ORG_A)), 'forbidden')
  })
})

describe.sequential('softDeletePortal (real PostgreSQL, two tenants)', () => {
  const portalRow = async (org: OrganizationId, id: PortalId) =>
    (
      await getPool().query(
        `SELECT deleted_at, updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
        [org, id],
      )
    ).rows[0]

  const tokenRows = async (org: OrganizationId, id: PortalId) =>
    (
      await getPool().query(
        `SELECT status, revoked_by, revoked_reason, revoked_at FROM portal_tokens
         WHERE organization_id = $1 AND portal_id = $2`,
        [org, id],
      )
    ).rows

  it('requires staff removal for a personal Portal instead of ordinary deletion', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property, {
      kind: 'personal',
      publicName: 'Harbor',
    })

    await expect(
      wire().deletePortal({ portalId: portal }, ctxOf(ORG_A, 'AccountAdmin')),
    ).rejects.toMatchObject({ code: 'personal_portal_archive_locked' })

    expect(await factsOf(ORG_A)).toEqual([])
    expect((await portalRow(ORG_A, portal))?.deleted_at).toBeNull()
  })

  it('soft-deletes a Portal and records the portal.deleted fact', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property, { updatedAt: NOW })

    await wire().deletePortal({ portalId: portal }, ctxOf(ORG_A, 'AccountAdmin'))

    expect(await portalRow(ORG_A, portal)).toMatchObject({
      deleted_at: NOW,
      updated_at: NEXT,
    })
    const emitted = await factsOf(ORG_A, 'portal.deleted')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.payload).toMatchObject({
      portalId: portal,
      sourceAggregateVersion: NEXT.toISOString(),
    })
  })

  it('refuses a role that cannot delete', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property)

    await expectCode(wire().deletePortal({ portalId: portal }, ctxOf(ORG_A)), 'forbidden')

    expect((await portalRow(ORG_A, portal))?.deleted_at).toBeNull()
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('refuses an unknown Portal and a Portal of another organization', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property)
    const { deletePortal } = wire()

    await expectCode(
      deletePortal({ portalId: randomUUID() }, ctxOf(ORG_A, 'AccountAdmin')),
      'portal_not_found',
    )
    await expectCode(
      deletePortal({ portalId: portal }, ctxOf(ORG_B, 'AccountAdmin')),
      'portal_not_found',
    )

    expect((await portalRow(ORG_A, portal))?.deleted_at).toBeNull()
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await factsOf(ORG_B)).toEqual([])
  })

  it('revokes the Portal tokens with an audit reason and leaves another tenant alone', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property)
    const propertyB = await seedProperty(ORG_B)
    const portalB = await seedPortal(ORG_B, propertyB)
    const { issue, deletePortal } = wire()
    await issue({ portalId: portal }, ctxOf(ORG_A))
    await issue({ portalId: portalB }, ctxOf(ORG_B))
    await getPool().query(`DELETE FROM outbox_events WHERE organization_id = ANY($1)`, [
      [ORG_A, ORG_B],
    ])

    await deletePortal({ portalId: portal }, ctxOf(ORG_A, 'AccountAdmin'))

    expect(await tokenRows(ORG_A, portal)).toEqual([
      expect.objectContaining({
        status: 'revoked',
        revoked_by: MANAGER,
        revoked_reason: 'portal deleted',
        revoked_at: NOW,
      }),
    ])
    expect(await tokenRows(ORG_B, portalB)).toEqual([
      expect.objectContaining({ status: 'active', revoked_by: null }),
    ])
    expect(await factsOf(ORG_A, 'portal.token.revoked')).toHaveLength(1)
    expect(await factsOf(ORG_B)).toEqual([])
  })

  it('stays quiet about tokens when the Portal has no live tokens', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property)

    await wire().deletePortal({ portalId: portal }, ctxOf(ORG_A, 'AccountAdmin'))

    expect(await tokenRows(ORG_A, portal)).toEqual([])
    expect(await factsOf(ORG_A, 'portal.token.revoked')).toEqual([])
    expect(await factsOf(ORG_A, 'portal.deleted')).toHaveLength(1)
  })
})
