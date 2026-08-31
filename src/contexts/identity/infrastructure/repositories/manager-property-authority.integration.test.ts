import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { Permission } from '#/shared/domain/permissions'
import { decideCurrentManagerPropertyAuthority } from './member-property-authority'

const db = getDb()
const ORG = 'org-inbox-assignee-identity-authority'
const OWNER = 'user-inbox-assignee-owner'
const MANAGER = 'user-inbox-assignee-manager'
const STAFF = 'user-inbox-assignee-staff'
const PROPERTY = '4b000000-0000-4000-8000-000000000001'
const MUTATION_FIRST_SESSION = 'ibx-assignee-identity-mutation-first'

async function waitForSessionLock(applicationName: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const waiting = await getPool().query(
      `SELECT 1
       FROM pg_stat_activity
       WHERE application_name = $1
         AND wait_event_type = 'Lock'`,
      [applicationName],
    )
    if (waiting.rowCount === 1) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`session ${applicationName} did not reach its lock wait`)
}

function decide(
  userId: string,
  permissions: readonly Permission[] = ['inbox.read', 'inbox.write'],
) {
  return db.transaction((tx) =>
    decideCurrentManagerPropertyAuthority(tx, {
      organizationId: ORG,
      propertyId: PROPERTY,
      userId,
      permissions,
      at: new Date(),
    }),
  )
}

beforeAll(async () => {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
    sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`,
    sql`DELETE FROM properties WHERE organization_id = ${ORG}`,
    sql`DELETE FROM "user" WHERE id IN (${OWNER}, ${MANAGER}, ${STAFF})`,
    sql`DELETE FROM permission_version WHERE organization_id = ${ORG}`,
  ])
  await deleteTestOrganizations(db, [ORG])

  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Inbox Assignee Authority', ${ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified")
    VALUES
      (${OWNER}, 'Inbox Owner', 'inbox-assignee-owner@example.com', false),
      (${MANAGER}, 'Inbox Manager', 'inbox-assignee-manager@example.com', false),
      (${STAFF}, 'Inbox Staff', 'inbox-assignee-staff@example.com', false)
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'Inbox Authority Property', 'inbox-authority-property', 'UTC')
  `)
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES
      ('member-inbox-assignee-owner', ${OWNER}, ${ORG}, 'owner', now()),
      ('member-inbox-assignee-manager', ${MANAGER}, ${ORG}, 'admin', now()),
      ('member-inbox-assignee-staff', ${STAFF}, ${ORG}, 'member', now())
  `)
})

beforeEach(async () => {
  await db.execute(sql`
    UPDATE member
    SET role = CASE "userId"
      WHEN ${OWNER} THEN 'owner'
      WHEN ${MANAGER} THEN 'admin'
      ELSE 'member'
    END
    WHERE "organizationId" = ${ORG}
  `)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`
    INSERT INTO property_access_grant (
      organization_id, property_id, user_id, source, created_by
    ) VALUES (${ORG}, ${PROPERTY}::uuid, ${MANAGER}, 'operator', 'test')
  `)
})

afterAll(async () => {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
    sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`,
    sql`DELETE FROM properties WHERE organization_id = ${ORG}`,
    sql`DELETE FROM "user" WHERE id IN (${OWNER}, ${MANAGER}, ${STAFF})`,
    sql`DELETE FROM permission_version WHERE organization_id = ${ORG}`,
  ])
  await deleteTestOrganizations(db, [ORG])
})

describe.sequential('current manager Property authority', () => {
  it('allows an AccountAdmin without a Property grant and returns canonical authority', async () => {
    await expect(decide(OWNER)).resolves.toEqual({
      allowed: true,
      role: 'AccountAdmin',
      scope: 'organization',
      requiresStaffParticipation: false,
    })
  })

  it('allows a PropertyManager only through one current Property grant', async () => {
    await expect(decide(MANAGER)).resolves.toEqual({
      allowed: true,
      role: 'PropertyManager',
      scope: 'assigned-properties',
      requiresStaffParticipation: true,
    })
  })

  it('denies a Staff member at the manager-role boundary', async () => {
    await expect(decide(STAFF)).resolves.toEqual({
      allowed: false,
      reason: 'manager_role_denied',
    })
  })

  it('denies the command when any required permission is absent', async () => {
    await expect(decide(MANAGER, ['inbox.read', 'member.update'])).resolves.toEqual({
      allowed: false,
      reason: 'permission_denied',
    })
  })

  it('lets a mutation holding the grant finish before deciding current authority', async () => {
    const mutator = await getPool().connect()
    let mutationOpen = false
    let authorityTransaction: ReturnType<typeof decide> | undefined

    try {
      await mutator.query('BEGIN')
      mutationOpen = true
      await mutator.query(
        `SELECT id
         FROM property_access_grant
         WHERE organization_id = $1
           AND property_id = $2::uuid
           AND user_id = $3
           AND revoked_at IS NULL
         FOR UPDATE`,
        [ORG, PROPERTY, MANAGER],
      )

      authorityTransaction = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('application_name', ${MUTATION_FIRST_SESSION}, true)`,
        )
        return decideCurrentManagerPropertyAuthority(tx, {
          organizationId: ORG,
          propertyId: PROPERTY,
          userId: MANAGER,
          permissions: ['inbox.read', 'inbox.write'],
          at: new Date(),
        })
      })
      void authorityTransaction.catch(() => undefined)
      await waitForSessionLock(MUTATION_FIRST_SESSION)

      await mutator.query(
        `UPDATE property_access_grant
         SET revoked_at = now()
         WHERE organization_id = $1
           AND property_id = $2::uuid
           AND user_id = $3
           AND revoked_at IS NULL`,
        [ORG, PROPERTY, MANAGER],
      )
      await mutator.query('COMMIT')
      mutationOpen = false

      await expect(authorityTransaction).resolves.toEqual({
        allowed: false,
        reason: 'assignment_denied',
      })
    } finally {
      if (mutationOpen) await mutator.query('ROLLBACK').catch(() => undefined)
      mutator.release()
      await authorityTransaction?.catch(() => undefined)
    }
  })
})
