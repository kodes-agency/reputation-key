// The policy diagnostic as the build wires it, against real PostgreSQL.
//
// `explainPolicyDecisionFn` is served to any AccountAdmin (`policy.admin`), so
// what the build hands it is a tenant surface: it must explain the decision the
// live policy makes for a member, and its Google permit record must be the
// asking Organization's own, never a count across Organizations.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { capabilityForPermission } from '#/shared/auth/capability-for-permission'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildIdentityContext } from './build'
import { createCapabilityRefusalReaders } from './infrastructure/repositories/capability-refusal.repository'

const db = getDb()
const ORG = 'org-policy-diagnostic-a'
const OTHER_ORG = 'org-policy-diagnostic-b'
const ADMIN = 'user-pdiag-admin'
const MANAGER = 'user-pdiag-manager'
const PROPERTY = 'd4000000-0000-4000-8000-0000000000d1'
const NOW = new Date('2026-07-17T12:00:00Z')
const ACTION = 'reply.manage'
const CAPABILITY = 'property.publish_reply'
const OWN_CORRELATION = 'pdiag-own'
const FOREIGN_CORRELATION = 'pdiag-foreign'

const policyAdmin = buildIdentityContext({
  db,
  identityPort: createInMemoryIdentityPort(),
  clock: () => NOW,
  idGen: () => '00000000-0000-4000-8000-000000000001',
  authSession: {
    setActiveOrganization: async () => {},
    updateOrganization: async () => {},
    currentOrganizationName: async () => null,
    verifyPassword: async () => false,
  },
  sendEmail: async () => {},
  baseUrl: 'https://app.example.test',
  invitationExpiresInMs: 60_000,
  propertyNames: async () => [],
  logger: createMockLogger(),
  betaFeedbackHmacSecret: 'test-beta-feedback-pseudonym-secret',
  policy: { env: {}, propertyBelongsToOrganization: async () => true },
}).policy.admin

async function admitPermits(
  organizationId: string,
  correlationId: string,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await db.execute(sql`
      INSERT INTO authorization_execution_permits
        (capability, organization_id, operation_key, route_key, route_catalog_version,
         quota_policy_id, authorization_vector, state, admitted_at, start_deadline_at,
         correlation_id)
      VALUES
        (${CAPABILITY}, ${organizationId}, ${`${correlationId}-${index}`}, 'pdiag-route',
         'pdiag-v1', 'pdiag-quota', '{}'::jsonb, 'admitted', ${NOW},
         ${new Date(NOW.getTime() + 60_000)}, ${correlationId})
    `)
  }
}

async function clearFixtures() {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM authorization_execution_permits WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
    sql`DELETE FROM property_access_grant WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
    sql`DELETE FROM properties WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
    sql`DELETE FROM member WHERE "organizationId" IN (${ORG}, ${OTHER_ORG})`,
    sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${MANAGER})`,
  ])
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
}

/** What `explainPolicyDecisionFn` does with the two built operations. */
async function explain(userId: string) {
  const explanation = await policyAdmin.explainPolicyDecision({
    organizationId: ORG,
    action: ACTION,
    propertyId: PROPERTY,
    userId,
    now: NOW,
  })
  const capabilityRefusal = await policyAdmin.explainCapabilityRefusal({
    capability: capabilityForPermission(ACTION),
    organizationId: ORG,
    propertyId: PROPERTY,
    role: 'AccountAdmin',
    userId,
    permissionScope: {
      allowed: explanation.checks.permission.allowed,
      scopeOutcome: explanation.checks.scope.outcome,
    },
  })
  return { explanation, capabilityRefusal }
}

beforeAll(async () => {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
  await clearFixtures()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt") VALUES
      (${ORG}, 'Policy Diagnostic Org', ${ORG}, now()),
      (${OTHER_ORG}, 'Other Diagnostic Org', ${OTHER_ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified") VALUES
      (${ADMIN}, 'Admin', 'user-pdiag-admin@example.com', true),
      (${MANAGER}, 'Manager', 'user-pdiag-manager@example.com', true)
  `)
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES
      ('m-pdiag-1', ${ADMIN}, ${ORG}, 'owner', now()),
      ('m-pdiag-2', ${MANAGER}, ${ORG}, 'admin', now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'pdiag-prop', 'pdiag-prop', 'UTC')
  `)
  await admitPermits(ORG, OWN_CORRELATION, 2)
  await admitPermits(OTHER_ORG, FOREIGN_CORRELATION, 3)
})

afterAll(async () => {
  await clearFixtures()
  resetCapabilityPolicyStore()
})

describe('policy diagnostic as built', () => {
  it('explains an AccountAdmin as allowed, from the stored `owner` role', async () => {
    const { explanation } = await explain(ADMIN)

    expect(explanation).toMatchObject({
      allowed: true,
      reason: 'allowed',
      capability: CAPABILITY,
      checks: { permission: { allowed: true }, scope: { outcome: 'organization' } },
    })
  })

  it('explains a PropertyManager without a grant as scope-denied, not permission-denied', async () => {
    const { explanation } = await explain(MANAGER)

    expect(explanation).toMatchObject({
      allowed: false,
      reason: 'scope_denied',
      checks: { permission: { allowed: true }, scope: { outcome: 'missing_grant' } },
    })
  })

  it("reports the asking Organization's own permit record, and no other Organization's", async () => {
    const { capabilityRefusal } = await explain(ADMIN)

    // The report got as far as the Google authorities, where the record is read.
    expect(
      capabilityRefusal.chain.find((entry) => entry.authority === 'permission_scope'),
    ).toMatchObject({ outcome: 'pass' })
    expect(capabilityRefusal.permitOutcomes).toEqual([
      {
        state: 'admitted',
        correlationId: OWN_CORRELATION,
        count: 2,
        lastAt: NOW.toISOString(),
      },
    ])
  })

  it('refuses to tally permits for a report that names no Organization', async () => {
    await expect(
      policyAdmin.explainCapabilityRefusal({
        capability: CAPABILITY,
        permissionScope: { allowed: true, scopeOutcome: 'organization' },
      }),
    ).rejects.toThrow('A tenant capability report must name its Organization')
  })

  it("keeps the operator command's tally across Organizations", async () => {
    const tally = await createCapabilityRefusalReaders(db).loadPermitOutcomes(
      CAPABILITY,
      ORG,
    )

    const seeded = tally.filter(
      (entry) =>
        entry.correlationId === OWN_CORRELATION ||
        entry.correlationId === FOREIGN_CORRELATION,
    )
    expect(seeded.map((entry) => [entry.correlationId, entry.count])).toEqual([
      [FOREIGN_CORRELATION, 3],
      [OWN_CORRELATION, 2],
    ])
  })
})
