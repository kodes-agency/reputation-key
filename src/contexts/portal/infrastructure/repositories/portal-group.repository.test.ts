import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { organizationId, portalGroupId, portalId } from '#/shared/domain/ids'
import { createPortalGroupRepository } from './portal-group.repository'

const ORG = organizationId('org-portal-group-temporal')
const PROPERTY_A = 'dc000000-0000-4000-8000-000000000001'
const PROPERTY_B = 'dc000000-0000-4000-8000-000000000002'
const PORTAL = portalId('dc000000-0000-4000-8000-000000000011')
const GROUP_A = portalGroupId('dc000000-0000-4000-8000-000000000021')
const GROUP_B = portalGroupId('dc000000-0000-4000-8000-000000000022')
const GROUP_OTHER_PROPERTY = portalGroupId('dc000000-0000-4000-8000-000000000023')
const START = new Date('2026-08-07T12:00:00.000Z')
const MOVE = new Date('2026-08-08T12:00:00.000Z')
const ARCHIVE = new Date('2026-08-09T12:00:00.000Z')

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, NOW()) ON CONFLICT (id) DO NOTHING`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Temporal A', 'temporal-a', 'UTC', NOW(), NOW()),
            ($2, $3, 'Temporal B', 'temporal-b', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY_A, PROPERTY_B, ORG],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM portal_group_memberships WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM portal_groups WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM portals WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [
    PROPERTY_A,
    PROPERTY_B,
  ])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM portal_group_memberships WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM portal_groups WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM portals WHERE organization_id = $1', [ORG])
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Temporal Portal', 'temporal-portal', NOW(), NOW())`,
    [PORTAL, ORG, PROPERTY_A],
  )
  await pool.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $4, $5, 'Group A', NOW(), NOW()),
            ($2, $4, $5, 'Group B', NOW(), NOW()),
            ($3, $4, $6, 'Other Property', NOW(), NOW())`,
    [GROUP_A, GROUP_B, GROUP_OTHER_PROPERTY, ORG, PROPERTY_A, PROPERTY_B],
  )
})

describe('portal group repository effective memberships', () => {
  it('preserves event-time attribution when a portal moves groups', async () => {
    const repo = createPortalGroupRepository(getDb())
    await repo.addPortal(ORG, GROUP_A, PORTAL, START, 'owner')
    await repo.removePortal(ORG, GROUP_A, PORTAL, MOVE, 'moved_to_new_group')
    await repo.addPortal(ORG, GROUP_B, PORTAL, MOVE, 'owner')

    await expect(
      repo.findGroupForPortal(ORG, PORTAL, new Date(START.getTime() + 1)),
    ).resolves.toMatchObject({ id: GROUP_A })
    await expect(repo.findGroupForPortal(ORG, PORTAL, MOVE)).resolves.toMatchObject({
      id: GROUP_B,
    })
    await expect(repo.findPortalMembership(ORG, PORTAL)).resolves.toBe(GROUP_B)
    await expect(repo.findGroupIdsByPortalIds(ORG, [PORTAL])).resolves.toEqual([GROUP_B])
  })

  it('rejects a portal and group from different properties at the repository boundary', async () => {
    const repo = createPortalGroupRepository(getDb())
    await expect(
      repo.addPortal(ORG, GROUP_OTHER_PROPERTY, PORTAL, START, 'owner'),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'forbidden' })
    await expect(repo.findPortalMembership(ORG, PORTAL)).resolves.toBeNull()
  })

  it('closes current memberships when the group is archived but keeps history resolvable', async () => {
    const repo = createPortalGroupRepository(getDb())
    await repo.addPortal(ORG, GROUP_A, PORTAL, START, 'owner')

    await repo.softDelete(ORG, GROUP_A, ARCHIVE)

    await expect(repo.findPortalMembership(ORG, PORTAL)).resolves.toBeNull()
    await expect(repo.findGroupForPortal(ORG, PORTAL, MOVE)).resolves.toMatchObject({
      id: GROUP_A,
    })
    await expect(repo.getGroupPortalIds(ORG, GROUP_A)).resolves.toEqual([])
  })
})
