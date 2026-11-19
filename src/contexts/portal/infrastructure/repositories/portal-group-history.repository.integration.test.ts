// Portal Group history reader, on real PostgreSQL.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { createPortalGroupHistoryRepository } from './portal-group-history.repository'

const ORG = organizationId('org-grouphistory-0000-000000000001')
const ORG_OTHER = organizationId('org-grouphistory-0000-000000000002')
const PROPERTY = propertyId('7c000000-0000-4000-8000-000000000001')
const PROPERTY_OTHER = propertyId('7c000000-0000-4000-8000-000000000002')
const GROUP = portalGroupId('7d000000-0000-4000-8000-000000000001')
const GROUP_OTHER = portalGroupId('7d000000-0000-4000-8000-000000000002')
const PORTAL = portalId('7e000000-0000-4000-8000-000000000001')
const T0 = new Date('2026-09-01T10:00:00.000Z')
const T1 = new Date('2026-09-02T10:00:00.000Z')
const T2 = new Date('2026-09-03T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: ORG_OTHER,
  tables: ['portal_group_history', 'portal_groups', 'properties'],
})

beforeEach(async () => {
  const pool = getPool()
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'History A', 'history-a', 'UTC', NOW(), NOW()),
            ($2, $4, 'History B', 'history-b', 'UTC', NOW(), NOW())`,
    [PROPERTY, PROPERTY_OTHER, ORG, ORG_OTHER],
  )
  await pool.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $3, $5, 'Group', NOW(), NOW()), ($2, $4, $6, 'Other', NOW(), NOW())`,
    [GROUP, GROUP_OTHER, ORG, ORG_OTHER, PROPERTY, PROPERTY_OTHER],
  )
})

async function insert(
  org: string,
  property: string,
  group: string,
  kind: string,
  at: Date,
  extra: Readonly<{
    name?: string
    previousName?: string
    portal?: string
  }> = {},
): Promise<void> {
  await getPool().query(
    `INSERT INTO portal_group_history
       (organization_id, property_id, portal_group_id, kind, name, previous_name,
        portal_id, actor_user_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'actor-1', $8)`,
    [org, property, group, kind, extra.name, extra.previousName, extra.portal, at],
  )
}

describe.sequential('portal group history repository (real PostgreSQL)', () => {
  it('lists a group history newest first, with the wording of the time', async () => {
    await insert(ORG, PROPERTY, GROUP, 'created', T0, { name: 'Lobby' })
    await insert(ORG, PROPERTY, GROUP, 'renamed', T1, {
      name: 'Front Desk',
      previousName: 'Lobby',
    })
    await insert(ORG, PROPERTY, GROUP, 'portal_added', T2, { portal: PORTAL })

    const entries = await createPortalGroupHistoryRepository(getDb()).listForGroup(
      ORG,
      GROUP,
      10,
    )

    expect(entries.map((entry) => entry.kind)).toEqual([
      'portal_added',
      'renamed',
      'created',
    ])
    expect(entries[1]).toMatchObject({
      name: 'Front Desk',
      previousName: 'Lobby',
      actorUserId: 'actor-1',
      occurredAt: T1,
      portalId: null,
      otherGroupId: null,
    })
    expect(entries[0]).toMatchObject({ portalId: PORTAL, name: null })
  })

  it('puts a creation after the Portals it started with when they share an instant', async () => {
    await insert(ORG, PROPERTY, GROUP, 'portal_added', T0, { portal: PORTAL })
    await insert(ORG, PROPERTY, GROUP, 'created', T0, { name: 'Lobby' })

    const entries = await createPortalGroupHistoryRepository(getDb()).listForGroup(
      ORG,
      GROUP,
      10,
    )

    expect(entries.map((entry) => entry.kind)).toEqual(['portal_added', 'created'])
  })

  it('caps the page and never shows another tenant history', async () => {
    await insert(ORG, PROPERTY, GROUP, 'created', T0, { name: 'Lobby' })
    await insert(ORG, PROPERTY, GROUP, 'archived', T1)
    await insert(ORG_OTHER, PROPERTY_OTHER, GROUP_OTHER, 'created', T2, { name: 'Other' })
    const repo = createPortalGroupHistoryRepository(getDb())

    expect(await repo.listForGroup(ORG, GROUP, 1)).toHaveLength(1)
    expect(await repo.listForGroup(ORG, GROUP_OTHER, 10)).toEqual([])
    expect(await repo.listForGroup(ORG_OTHER, GROUP, 10)).toEqual([])
  })

  it('removes the history with its group', async () => {
    await insert(ORG, PROPERTY, GROUP, 'created', T0, { name: 'Lobby' })

    await getPool().query(`DELETE FROM portal_groups WHERE id = $1`, [GROUP])

    expect(
      await createPortalGroupHistoryRepository(getDb()).listForGroup(ORG, GROUP, 10),
    ).toEqual([])
  })
})
