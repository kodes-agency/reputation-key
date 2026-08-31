// BQC-2.7 — policy administration workflow (real PostgreSQL).
//
// Authenticated, least-privilege policy operations (phase BQC-2 §2.7):
// allowlist, suspension, grant, revocation — each requiring reason (and a
// ticket/reference where applicable), each writing an audit outcome. Plus a
// read-only decision diagnostic that explains decisions without PII or
// secret configuration.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createPolicyAdminOps } from '../../application/use-cases/policy-admin'
import {
  createPolicyDiagnostic,
  createRegionDiagnostic,
} from '#/shared/auth/policy-diagnostic'
import {
  createProcessingRouter,
  providerRefForCell,
} from '#/shared/routing/processing-router'
import { createPropertyRoutingLoader } from '#/contexts/property/infrastructure/property-routing.adapter'
import { createPropertyRegionLoader } from '#/contexts/property/infrastructure/property-region-loader'
import {
  isCoreCapability,
  isBlockedCapability,
  listAllCapabilities,
  type Capability,
} from '#/shared/auth/beta-capabilities'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import {
  getMemberRole,
  loadOrgPolicyState,
  loadPolicySnapshot,
} from './policy-state.repository'
import {
  hasActiveGrant,
  listActiveGrantsForOrg,
} from './property-access-grant.repository'
import { writePolicyDecision } from './policy-decision-audit.repository'
import { createPostgresPolicyAdminCommandStore } from '../policy-admin-command-store'

const db = getDb()
const ORG = 'org-policy-admin'
const ADMIN = 'user-padmin-admin'
const MEMBER = 'user-padmin-member'
const PROP = 'd4000000-0000-4000-8000-000000000088'
const NOW = new Date('2026-07-17T12:00:00Z')
const reconcileResponsibleManagerEligibility = vi.fn(async () => undefined)

const ops = createPolicyAdminOps({
  clock: () => NOW,
  isCoreCapability: (cap) => isCoreCapability(cap as Capability),
  isBlockedCapability: (cap) => isBlockedCapability(cap as Capability),
  listAllCapabilities,
  policyVersion: EXECUTION_POLICY_VERSION,
  explainPolicyDecision: createPolicyDiagnostic({
    getMemberRole: (orgId, uid) => getMemberRole(db, orgId, uid),
    hasActiveGrant: (input) => hasActiveGrant(db, input),
  }),
  getRegionDiagnostic: createRegionDiagnostic({
    loadPropertyRegion: createPropertyRegionLoader({ db }),
    resolveRouting: (propertyId) =>
      createProcessingRouter({
        loadPropertyRouting: createPropertyRoutingLoader({ db }),
      }).resolve({ kind: 'property', propertyId: propertyId }, 'review.sync'),
    cell: 'us',
    providerRef: providerRefForCell('us') ?? null,
  }),
  refreshPolicy: async () => {},
  commandStore: createPostgresPolicyAdminCommandStore(db),
  loadOrgPolicyState: (orgId) => loadOrgPolicyState(db, orgId),
  reconcileResponsibleManagerEligibility,
  listActiveGrantsForOrg: (orgId, at) => listActiveGrantsForOrg(db, orgId, at),
  writePolicyDecision: (entry) => writePolicyDecision(db, entry),
})

async function auditRows(): Promise<Array<Record<string, unknown>>> {
  const rows = await db.execute(
    sql`SELECT actor_type, actor_id, property_id, action, capability, decision, reason, execution_kind
        FROM policy_decision_audit WHERE organization_id = ${ORG} ORDER BY occurred_at, id`,
  )
  return rows.rows as Array<Record<string, unknown>>
}

