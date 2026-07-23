// BQC-2.7 — policy administration workflow (real PostgreSQL).
//
// Authenticated, least-privilege policy operations (phase BQC-2 §2.7):
// allowlist, suspension, grant, revocation — each requiring reason (and a
// ticket/reference where applicable), each writing an audit outcome. Plus a
// read-only decision diagnostic that explains decisions without PII or
// secret configuration.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
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
  setOrganizationPolicy,
  setPropertyPolicy,
  addOrganizationCapability,
  removeOrganizationCapability,
  isOrgMember,
  getMemberRole,
  loadOrgPolicyState,
  loadPolicySnapshot,
} from './policy-state.repository'
import {
  grantPropertyAccess,
  revokePropertyAccess,
  hasActiveGrant,
  listActiveGrantsForOrg,
} from './property-access-grant.repository'
import { writePolicyDecision } from './policy-decision-audit.repository'

const db = getDb()
const ORG = 'org-policy-admin'
const ADMIN = 'user-padmin-admin'
const MEMBER = 'user-padmin-member'
const PROP = 'd4000000-0000-4000-8000-000000000088'
const NOW = new Date('2026-07-17T12:00:00Z')

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
        cell: 'us',
      }).resolve(propertyId, 'review.sync'),
    cell: 'us',
    providerRef: providerRefForCell('us') ?? null,
  }),
  setOrganizationPolicy: (input) => setOrganizationPolicy(db, input),
  setPropertyPolicy: (input) => setPropertyPolicy(db, input),
  addOrganizationCapability: (orgId, cap, by) =>
    addOrganizationCapability(db, orgId, cap, by),
  removeOrganizationCapability: (orgId, cap) =>
    removeOrganizationCapability(db, orgId, cap),
  isOrgMember: (orgId, uid) => isOrgMember(db, orgId, uid),
  loadOrgPolicyState: (orgId) => loadOrgPolicyState(db, orgId),
  grantPropertyAccess: (input) => grantPropertyAccess(db, input),
  revokePropertyAccess: (input) => revokePropertyAccess(db, input),
  listActiveGrantsForOrg: (orgId, at) => listActiveGrantsForOrg(db, orgId, at),
  writePolicyDecision: (entry) => writePolicyDecision(db, entry),
})

async function auditRows(): Promise<Array<Record<string, unknown>>> {
  const rows = await db.execute(
    sql`SELECT actor_type, actor_id, action, decision, reason, execution_kind
        FROM policy_decision_audit WHERE organization_id = ${ORG} ORDER BY occurred_at, id`,
  )
  return rows.rows as Array<Record<string, unknown>>
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM policy_consent WHERE organization_id = ${ORG}`)
  await db.execute(
    sql`DELETE FROM organization_capability WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${MEMBER})`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)

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
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM policy_consent WHERE organization_id = ${ORG}`)
  await db.execute(
    sql`DELETE FROM organization_capability WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${MEMBER})`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('policy administration (BQC-2.7)', () => {
  it('allowlist: non-core capability can be enabled/disabled with reason + audit', async () => {
    await ops.setOrgCapability({
      organizationId: ORG,
      capability: 'team.use',
      enabled: true,
      reason: 'pilot team evaluation',
      actorUserId: ADMIN,
      now: NOW,
    })
    let snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.orgCapabilities.some(
        (c) => c.organizationId === ORG && c.capability === 'team.use',
      ),
    ).toBe(true)

    await ops.setOrgCapability({
      organizationId: ORG,
      capability: 'team.use',
      enabled: false,
      reason: 'pilot ended',
      actorUserId: ADMIN,
      now: NOW,
    })
    snapshot = await loadPolicySnapshot(db)
    expect(
      snapshot.orgCapabilities.some(
        (c) => c.organizationId === ORG && c.capability === 'team.use',
      ),
    ).toBe(false)
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
        capability: 'portal.write',
        enabled: true,
        reason: 'must stay blocked',
        actorUserId: ADMIN,
        now: NOW,
      }),
    ).rejects.toThrow(/blocked/)
    await expect(
      ops.setOrgCapability({
        organizationId: ORG,
        capability: 'team.use',
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
    expect(actions).toContain('policy.allowlist.set:pilot team evaluation')
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
