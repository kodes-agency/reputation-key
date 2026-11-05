import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { getDb } from '#/shared/db'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { createPortalGroupRepository } from './portal-group.repository'
import { seedPortalGroupMembership } from '../testing/portal-read-fixtures'

const ORG = organizationId('org-portal-group-temporal')
// A second, fully populated tenant. Portal grouping is scoped only by the
// repository's own `organizationId` conjuncts (direct, and via baseWhere) —
// group ids and portal ids carry no tenant of their own, so a dropped
// conjunct hands one tenant another tenant's portal topology.
const ORG_OTHER = organizationId('org-portal-group-other-tenant')
const PROPERTY_A = 'dc000000-0000-4000-8000-000000000001'
const PROPERTY_B = 'dc000000-0000-4000-8000-000000000002'
const PROPERTY_OTHER = propertyId('dc000000-0000-4000-8000-000000000003')
const PORTAL = portalId('dc000000-0000-4000-8000-000000000011')
const PORTAL_OTHER = portalId('dc000000-0000-4000-8000-000000000012')
const GROUP_A = portalGroupId('dc000000-0000-4000-8000-000000000021')
const GROUP_B = portalGroupId('dc000000-0000-4000-8000-000000000022')
const GROUP_OTHER_PROPERTY = portalGroupId('dc000000-0000-4000-8000-000000000023')
const GROUP_OTHER_TENANT = portalGroupId('dc000000-0000-4000-8000-000000000024')
const OTHER_TENANT_GROUP_NAME = 'Other Tenant Group'
const START = new Date('2026-08-07T12:00:00.000Z')
const MOVE = new Date('2026-08-08T12:00:00.000Z')
const ARCHIVE = new Date('2026-08-09T12:00:00.000Z')

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  for (const org of [ORG, ORG_OTHER]) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, NOW()) ON CONFLICT (id) DO NOTHING`,
      [org],
    )
  }
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $4, 'Temporal A', 'temporal-a', 'UTC', NOW(), NOW()),
            ($2, $4, 'Temporal B', 'temporal-b', 'UTC', NOW(), NOW()),
            ($3, $5, 'Temporal Other', 'temporal-other', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY_A, PROPERTY_B, PROPERTY_OTHER, ORG, ORG_OTHER],
  )
})

afterAll(async () => {
  const orgs = [ORG, ORG_OTHER]
  await pool.query(
    'DELETE FROM portal_group_memberships WHERE organization_id = ANY($1)',
    [orgs],
  )
  await pool.query('DELETE FROM portal_groups WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM portals WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM properties WHERE id = ANY($1)', [
    [PROPERTY_A, PROPERTY_B, PROPERTY_OTHER],
  ])
  await deleteTestOrganizations(pool, orgs)
  await pool.end()
})

beforeEach(async () => {
  const orgs = [ORG, ORG_OTHER]
  await pool.query(
    'DELETE FROM portal_group_memberships WHERE organization_id = ANY($1)',
    [orgs],
  )
  await pool.query('DELETE FROM portal_groups WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM portals WHERE organization_id = ANY($1)', [orgs])
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Temporal Portal', 'temporal-portal', NOW(), NOW())`,
    [PORTAL, ORG, PROPERTY_A],
  )
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Other Tenant Portal', 'other-tenant-portal', NOW(), NOW())`,
    [PORTAL_OTHER, ORG_OTHER, PROPERTY_OTHER],
  )
  await pool.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $4, $5, 'Group A', NOW(), NOW()),
            ($2, $4, $5, 'Group B', NOW(), NOW()),
            ($3, $4, $6, 'Other Property', NOW(), NOW())`,
    [GROUP_A, GROUP_B, GROUP_OTHER_PROPERTY, ORG, PROPERTY_A, PROPERTY_B],
  )
  await pool.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [GROUP_OTHER_TENANT, ORG_OTHER, PROPERTY_OTHER, OTHER_TENANT_GROUP_NAME],
  )
})

describe('portal group repository effective memberships', () => {
  it('preserves event-time attribution when a portal moves groups', async () => {
    const repo = createPortalGroupRepository(getDb())
    await seedPortalGroupMembership(getDb(), ORG, GROUP_A, PORTAL, START, 'owner')
    await pool.query(
      'UPDATE portal_group_memberships SET effective_to = $4, end_reason = $5 WHERE organization_id = $1 AND portal_group_id = $2 AND portal_id = $3 AND effective_to IS NULL',
      [ORG, GROUP_A, PORTAL, MOVE, 'moved_to_new_group'],
    )
    await seedPortalGroupMembership(getDb(), ORG, GROUP_B, PORTAL, MOVE, 'owner')

    await expect(
      repo.findGroupForPortal(ORG, PORTAL, new Date(START.getTime() + 1)),
    ).resolves.toMatchObject({ id: GROUP_A })
    await expect(repo.findGroupForPortal(ORG, PORTAL, MOVE)).resolves.toMatchObject({
      id: GROUP_B,
    })
    await expect(repo.findPortalMembership(ORG, PORTAL)).resolves.toBe(GROUP_B)
    await expect(repo.findGroupIdsByPortalIds(ORG, [PORTAL])).resolves.toEqual([GROUP_B])
  })

  it('keeps archived group history resolvable after its membership ends', async () => {
    const repo = createPortalGroupRepository(getDb())
    await seedPortalGroupMembership(getDb(), ORG, GROUP_A, PORTAL, START, 'owner')

    await pool.query(
      'UPDATE portal_groups SET deleted_at = $3, updated_at = $3 WHERE organization_id = $1 AND id = $2',
      [ORG, GROUP_A, ARCHIVE],
    )
    await pool.query(
      "UPDATE portal_group_memberships SET effective_to = $3, end_reason = 'group_archived' WHERE organization_id = $1 AND portal_group_id = $2 AND effective_to IS NULL",
      [ORG, GROUP_A, ARCHIVE],
    )

    await expect(repo.findPortalMembership(ORG, PORTAL)).resolves.toBeNull()
    await expect(repo.findGroupForPortal(ORG, PORTAL, MOVE)).resolves.toMatchObject({
      id: GROUP_A,
    })
    await expect(repo.getGroupPortalIds(ORG, GROUP_A)).resolves.toEqual([])
  })
})

describe('portal group repository — tenant isolation', () => {
  // After this the other tenant owns: a group, a portal, and an OPEN
  // membership joining them. Nothing below can pass vacuously.
  async function seedOtherTenantGrouping() {
    const repo = createPortalGroupRepository(getDb())
    await seedPortalGroupMembership(
      getDb(),
      ORG_OTHER,
      GROUP_OTHER_TENANT,
      PORTAL_OTHER,
      START,
      'owner',
    )
    // Scoped to THIS file's two orgs. The integration project shares one
    // database with the e2e seed and every other integration file, so an
    // unscoped `SELECT ... WHERE effective_to IS NULL` asserts on the whole
    // table and fails on rows it does not own — which is exactly what it did.
    const { rows } = await pool.query(
      `SELECT organization_id, portal_id, portal_group_id FROM portal_group_memberships
       WHERE effective_to IS NULL AND organization_id = ANY($1)`,
      [[ORG, ORG_OTHER]],
    )
    expect(rows).toEqual([
      {
        organization_id: ORG_OTHER,
        portal_id: PORTAL_OTHER,
        portal_group_id: GROUP_OTHER_TENANT,
      },
    ])
    return repo
  }

  it('findById and listPortalGroupsWithPortals never surface the other tenant group', async () => {
    const repo = await seedOtherTenantGrouping()

    await expect(repo.findById(ORG, GROUP_OTHER_TENANT)).resolves.toBeNull()
    await expect(repo.listPortalGroupsWithPortals(ORG, PROPERTY_OTHER)).resolves.toEqual(
      [],
    )
    // The group really is findable by its own tenant.
    await expect(repo.findById(ORG_OTHER, GROUP_OTHER_TENANT)).resolves.toMatchObject({
      id: GROUP_OTHER_TENANT,
      name: OTHER_TENANT_GROUP_NAME,
    })
  })

  it('nameExists does not leak the other tenant group names', async () => {
    const repo = await seedOtherTenantGrouping()

    await expect(
      repo.nameExists(ORG, PROPERTY_OTHER, OTHER_TENANT_GROUP_NAME),
    ).resolves.toBe(false)
    await expect(
      repo.nameExists(ORG_OTHER, PROPERTY_OTHER, OTHER_TENANT_GROUP_NAME),
    ).resolves.toBe(true)
  })

  it('membership reads never resolve the other tenant portal', async () => {
    const repo = await seedOtherTenantGrouping()

    await expect(repo.findPortalMembership(ORG, PORTAL_OTHER)).resolves.toBeNull()
    await expect(repo.findGroupForPortal(ORG, PORTAL_OTHER, MOVE)).resolves.toBeNull()
    await expect(repo.findGroupIdsByPortalIds(ORG, [PORTAL_OTHER])).resolves.toEqual([])
    await expect(repo.getGroupPortalIds(ORG, GROUP_OTHER_TENANT)).resolves.toEqual([])

    // The owning tenant resolves all four.
    await expect(repo.findPortalMembership(ORG_OTHER, PORTAL_OTHER)).resolves.toBe(
      GROUP_OTHER_TENANT,
    )
    await expect(
      repo.findGroupForPortal(ORG_OTHER, PORTAL_OTHER, MOVE),
    ).resolves.toMatchObject({ id: GROUP_OTHER_TENANT })
    await expect(
      repo.findGroupIdsByPortalIds(ORG_OTHER, [PORTAL_OTHER]),
    ).resolves.toEqual([GROUP_OTHER_TENANT])
    await expect(repo.getGroupPortalIds(ORG_OTHER, GROUP_OTHER_TENANT)).resolves.toEqual([
      PORTAL_OTHER,
    ])
  })
})

describe('portal group repository batched list', () => {
  const PORTAL_TWO = portalId('dc000000-0000-4000-8000-000000000013')

  async function seedSecondPortal(): Promise<void> {
    await pool.query(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
       VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Second Portal', 'second-portal', NOW(), NOW())`,
      [PORTAL_TWO, ORG, PROPERTY_A],
    )
  }

  it('lists the groups of a Property with their current Portals, by name', async () => {
    const repo = createPortalGroupRepository(getDb())
    await seedSecondPortal()
    await seedPortalGroupMembership(getDb(), ORG, GROUP_B, PORTAL_TWO, START, 'owner')
    await seedPortalGroupMembership(getDb(), ORG, GROUP_B, PORTAL, START, 'owner')

    const groups = await repo.listPortalGroupsWithPortals(ORG, propertyId(PROPERTY_A))

    expect(groups.map((group) => [group.id, group.name])).toEqual([
      [GROUP_A, 'Group A'],
      [GROUP_B, 'Group B'],
    ])
    expect(groups[0]?.portalIds).toEqual([])
    expect([...(groups[1]?.portalIds ?? [])].sort()).toEqual([PORTAL, PORTAL_TWO].sort())
  })

  it('leaves out a Portal whose membership has ended and a group that was archived', async () => {
    const repo = createPortalGroupRepository(getDb())
    await seedPortalGroupMembership(getDb(), ORG, GROUP_A, PORTAL, START, 'owner')
    await pool.query(
      'UPDATE portal_group_memberships SET effective_to = $4, end_reason = $5 WHERE organization_id = $1 AND portal_group_id = $2 AND portal_id = $3 AND effective_to IS NULL',
      [ORG, GROUP_A, PORTAL, MOVE, 'moved_to_group'],
    )
    await seedPortalGroupMembership(getDb(), ORG, GROUP_B, PORTAL, MOVE, 'owner')
    await pool.query(
      'UPDATE portal_groups SET deleted_at = $3, updated_at = $3 WHERE organization_id = $1 AND id = $2',
      [ORG, GROUP_A, ARCHIVE],
    )
    await pool.query(
      "UPDATE portal_group_memberships SET effective_to = $3, end_reason = 'group_archived' WHERE organization_id = $1 AND portal_group_id = $2 AND effective_to IS NULL",
      [ORG, GROUP_A, ARCHIVE],
    )

    const groups = await repo.listPortalGroupsWithPortals(ORG, propertyId(PROPERTY_A))

    expect(groups.map((group) => [group.id, group.portalIds])).toEqual([
      [GROUP_B, [PORTAL]],
    ])
  })

  it('does not list another Property group or another tenant group', async () => {
    const repo = createPortalGroupRepository(getDb())

    const propertyB = await repo.listPortalGroupsWithPortals(ORG, propertyId(PROPERTY_B))
    const crossTenant = await repo.listPortalGroupsWithPortals(ORG, PROPERTY_OTHER)

    expect(propertyB.map((group) => group.id)).toEqual([GROUP_OTHER_PROPERTY])
    expect(crossTenant).toEqual([])
  })

  it('maps who created a group, and null for a group made before it was recorded', async () => {
    const repo = createPortalGroupRepository(getDb())
    await pool.query(`UPDATE portal_groups SET created_by = 'creator-1' WHERE id = $1`, [
      GROUP_B,
    ])

    const groups = await repo.listPortalGroupsWithPortals(ORG, propertyId(PROPERTY_A))

    expect(groups.map((group) => group.createdBy)).toEqual([null, 'creator-1'])
  })
})
