import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId } from '#/shared/domain/ids'
import type { Database } from './index'
import {
  authorizeUserOrganizationMembership,
  readUserOrganizationMemberships,
} from './user-organization-membership'

const ORG_A = organizationId('b7500000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7500000-0000-4000-8000-000000000002')
const USER_ID = 'membership-evidence-user'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [],
})

const database = () => drizzle(getPool()) as unknown as Database

async function clearUser(): Promise<void> {
  await getPool().query('DELETE FROM member WHERE "userId" = $1', [USER_ID])
  await getPool().query('DELETE FROM "user" WHERE id = $1', [USER_ID])
}

beforeEach(async () => {
  await clearUser()
  await getPool().query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Membership Evidence', $2, true, NOW(), NOW())`,
    [USER_ID, `${USER_ID}@example.test`],
  )
})

afterEach(clearUser)

async function seedMembership(id: string, organization: string): Promise<void> {
  await getPool().query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'member', NOW())`,
    [id, USER_ID, organization],
  )
}

describe('database-backed Better Auth Organization membership', () => {
  it('reads memberships directly from Better Auth', async () => {
    await seedMembership('membership-evidence-a', ORG_A)

    await expect(readUserOrganizationMemberships(database(), USER_ID)).resolves.toEqual([
      ORG_A,
    ])
  })

  it('authorizes only a single exact membership', async () => {
    await seedMembership('membership-evidence-a', ORG_A)
    await expect(
      authorizeUserOrganizationMembership(database(), USER_ID, ORG_A),
    ).resolves.toEqual({ kind: 'allow' })
    await expect(
      authorizeUserOrganizationMembership(database(), USER_ID, ORG_B),
    ).resolves.toEqual({
      kind: 'deny',
      reason: 'organization_membership_mismatch',
    })

    await seedMembership('membership-evidence-b', ORG_B)
    await expect(
      authorizeUserOrganizationMembership(database(), USER_ID, ORG_A),
    ).resolves.toEqual({
      kind: 'deny',
      reason: 'organization_membership_ambiguous',
    })
  })

  it('fails closed when no membership exists', async () => {
    await expect(
      authorizeUserOrganizationMembership(database(), 'missing-user', ORG_A),
    ).resolves.toEqual({
      kind: 'deny',
      reason: 'organization_membership_missing',
    })
  })
})
