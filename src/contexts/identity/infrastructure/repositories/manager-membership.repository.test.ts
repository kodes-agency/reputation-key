import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import type { ManagerMembership } from '../../application/public-api'
import { createManagerMembershipRepository } from './manager-membership.repository'

describe('manager membership repository', () => {
  it('maps only exact Better Auth manager roles in the requested tenant', async () => {
    const suffix = randomUUID()
    const organization = `org-manager-membership-${suffix}`
    const otherOrganization = `org-manager-membership-other-${suffix}`
    const owner = `manager-owner-${suffix}`
    const admin = `manager-admin-${suffix}`
    const ordinary = `ordinary-member-${suffix}`
    const combined = `combined-role-${suffix}`
    const otherOwner = `other-owner-${suffix}`
    const rollback = new Error('rollback manager membership fixture')
    let rows: readonly ManagerMembership[] = []

    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO organization (id, name, slug, "createdAt") VALUES
            (${organization}, ${organization}, ${organization}, NOW()),
            (${otherOrganization}, ${otherOrganization}, ${otherOrganization}, NOW())
        `)
        for (const id of [owner, admin, ordinary, combined, otherOwner]) {
          await tx.execute(sql`
            INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
            VALUES (${id}, ${id}, ${`${id}@example.test`}, true, NOW(), NOW())
          `)
        }
        await tx.execute(sql`
          INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES
            (${`membership-owner-${suffix}`}, ${owner}, ${organization}, 'owner', NOW()),
            (${`membership-admin-${suffix}`}, ${admin}, ${organization}, 'admin', NOW()),
            (${`membership-member-${suffix}`}, ${ordinary}, ${organization}, 'member', NOW()),
            (${`membership-combined-${suffix}`}, ${combined}, ${organization}, 'owner,admin', NOW()),
            (${`membership-other-${suffix}`}, ${otherOwner}, ${otherOrganization}, 'owner', NOW())
        `)

        rows = await createManagerMembershipRepository(
          tx as unknown as Database,
          async ({ memberRole }) =>
            memberRole === 'owner' ? 'organization' : 'assigned-properties',
        ).listActiveManagers(organization)
        throw rollback
      }),
    ).rejects.toBe(rollback)

    expect([...rows].sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      {
        userId: admin,
        role: 'PropertyManager',
        propertyAccessScope: 'assigned-properties',
      },
      { userId: owner, role: 'AccountAdmin', propertyAccessScope: 'organization' },
    ])
  })

  it('fails closed when current Property authority no longer grants a usable scope', async () => {
    const suffix = randomUUID()
    const organization = `org-manager-authority-${suffix}`
    const owner = `manager-authority-owner-${suffix}`
    const rollback = new Error('rollback manager authority fixture')
    let rows: readonly ManagerMembership[] = []

    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO organization (id, name, slug, "createdAt")
          VALUES (${organization}, ${organization}, ${organization}, NOW())
        `)
        await tx.execute(sql`
          INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
          VALUES (${owner}, ${owner}, ${`${owner}@example.test`}, true, NOW(), NOW())
        `)
        await tx.execute(sql`
          INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
          VALUES (${`membership-authority-${suffix}`}, ${owner}, ${organization}, 'owner', NOW())
        `)

        rows = await createManagerMembershipRepository(
          tx as unknown as Database,
          async () => null,
        ).listActiveManagers(organization)
        throw rollback
      }),
    ).rejects.toBe(rollback)

    expect(rows).toEqual([])
  })
})
