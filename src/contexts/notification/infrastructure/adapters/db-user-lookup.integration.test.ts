import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { seedOrgs, setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createDbUserLookupAdapter } from './db-user-lookup.adapter'

const ORG_A = organizationId('b7000000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7000000-0000-4000-8000-000000000002')
const ADMIN_A = 'notification-user-lookup-admin-a'
const ADMIN_B = 'notification-user-lookup-admin-b'
const MANAGER_A = 'notification-user-lookup-manager-a'
const OWNER_GUARD_A = 'notification-user-lookup-owner-guard-a'
const { getPool } = setupIntegrationDb({ orgA: ORG_A, orgB: ORG_B, tables: [] })

async function resetMembers(): Promise<void> {
  // These Organization ids belong to this file. Clean by tenant rather than
  // by today's fixture ids so a renamed/older fixture cannot make an exact
  // recipient assertion depend on rows left by a previous test process.
  await getPool().query(
    `DELETE FROM member
      WHERE "organizationId" = ANY($1)
        AND "userId" <> $2`,
    [[ORG_A, ORG_B], OWNER_GUARD_A],
  )
}

async function seedMembership(
  id: string,
  orgId: string,
  role: 'owner' | 'admin',
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, id, `${id}@example.test`],
  )
  await pool.query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [`member-${orgId}-${id}`, orgId, id, role],
  )
}

beforeAll(async () => {
  // Better Auth correctly prevents deleting the final owner. Keep one stable
  // owner outside TEST_USERS so per-test cleanup can remove its owner fixture.
  // beforeAll runs before setupIntegrationDb's per-test Organization seed.
  await seedOrgs(getPool(), [ORG_A, ORG_B])
  await seedMembership(OWNER_GUARD_A, ORG_A, 'owner')
})

describe('createDbUserLookupAdapter.findByRole', () => {
  beforeEach(resetMembers)

  it('returns only current members with the requested built-in role', async () => {
    await seedMembership(ADMIN_A, ORG_A, 'owner')
    await seedMembership(MANAGER_A, ORG_A, 'admin')
    const lookup = createDbUserLookupAdapter(drizzle(getPool()) as unknown as Database)

    await expect(lookup.findByRole(ORG_A, 'AccountAdmin')).resolves.toEqual(
      expect.arrayContaining([OWNER_GUARD_A, ADMIN_A]),
    )
    await expect(lookup.findByRole(ORG_A, 'PropertyManager')).resolves.toEqual([
      MANAGER_A,
    ])
  })

  it('does not leak a multi-organization member across tenant scope', async () => {
    await seedMembership(ADMIN_B, ORG_A, 'owner')
    await seedMembership(ADMIN_B, ORG_B, 'admin')
    const lookup = createDbUserLookupAdapter(drizzle(getPool()) as unknown as Database)

    await expect(lookup.findByRole(ORG_B, 'AccountAdmin')).resolves.toEqual([])
    await expect(lookup.findByRole(ORG_B, 'PropertyManager')).resolves.toEqual([ADMIN_B])
  })
})
