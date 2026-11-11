import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db/index'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { fetchPermissionVersion } from '#/shared/db/role-definitions'
import {
  resolveMemberAuthContext,
  resolveMemberAuthContextWithDatabase,
} from '#/shared/auth/tenant-resolver'
import { createActiveMemberAuthResolver } from './active-member-auth.adapter'

const db = getDb()
const ORG = 'org-active-member-auth'
const OWNER = 'user-active-member-auth-owner'
const MANAGER = 'user-active-member-auth-manager'
const resolveActive = createActiveMemberAuthResolver(db)

async function cleanUp(): Promise<void> {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
    sql`DELETE FROM "user" WHERE id IN (${OWNER}, ${MANAGER})`,
    sql`DELETE FROM permission_version WHERE organization_id = ${ORG}`,
  ])
  await deleteTestOrganizations(db, [ORG])
}

beforeAll(async () => {
  await cleanUp()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Active Member Auth', ${ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified")
    VALUES
      (${OWNER}, 'Owner', 'active-member-auth-owner@example.com', false),
      (${MANAGER}, 'Manager', 'active-member-auth-manager@example.com', false)
  `)
})

beforeEach(async () => {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
  ])
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES
      ('member-active-auth-owner', ${OWNER}, ${ORG}, 'owner', now()),
      ('member-active-auth-manager', ${MANAGER}, ${ORG}, 'admin', now())
  `)
})

afterAll(cleanUp)

describe('delayed-worker member authorization on PostgreSQL', () => {
  it('gives the worker the same built-in authority a request would get', async () => {
    const worker = await resolveActive(ORG, MANAGER)
    const request = await resolveMemberAuthContext({
      memberRole: 'admin',
      organizationId: ORG,
      userId: MANAGER,
    })

    if (!worker) throw new Error('worker authorization missing')
    expect(worker.role).toBe('PropertyManager')
    expect([...(worker.effectivePermissions ?? [])].sort()).toEqual(
      [...(request.context.effectivePermissions ?? [])].sort(),
    )
    expect([...(worker.scopeByPermission ?? [])].sort()).toEqual(
      [...(request.context.scopeByPermission ?? [])].sort(),
    )
  })

  it('refuses a member removed after the work was queued', async () => {
    expect(await resolveActive(ORG, MANAGER)).not.toBeNull()

    await db.execute(
      sql`DELETE FROM member WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
    )

    expect(await resolveActive(ORG, MANAGER)).toBeNull()
  })

  it('sees a role change on the very next call, with no cached authority', async () => {
    expect((await resolveActive(ORG, MANAGER))?.role).toBe('PropertyManager')

    await db.execute(
      sql`UPDATE member SET role = 'owner' WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
    )

    expect((await resolveActive(ORG, MANAGER))?.role).toBe('AccountAdmin')
  })

  it('refuses a member whose role is not built in', async () => {
    await db.execute(
      sql`UPDATE member SET role = 'content-manager' WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
    )

    await expect(resolveActive(ORG, MANAGER)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('does not resolve one organization membership under another organization', async () => {
    expect(await resolveActive('org-active-member-auth-other', MANAGER)).toBeNull()
  })

  it('stamps the permission version, which moves when membership changes', async () => {
    const before = await resolveMemberAuthContextWithDatabase(db, {
      memberRole: 'admin',
      organizationId: ORG,
      userId: MANAGER,
    })
    expect(before.permissionVersion).toBe(await fetchPermissionVersion(db, ORG))

    await db.execute(
      sql`DELETE FROM member WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
    )

    expect(await fetchPermissionVersion(db, ORG)).toBeGreaterThan(
      before.permissionVersion,
    )
  })

  it('reads the version inside the caller transaction snapshot', async () => {
    const committed = await fetchPermissionVersion(db, ORG)

    const stamped = await db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE member SET role = 'owner' WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
      )
      const inside = await resolveMemberAuthContextWithDatabase(tx, {
        memberRole: 'owner',
        organizationId: ORG,
        userId: MANAGER,
      })
      return inside.permissionVersion
    })

    expect(stamped).toBeGreaterThan(committed)
    expect(await fetchPermissionVersion(db, ORG)).toBe(stamped)
  })
})
