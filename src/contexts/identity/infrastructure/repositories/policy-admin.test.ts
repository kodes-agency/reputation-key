// PropertyAccessGrant administration workflow against real PostgreSQL.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createPolicyAdminOps } from '../../application/use-cases/policy-admin'
import { createPolicyDiagnostic } from '#/shared/auth/policy-diagnostic'
import { hasActiveGrant } from './property-access-grant.repository'
import { getMemberRole } from './manager-membership.repository'
import { createPostgresPolicyAdminCommandStore } from '../policy-admin-command-store'

const db = getDb()
const ORG = 'org-policy-admin'
const ADMIN = 'user-padmin-admin'
const MEMBER = 'user-padmin-member'
const PROP = 'd4000000-0000-4000-8000-000000000088'
const NOW = new Date('2026-07-17T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const reconcileResponsibleManagerEligibility = vi.fn(async () => undefined)

const commandStore = createPostgresPolicyAdminCommandStore(db)
const ops = createPolicyAdminOps({
  explainPolicyDecision: createPolicyDiagnostic({
    getMemberRole: (orgId, uid) => getMemberRole(db, orgId, uid),
    hasActiveGrant: (input) => hasActiveGrant(db, input),
  }),
  commandStore,
  reconcileResponsibleManagerEligibility,
})

type GrantRow = Readonly<{
  expires_at: Date | null
  revoke_reason: string | null
  revoked: boolean
}>

/** The member's grant rows on the Property, oldest first. */
async function grantRows(): Promise<ReadonlyArray<GrantRow>> {
  const rows = await db.execute(sql`
    SELECT expires_at, revoke_reason, revoked_at IS NOT NULL AS revoked
    FROM property_access_grant
    WHERE organization_id = ${ORG} AND property_id = ${PROP}::uuid AND user_id = ${MEMBER}
    ORDER BY created_at, revoked_at NULLS LAST
  `)
  return (rows.rows as GrantRow[]).map((row) => ({
    ...row,
    expires_at: row.expires_at === null ? null : new Date(row.expires_at),
  }))
}

/** The property-access facts the Organization recorded, oldest first. */
async function accessFacts(): Promise<ReadonlyArray<Record<string, unknown>>> {
  const rows = await db.execute(sql`
    SELECT payload FROM outbox_events
    WHERE organization_id = ${ORG}
      AND event_type = 'identity.member.property_access_changed'
    ORDER BY created_at
  `)
  return rows.rows.map((row) => (row as { payload: Record<string, unknown> }).payload)
}

const grantCommand = (expiresAt?: Date) => ({
  organizationId: ORG,
  propertyId: PROP,
  userId: MEMBER,
  reason: 'covering for holiday',
  ticketRef: 'OPS-300',
  ...(expiresAt ? { expiresAt } : {}),
  actorUserId: ADMIN,
  now: NOW,
})

const hasAccessAt = (at: Date) =>
  hasActiveGrant(db, { organizationId: ORG, propertyId: PROP, userId: MEMBER, at })

async function insertLapsedGrant(): Promise<void> {
  await db.execute(sql`
    INSERT INTO property_access_grant
      (organization_id, property_id, user_id, source, created_by, expires_at)
    VALUES (${ORG}, ${PROP}, ${MEMBER}, 'operator', ${ADMIN}, ${new Date(NOW.getTime() - 60_000)})
  `)
}

async function clearOrgFixtures() {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`,
    sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`,
    sql`DELETE FROM policy_consent WHERE organization_id = ${ORG}`,
    sql`DELETE FROM properties WHERE organization_id = ${ORG}`,
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
    sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${MEMBER})`,
  ])
  await deleteTestOrganizations(db, [ORG])
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await clearOrgFixtures()
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Policy Admin Org', ${ORG}, now())`,
  )
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified") VALUES
      (${ADMIN}, 'Admin', 'user-padmin-admin@example.com', false),
      (${MEMBER}, 'Member', 'user-padmin-member@example.com', false)
  `)
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES
      ('m-padmin-1', ${ADMIN}, ${ORG}, 'owner', now()),
      ('m-padmin-2', ${MEMBER}, ${ORG}, 'member', now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROP}, ${ORG}, 'padmin-prop', 'padmin-prop', 'UTC')
  `)
})

beforeEach(async () => {
  reconcileResponsibleManagerEligibility.mockClear()
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
})

afterAll(async () => {
  await clearOrgFixtures()
  clearEventSchemas()
})

