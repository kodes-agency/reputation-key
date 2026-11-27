import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db/index'
import type { ManagerMembership } from './auth-identity.port.server'
import {
  createManagerMembershipRepository,
  prepareManagerPropertyAuthority,
} from './manager-membership-repository.server'

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
          async () =>
            ({ memberRole }) =>
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
          async () => () => null,
        ).listActiveManagers(organization)
        throw rollback
      }),
    ).rejects.toBe(rollback)

    expect(rows).toEqual([])
  })

  it('reads the permission version once for every manager of the Organization', async () => {
    const suffix = randomUUID()
    const organization = `org-manager-once-${suffix}`
    const users = [1, 2, 3, 4].map((n) => `manager-once-${n}-${suffix}`) as [
      string,
      string,
      string,
      string,
    ]
    const rollback = new Error('rollback manager once fixture')
    let rows: readonly ManagerMembership[] = []
    let permissionReads = 0

    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO organization (id, name, slug, "createdAt")
          VALUES (${organization}, ${organization}, ${organization}, NOW())
        `)
        for (const id of users) {
          await tx.execute(sql`
            INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
            VALUES (${id}, ${id}, ${`${id}@example.test`}, true, NOW(), NOW())
          `)
        }
        await tx.execute(sql`
          INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES
            (${`membership-once-0-${suffix}`}, ${users[0]}, ${organization}, 'owner', NOW()),
            (${`membership-once-1-${suffix}`}, ${users[1]}, ${organization}, 'admin', NOW()),
            (${`membership-once-2-${suffix}`}, ${users[2]}, ${organization}, 'admin', NOW()),
            (${`membership-once-3-${suffix}`}, ${users[3]}, ${organization}, 'admin', NOW())
        `)

        // The authority reads through this wrapper; the member list reads through tx.
        const countingDb = {
          select: (...args: Parameters<typeof tx.select>) => {
            permissionReads += 1
            return tx.select(...args)
          },
        } as unknown as Database
        rows = await createManagerMembershipRepository(
          tx as unknown as Database,
          prepareManagerPropertyAuthority(countingDb),
        ).listActiveManagers(organization)
        throw rollback
      }),
    ).rejects.toBe(rollback)

    expect(permissionReads).toBe(1)
    expect(rows).toHaveLength(4)
    expect(
      Object.fromEntries(rows.map((row) => [row.userId, row.propertyAccessScope])),
    ).toEqual({
      [users[0]]: 'organization',
      [users[1]]: 'assigned-properties',
      [users[2]]: 'assigned-properties',
      [users[3]]: 'assigned-properties',
    })
  })

  it('fails closed with the tenant resolver error when the permission row is unreadable', async () => {
    const suffix = randomUUID()
    const organization = `org-manager-unreadable-${suffix}`
    const owner = `manager-unreadable-${suffix}`
    const rollback = new Error('rollback manager unreadable fixture')
    let failure: unknown

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
          VALUES (${`membership-unreadable-${suffix}`}, ${owner}, ${organization}, 'owner', NOW())
        `)

        const brokenDb = {
          select: () => {
            throw new Error('permission row unreadable')
          },
        } as unknown as Database
        failure = await createManagerMembershipRepository(
          tx as unknown as Database,
          prepareManagerPropertyAuthority(brokenDb),
        )
          .listActiveManagers(organization)
          .catch((err: unknown) => err)
        throw rollback
      }),
    ).rejects.toBe(rollback)

    expect(failure).toMatchObject({
      name: 'AuthError',
      code: 'authorization_unavailable',
      status: 503,
      message: 'Authorization resolution failed',
    })
  })

  it('does not read the permission row for an Organization without managers', async () => {
    const suffix = randomUUID()
    const organization = `org-manager-none-${suffix}`
    const rollback = new Error('rollback manager none fixture')
    let rows: readonly ManagerMembership[] = []
    let permissionReads = 0

    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO organization (id, name, slug, "createdAt")
          VALUES (${organization}, ${organization}, ${organization}, NOW())
        `)
        const countingDb = {
          select: (...args: Parameters<typeof tx.select>) => {
            permissionReads += 1
            return tx.select(...args)
          },
        } as unknown as Database
        rows = await createManagerMembershipRepository(
          tx as unknown as Database,
          prepareManagerPropertyAuthority(countingDb),
        ).listActiveManagers(organization)
        throw rollback
      }),
    ).rejects.toBe(rollback)

    expect(rows).toEqual([])
    expect(permissionReads).toBe(0)
  })

  it('recognizes only the current AccountAdmin membership in the requested tenant', async () => {
    const suffix = randomUUID()
    const organization = `org-account-admin-${suffix}`
    const otherOrganization = `org-account-admin-other-${suffix}`
    const owner = `account-admin-${suffix}`
    const manager = `property-manager-${suffix}`
    const otherOwner = `other-account-admin-${suffix}`
    const rollback = new Error('rollback account-admin authority fixture')
    let decisions: readonly boolean[] = []

    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO organization (id, name, slug, "createdAt") VALUES
            (${organization}, ${organization}, ${organization}, NOW()),
            (${otherOrganization}, ${otherOrganization}, ${otherOrganization}, NOW())
        `)
        for (const id of [owner, manager, otherOwner]) {
          await tx.execute(sql`
            INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
            VALUES (${id}, ${id}, ${`${id}@example.test`}, true, NOW(), NOW())
          `)
        }
        await tx.execute(sql`
          INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES
            (${`membership-owner-${suffix}`}, ${owner}, ${organization}, 'owner', NOW()),
            (${`membership-manager-${suffix}`}, ${manager}, ${organization}, 'admin', NOW()),
            (${`membership-other-owner-${suffix}`}, ${otherOwner}, ${otherOrganization}, 'owner', NOW())
        `)

        const repository = createManagerMembershipRepository(
          tx as unknown as Database,
          async () => () => 'organization',
        )
        decisions = [
          await repository.isCurrentAccountAdmin({
            organizationId: organization,
            userId: owner,
          }),
          await repository.isCurrentAccountAdmin({
            organizationId: organization,
            userId: manager,
          }),
          await repository.isCurrentAccountAdmin({
            organizationId: organization,
            userId: otherOwner,
          }),
          await repository.isCurrentAccountAdmin({
            organizationId: organization,
            userId: `missing-${suffix}`,
          }),
        ]
        throw rollback
      }),
    ).rejects.toBe(rollback)

    expect(decisions).toEqual([true, false, false, false])
  })
})