// Teardown DELETEs run with user triggers disabled: the deployed
// guard_last_owner backstop blocks deleting an org's final owner row,
// including fixture cleanup (cascades from organization fire it too).
async function clearOrgFixtures() {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`,
    sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`,
    sql`DELETE FROM policy_consent WHERE organization_id = ${ORG}`,
    sql`DELETE FROM organization_capability WHERE organization_id = ${ORG}`,
    sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`,
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

afterAll(async () => {
  await clearOrgFixtures()
})

describe('policy administration (BQC-2.7)', () => {
  it('rolls the policy row and version back when the required audit write fails', async () => {
    const before = await loadPolicySnapshot(db)
    const store = createPostgresPolicyAdminCommandStore(db, {
      writeAudit: async () => {
        throw new Error('injected policy audit failure')
      },
    })

    await expect(
      store.setOrganizationCapability({
        organizationId: ORG,
        capability: 'portal.read',
        enabled: true,
        createdBy: ADMIN,
        audit: {
          actorType: 'operator',
          actorId: ADMIN,
          organizationId: ORG,
          propertyId: null,
          action: 'policy.allowlist.set',
          capability: 'portal.read',
          executionKind: 'operator',
          decision: 'allow',
          reason: 'fault-injection atomicity proof',
          policyVersion: EXECUTION_POLICY_VERSION,
          correlationId: null,
        },
      }),
    ).rejects.toThrow('injected policy audit failure')

    const after = await loadPolicySnapshot(db)
    expect(after.version).toBe(before.version)
    expect(
      after.orgCapabilities.some(
        (row) => row.organizationId === ORG && row.capability === 'portal.read',
      ),
    ).toBe(false)
  })

  it('allowlist: non-core capability can be enabled/disabled with reason + audit', async () => {
    await ops.setOrgCapability({
      organizationId: ORG,
      capability: 'portal.read',
      enabled: true,
      reason: 'pilot portal evaluation',
      actorUserId: ADMIN,
      now: NOW,
    })
    let snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.orgCapabilities.some(
        (c) => c.organizationId === ORG && c.capability === 'portal.read',
      ),
    ).toBe(true)

    await ops.setOrgCapability({
      organizationId: ORG,
      capability: 'portal.read',
      enabled: false,
      reason: 'pilot ended',
      actorUserId: ADMIN,
      now: NOW,
    })
    snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.orgCapabilities.some(
        (c) => c.organizationId === ORG && c.capability === 'portal.read',
      ),
    ).toBe(false)
  })

  it('allowlist: non-core capability can be enabled/disabled for one tenant Property with audit', async () => {
    await ops.setPropertyCapability({
      organizationId: ORG,
      propertyId: PROP,
      capability: 'property.read_gbp_performance',
      enabled: true,
      reason: 'approved Performance canary',
      actorUserId: ADMIN,
      now: NOW,
    })

    let snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.propertyCapabilities.some(
        (c) => c.propertyId === PROP && c.capability === 'property.read_gbp_performance',
      ),
    ).toBe(true)
    expect(await auditRows()).toContainEqual(
      expect.objectContaining({
        actor_id: ADMIN,
        property_id: PROP,
        action: 'policy.property.allowlist.set',
        capability: 'property.read_gbp_performance',
        reason: 'approved Performance canary',
      }),
    )

    await ops.setPropertyCapability({
      organizationId: ORG,
      propertyId: PROP,
      capability: 'property.read_gbp_performance',
      enabled: false,
      reason: 'Performance canary complete',
      actorUserId: ADMIN,
      now: NOW,
    })

    snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.propertyCapabilities.some(
        (c) => c.propertyId === PROP && c.capability === 'property.read_gbp_performance',
      ),
    ).toBe(false)
  })

  it('allowlist: rejects a Property outside the tenant before policy mutation', async () => {
    const before = await loadPolicySnapshot(db)

    await expect(
      ops.setPropertyCapability({
        organizationId: ORG,
        propertyId: 'd4000000-0000-4000-8000-000000000099',
        capability: 'property.read_gbp_performance',
        enabled: true,
        reason: 'must remain tenant scoped',
        actorUserId: ADMIN,
        now: NOW,
      }),
    ).rejects.toThrow('property not found in organization')

    const after = await loadPolicySnapshot(db)
    expect(after.propertyCapabilities).toEqual(before.propertyCapabilities)
  })

  it('allowlist rejects core and blocked capabilities (no-op prevention)', async () => {
    await expect(
      ops.setOrgCapability({
        organizationId: ORG,
        capability: 'property.create',
        enabled: true,
        reason: 'pointless',
        actorUserId: ADMIN,
        now: NOW,
      }),
    ).rejects.toThrow(/core/)
    await expect(
      ops.setOrgCapability({
        organizationId: ORG,
        capability: 'gbp.reply.auto_publish',
        enabled: true,
        reason: 'must stay blocked',
        actorUserId: ADMIN,
        now: NOW,
      }),
    ).rejects.toThrow(/blocked/)
    await expect(
      ops.setOrgCapability({
        organizationId: ORG,
        capability: 'portal.read',
        enabled: true,
        reason: '',
        actorUserId: ADMIN,
        now: NOW,
      }),
    ).rejects.toThrow(/reason/)
  })

  it('suspension: org + property with reason and ticket', async () => {
    await ops.setOrgSuspension({
      organizationId: ORG,
      suspend: true,
      reason: 'billing hold',
      ticketRef: 'OPS-100',
      actorUserId: ADMIN,
      now: NOW,
    })
    let snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.orgPolicies.find((p) => p.organizationId === ORG)?.suspendedReason,
    ).toBe('billing hold')

    await ops.setPropertySuspension({
      organizationId: ORG,
      propertyId: PROP,
      suspend: true,
      reason: 'quality review',
      ticketRef: 'OPS-101',
      actorUserId: ADMIN,
      now: NOW,
    })
    snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.propertyPolicies.find((p) => p.propertyId === PROP)?.suspendedReason,
    ).toBe('quality review')

    await expect(
      ops.setPropertySuspension({
        organizationId: ORG,
        propertyId: 'd4000000-0000-4000-8000-000000000099',
        suspend: true,
        reason: 'cross-tenant containment probe',
        ticketRef: 'OPS-102',
        actorUserId: ADMIN,
        now: NOW,
      }),
    ).rejects.toThrow(/property not found in organization/)

    await ops.setOrgSuspension({
      organizationId: ORG,
      suspend: false,
      reason: 'billing resolved',
      ticketRef: 'OPS-100',
      actorUserId: ADMIN,
      now: NOW,
    })
    snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.orgPolicies.find((p) => p.organizationId === ORG)?.suspendedAt,
    ).toBeNull()

    await expect(
      ops.setOrgSuspension({
        organizationId: ORG,
        suspend: true,
        reason: 'no ticket',
        ticketRef: '',
        actorUserId: ADMIN,
        now: NOW,
      }),
    ).rejects.toThrow(/ticket/)
  })

  it('grants: reason + ticket + optional expiry; revoke with reason', async () => {
    await expect(
      ops.grantPropertyAccessOp({
        organizationId: ORG,
        propertyId: PROP,
        userId: MEMBER,
        reason: '',
        ticketRef: 'OPS-200',
        actorUserId: ADMIN,
        now: NOW,
      }),
    ).rejects.toThrow(/reason/)

    await ops.grantPropertyAccessOp({
      organizationId: ORG,
      propertyId: PROP,
      userId: MEMBER,
      reason: 'covering for holiday',
      ticketRef: 'OPS-200',
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
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
    ).resolves.toBe(true)

    // A client retry converges on the existing unrevoked grant while still
    // recording the retried operator decision atomically.
    await ops.grantPropertyAccessOp({
      organizationId: ORG,
      propertyId: PROP,
      userId: MEMBER,
      reason: 'covering for holiday',
      ticketRef: 'OPS-200',
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      actorUserId: ADMIN,
      now: NOW,
    })
    const activeGrantCount = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM property_access_grant
      WHERE organization_id = ${ORG}
        AND property_id = ${PROP}::uuid
        AND user_id = ${MEMBER}
        AND revoked_at IS NULL
    `)
    expect(activeGrantCount.rows[0]?.count).toBe(1)

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

    // A retry after a downstream reconciliation failure still re-runs the
    // idempotent cleanup even though the grant is already revoked.
    reconcileResponsibleManagerEligibility.mockClear()
    await ops.revokePropertyAccessOp({
      organizationId: ORG,
      propertyId: PROP,
      userId: MEMBER,
      reason: 'holiday cover ended',
      actorUserId: ADMIN,
      now: NOW,
    })
    expect(reconcileResponsibleManagerEligibility).toHaveBeenCalledOnce()
  })

  it('grant requires org membership (no phantom access)', async () => {
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

  it('every admin action wrote a content-free audit outcome', async () => {
    const rows = await auditRows()
    expect(rows.length).toBeGreaterThanOrEqual(6)
    for (const row of rows) {
      expect(row.actor_type).toBe('operator')
      expect(row.execution_kind).toBe('operator')
      expect(row.decision).toBe('allow')
    }
    const actions = rows.map((r) => `${r.action}:${r.reason}`)
    expect(actions).toContain('policy.allowlist.set:pilot portal evaluation')
    expect(actions).toContain('policy.org.suspend:billing hold (OPS-100)')
    expect(actions).toContain('policy.property.suspend:quality review (OPS-101)')
    expect(actions).toContain('policy.grant:covering for holiday (OPS-200)')
    expect(actions).toContain('policy.revoke:holiday cover ended')
  })

  it('read-only diagnostic explains a decision without PII or secrets', async () => {
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
      capability: 'property.create',
      checks: {
        capability: expect.objectContaining({ allowed: expect.any(Boolean) }),
        scope: expect.objectContaining({ outcome: expect.any(String) }),
      },
    })
    // Content-free: no emails, names, env values, or secrets.
    const serialized = JSON.stringify(explanation)
    expect(serialized).not.toContain('@example.com')
    expect(serialized).not.toContain('BETA_')
    expect(serialized).not.toContain('Member')
  })
})
