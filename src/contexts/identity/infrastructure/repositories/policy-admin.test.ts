// PropertyAccessGrant administration workflow against real PostgreSQL.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
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
const reconcileResponsibleManagerEligibility = vi.fn(async () => undefined)

const ops = createPolicyAdminOps({
  explainPolicyDecision: createPolicyDiagnostic({
    getMemberRole: (orgId, uid) => getMemberRole(db, orgId, uid),
    hasActiveGrant: (input) => hasActiveGrant(db, input),
  }),
  commandStore: createPostgresPolicyAdminCommandStore(db),
  reconcileResponsibleManagerEligibility,
})

async function clearOrgFixtures() {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`,
    sql`DELETE FROM policy_consent WHERE organization_id = ${ORG}`,
    sql`DELETE FROM properties WHERE organization_id = ${ORG}`,
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
    sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${MEMBER})`,
  ])
  await deleteTestOrganizations(db, [ORG])
}

beforeAll(async () => {
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
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
})

afterAll(clearOrgFixtures)

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

  it('explains a decision without exposing identity content', async () => {
    const explanation = await ops.explainPolicyDecision({
      organizationId: ORG,
      action: 'property.read',
      propertyId: PROP,
      userId: MEMBER,
      now: NOW,
    })
    expect(explanation).toMatchObject({
      allowed: expect.any(Boolean),
      reason: expect.any(String),
      checks: {
        capability: expect.objectContaining({ allowed: expect.any(Boolean) }),
        scope: expect.objectContaining({ outcome: expect.any(String) }),
      },
    })
    expect(JSON.stringify(explanation)).not.toContain('@example.com')
  })
})