describe('PropertyAccessGrant administration', () => {
  it('grants idempotently and revokes access immediately', async () => {
    const grant = {
      organizationId: ORG,
      propertyId: PROP,
      userId: MEMBER,
      reason: 'covering for holiday',
      ticketRef: 'OPS-200',
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      actorUserId: ADMIN,
      now: NOW,
    }
    await ops.grantPropertyAccessOp(grant)
    await ops.grantPropertyAccessOp(grant)

    await expect(
      hasActiveGrant(db, {
        organizationId: ORG,
        propertyId: PROP,
        userId: MEMBER,
        at: NOW,
      }),
    ).resolves.toBe(true)
    const active = await db.execute(sql`
      SELECT count(*)::int AS count FROM property_access_grant
      WHERE organization_id = ${ORG} AND property_id = ${PROP}::uuid
        AND user_id = ${MEMBER} AND revoked_at IS NULL
    `)
    expect(active.rows[0]?.count).toBe(1)

    await ops.revokePropertyAccessOp({
      organizationId: ORG,
      propertyId: PROP,
      userId: MEMBER,
      reason: 'holiday cover ended',
      actorUserId: ADMIN,
      now: NOW,
    })
    await expect(
      hasActiveGrant(db, {
        organizationId: ORG,
        propertyId: PROP,
        userId: MEMBER,
        at: NOW,
      }),
    ).resolves.toBe(false)
    expect(reconcileResponsibleManagerEligibility).toHaveBeenCalledWith(
      ORG,
      MEMBER,
      ADMIN,
    )
  })

  it('grants again once a temporary grant has lapsed, retiring the lapsed row', async () => {
    await insertLapsedGrant()
    await expect(hasAccessAt(NOW)).resolves.toBe(false)

    await ops.grantPropertyAccessOp(grantCommand())

    await expect(hasAccessAt(NOW)).resolves.toBe(true)
    expect(
      (await grantRows()).map((row) => [row.revoke_reason, row.revoked, row.expires_at]),
    ).toEqual([
      ['superseded', true, new Date(NOW.getTime() - 60_000)],
      [null, false, null],
    ])
  })

  it.each([
    ['a later expiry', new Date(NOW.getTime() + 7 * DAY_MS)],
    ['no expiry', undefined],
  ])('extends an active temporary grant to %s', async (_label, extendedTo) => {
    const friday = new Date(NOW.getTime() + DAY_MS)
    await ops.grantPropertyAccessOp(grantCommand(friday))

    await ops.grantPropertyAccessOp(grantCommand(extendedTo))

    // The day after the first grant would have lapsed.
    await expect(hasAccessAt(new Date(friday.getTime() + DAY_MS))).resolves.toBe(true)
    expect(
      (await grantRows()).map((row) => [row.revoke_reason, row.revoked, row.expires_at]),
    ).toEqual([
      ['superseded', true, friday],
      [null, false, extendedTo ?? null],
    ])
  })

  it('records the property-access fact with each grant and revoke, and none for a repeat', async () => {
    const expiresAt = new Date(NOW.getTime() + 7 * DAY_MS)
    await ops.grantPropertyAccessOp(grantCommand(expiresAt))
    await ops.grantPropertyAccessOp(grantCommand(expiresAt))

    expect(await accessFacts()).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        memberUserId: MEMBER,
        userId: ADMIN,
        grantedPropertyIds: [PROP],
        revokedPropertyIds: [],
      }),
    ])

    const revoke = {
      organizationId: ORG,
      propertyId: PROP,
      userId: MEMBER,
      reason: 'holiday cover ended',
      actorUserId: ADMIN,
      now: NOW,
    }
    await ops.revokePropertyAccessOp(revoke)
    await ops.revokePropertyAccessOp(revoke)

    expect((await accessFacts()).slice(1)).toEqual([
      expect.objectContaining({
        memberUserId: MEMBER,
        userId: ADMIN,
        grantedPropertyIds: [],
        revokedPropertyIds: [PROP],
      }),
    ])
  })

  it('rolls the grant back when its fact cannot be recorded', async () => {
    const failing = createPolicyAdminOps({
      explainPolicyDecision: ops.explainPolicyDecision,
      commandStore: {
        ...commandStore,
        grantPropertyAccess: (command) =>
          commandStore.grantPropertyAccess({
            ...command,
            buildEvent: () => {
              throw new Error('fact unavailable')
            },
          }),
      },
    })

    await expect(failing.grantPropertyAccessOp(grantCommand())).rejects.toThrow(
      'fact unavailable',
    )

    expect(await grantRows()).toEqual([])
    expect(await accessFacts()).toEqual([])
  })

  it('rejects access for a user outside the organization', async () => {
    await expect(
      ops.grantPropertyAccessOp({
        organizationId: ORG,
        propertyId: PROP,
        userId: 'user-not-a-member',
        reason: 'not a member',
        ticketRef: 'OPS-201',
        actorUserId: ADMIN,
        now: NOW,
      }),
    ).rejects.toThrow(/member/)
  })

  it('grants nothing on a deleted Property but still revokes what it holds', async () => {
    const grant = {
      organizationId: ORG,
      propertyId: PROP,
      userId: MEMBER,
      reason: 'covering for holiday',
      ticketRef: 'OPS-202',
      actorUserId: ADMIN,
      now: NOW,
    }
    await ops.grantPropertyAccessOp(grant)
    await db.execute(
      sql`UPDATE properties SET deleted_at = now() WHERE id = ${PROP}::uuid`,
    )
    try {
      await expect(ops.grantPropertyAccessOp(grant)).rejects.toThrow(/property not found/)
      await ops.revokePropertyAccessOp({
        organizationId: ORG,
        propertyId: PROP,
        userId: MEMBER,
        reason: 'property closed',
        actorUserId: ADMIN,
        now: NOW,
      })
      await expect(
        hasActiveGrant(db, {
          organizationId: ORG,
          propertyId: PROP,
          userId: MEMBER,
          at: NOW,
        }),
      ).resolves.toBe(false)
    } finally {
      await db.execute(
        sql`UPDATE properties SET deleted_at = NULL WHERE id = ${PROP}::uuid`,
      )
    }
  })

  it('explains a decision from the stored role, without exposing identity content', async () => {
    const explain = (userId: string) =>
      ops.explainPolicyDecision({
        organizationId: ORG,
        action: 'property.read',
        propertyId: PROP,
        userId,
        now: NOW,
      })

    // The AccountAdmin is stored as `owner`; the role holds `property.read`.
    const admin = await explain(ADMIN)
    expect(admin).toMatchObject({
      allowed: true,
      reason: 'allowed',
      checks: { permission: { allowed: true }, scope: { outcome: 'organization' } },
    })
    // The retained `member` role resolves no tenant during the beta.
    await expect(explain(MEMBER)).resolves.toMatchObject({
      allowed: false,
      reason: 'beta_role_inactive',
      checks: { permission: { allowed: false } },
    })
    expect(JSON.stringify(admin)).not.toContain('@example.com')
  })
})
