// BQC-4.4 — operator region diagnostic (real PostgreSQL).
//
// The 2.7 policy-admin surface extended with a content-free region
// diagnostic: for a property in the caller's org it reports the persisted
// region facts, the router's processable/blocked decision, and the current
// cell + logical provider ref — and writes an operator audit outcome to
// policy_decision_audit on every read (mirrors the 2.7 audit proof in
// policy-admin.test.ts).

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
} from './policy-state.repository'
import {
  grantPropertyAccess,
  revokePropertyAccess,
  hasActiveGrant,
  listActiveGrantsForOrg,
} from './property-access-grant.repository'
import { writePolicyDecision } from './policy-decision-audit.repository'

const db = getDb()
const ORG = 'org-region-diag'
const ADMIN = 'user-region-diag-admin'
const PROP_US = 'd4000000-0000-4000-8000-0000000000a1'
const PROP_UNRESOLVED = 'd4000000-0000-4000-8000-0000000000a2'
const PROP_EUROPE = 'd4000000-0000-4000-8000-0000000000a3'
const PROP_GLOBAL = 'd4000000-0000-4000-8000-0000000000a4'
const PROP_MISSING = 'd4000000-0000-4000-8000-0000000000ff'

const CELL = 'us'

const ops = createPolicyAdminOps({
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
        cell: CELL,
      }).resolve(propertyId, 'review.sync'),
    cell: CELL,
    providerRef: providerRefForCell(CELL) ?? null,
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

async function seedProperty(
  id: string,
  region: string,
  source: string,
  version: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, processing_region, processing_region_source, routing_policy_version)
    VALUES (${id}, ${ORG}, ${'region-prop-' + region}, ${'region-prop-' + region + '-' + id.slice(-2)}, 'UTC', ${region}, ${source}, ${version})
  `)
}

async function diagnosticAuditRows(): Promise<Array<Record<string, unknown>>> {
  const rows = await db.execute(
    sql`SELECT actor_type, actor_id, property_id, action, decision, reason, execution_kind
        FROM policy_decision_audit WHERE organization_id = ${ORG} AND action = 'policy.region.diagnostic' ORDER BY occurred_at, id`,
  )
  return rows.rows as Array<Record<string, unknown>>
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id = ${ADMIN}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)

  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Region Diag Org', ${ORG}, now())`,
  )
  await db.execute(
    sql`INSERT INTO "user" (id, name, email, "emailVerified") VALUES (${ADMIN}, 'Admin', 'user-region-diag-admin@example.com', false)`,
  )
  await db.execute(
    sql`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES ('m-region-diag-1', ${ADMIN}, ${ORG}, 'owner', now())`,
  )
  await seedProperty(PROP_US, 'us', 'country_default', 2)
  await seedProperty(PROP_UNRESOLVED, 'unresolved', 'organization_default', 1)
  await seedProperty(PROP_EUROPE, 'europe', 'google_address', 1)
  await seedProperty(PROP_GLOBAL, 'global', 'manual', 3)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id = ${ADMIN}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('region diagnostic (BQC-4.4, real PostgreSQL)', () => {
  it('reports a processable us property with cell + logical provider ref', async () => {
    const result = await ops.getRegionDiagnostic({
      organizationId: ORG,
      propertyId: PROP_US,
      actorUserId: ADMIN,
    })

    expect(result).toEqual({
      propertyId: PROP_US,
      processingRegion: 'us',
      processingRegionSource: 'country_default',
      routingPolicyVersion: 2,
      processable: true,
      blockedReason: null,
      cell: 'us',
      providerRef: 'gbp-default',
    })
  })

  it('reports unresolved/denied region states with content-free machine reasons', async () => {
    const unresolved = await ops.getRegionDiagnostic({
      organizationId: ORG,
      propertyId: PROP_UNRESOLVED,
      actorUserId: ADMIN,
    })
    expect(unresolved.processable).toBe(false)
    expect(unresolved.blockedReason).toBe('region_unresolved')
    expect(unresolved.processingRegionSource).toBe('organization_default')

    const europe = await ops.getRegionDiagnostic({
      organizationId: ORG,
      propertyId: PROP_EUROPE,
      actorUserId: ADMIN,
    })
    expect(europe.processable).toBe(false)
    expect(europe.blockedReason).toBe('region_denied')

    const globalProp = await ops.getRegionDiagnostic({
      organizationId: ORG,
      propertyId: PROP_GLOBAL,
      actorUserId: ADMIN,
    })
    expect(globalProp.processable).toBe(false)
    expect(globalProp.blockedReason).toBe('region_denied')
    expect(globalProp.routingPolicyVersion).toBe(3)
  })

  it('reports a missing property as property_missing', async () => {
    const result = await ops.getRegionDiagnostic({
      organizationId: ORG,
      propertyId: PROP_MISSING,
      actorUserId: ADMIN,
    })

    expect(result.processable).toBe(false)
    expect(result.blockedReason).toBe('property_missing')
    expect(result.processingRegion).toBeNull()
    expect(result.routingPolicyVersion).toBeNull()
  })

  it('scopes to the caller org — a cross-org property reports property_missing', async () => {
    const result = await ops.getRegionDiagnostic({
      organizationId: 'org-not-the-owner',
      propertyId: PROP_US,
      actorUserId: ADMIN,
    })

    expect(result.blockedReason).toBe('property_missing')
    expect(result.processingRegion).toBeNull()
  })

  it('writes a content-free operator audit outcome for every diagnostic read', async () => {
    const rows = await diagnosticAuditRows()
    // One row per getRegionDiagnostic call above (5 reads).
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const row of rows) {
      expect(row.actor_type).toBe('operator')
      expect(row.execution_kind).toBe('operator')
      expect(row.decision).toBe('allow')
      expect(row.actor_id).toBe(ADMIN)
      expect(String(row.reason)).toMatch(/^region diagnostic: /)
    }
    const byProperty = rows.map((r) => `${r.property_id}:${r.reason}`)
    expect(byProperty).toContain(`${PROP_US}:region diagnostic: processable`)
    expect(byProperty).toContain(
      `${PROP_UNRESOLVED}:region diagnostic: region_unresolved`,
    )
    expect(byProperty).toContain(`${PROP_EUROPE}:region diagnostic: region_denied`)
  })
})
