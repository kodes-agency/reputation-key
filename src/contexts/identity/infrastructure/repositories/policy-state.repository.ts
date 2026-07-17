// BQC-2.2 — organization/property policy state repository (real PostgreSQL).
//
// Every mutation bumps the global policy_version IN THE SAME STATEMENT
// (data-modifying CTE) — that atomicity is the cache-invalidation contract:
// a committed mutation is never visible without its version bump, so the
// snapshot store's version-gated refresh can never serve stale-forever state.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { BUMP_POLICY_VERSION_SQL } from './policy-version-sql'
import type {
  PolicySnapshot,
  OrgPolicyRecord,
  PropertyPolicyRecord,
  OrgCapabilityRecord,
  PropertyCapabilityRecord,
} from '#/shared/auth/persisted-policy-store'

// ── Version ──────────────────────────────────────────────────────────

export async function getPolicyVersion(db: Database): Promise<number> {
  const rows = await db.execute(
    sql`SELECT version FROM policy_version WHERE scope = 'global'`,
  )
  const row = rows.rows[0] as { version: number | string } | undefined
  return Number(row?.version ?? 0)
}

/** Membership check for policy administration (grants require org membership). */
export async function isOrgMember(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 AS one FROM member
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    LIMIT 1
  `)
  return rows.rows.length > 0
}

/** The member's role in an org (for the read-only decision diagnostic). */
export async function getMemberRole(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT role FROM member
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    LIMIT 1
  `)
  const row = rows.rows[0] as { role: string } | undefined
  return row?.role ?? null
}

// ── Organization policy ──────────────────────────────────────────────

export type SetOrganizationPolicyInput = Readonly<{
  organizationId: string
  cohort?: string
  /** null clears an existing suspension; undefined leaves it unchanged. */
  suspendedAt?: Date | null
  suspendedReason?: string | null
}>

export async function setOrganizationPolicy(
  db: Database,
  input: SetOrganizationPolicyInput,
): Promise<void> {
  await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    upsert AS (
      INSERT INTO organization_policy (organization_id, cohort, suspended_at, suspended_reason)
      VALUES (
        ${input.organizationId},
        ${input.cohort ?? 'beta'},
        ${input.suspendedAt ?? null},
        ${input.suspendedReason ?? null}
      )
      ON CONFLICT (organization_id) DO UPDATE SET
        cohort = COALESCE(${input.cohort ?? null}::text, organization_policy.cohort),
        suspended_at = CASE WHEN ${input.suspendedAt === undefined} THEN organization_policy.suspended_at ELSE ${input.suspendedAt ?? null} END,
        suspended_reason = CASE WHEN ${input.suspendedReason === undefined} THEN organization_policy.suspended_reason ELSE ${input.suspendedReason ?? null} END,
        updated_at = now()
    )
    SELECT version FROM bump
  `)
}

// ── Property policy ──────────────────────────────────────────────────

export type SetPropertyPolicyInput = Readonly<{
  propertyId: string
  suspendedAt?: Date | null
  suspendedReason?: string | null
}>

export async function setPropertyPolicy(
  db: Database,
  input: SetPropertyPolicyInput,
): Promise<void> {
  await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    upsert AS (
      INSERT INTO property_policy (property_id, suspended_at, suspended_reason)
      VALUES (${input.propertyId}, ${input.suspendedAt ?? null}, ${input.suspendedReason ?? null})
      ON CONFLICT (property_id) DO UPDATE SET
        suspended_at = CASE WHEN ${input.suspendedAt === undefined} THEN property_policy.suspended_at ELSE ${input.suspendedAt ?? null} END,
        suspended_reason = CASE WHEN ${input.suspendedReason === undefined} THEN property_policy.suspended_reason ELSE ${input.suspendedReason ?? null} END,
        updated_at = now()
    )
    SELECT version FROM bump
  `)
}

// ── Capability allowlists ────────────────────────────────────────────

export async function addOrganizationCapability(
  db: Database,
  organizationId: string,
  capability: string,
  createdBy?: string,
): Promise<void> {
  await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    ins AS (
      INSERT INTO organization_capability (organization_id, capability, created_by)
      VALUES (${organizationId}, ${capability}, ${createdBy ?? null})
    )
    SELECT version FROM bump
  `)
}

export async function removeOrganizationCapability(
  db: Database,
  organizationId: string,
  capability: string,
): Promise<void> {
  await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    del AS (
      DELETE FROM organization_capability
      WHERE organization_id = ${organizationId} AND capability = ${capability}
    )
    SELECT version FROM bump
  `)
}

export async function addPropertyCapability(
  db: Database,
  propertyId: string,
  capability: string,
  createdBy?: string,
): Promise<void> {
  await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    ins AS (
      INSERT INTO property_capability (property_id, capability, created_by)
      VALUES (${propertyId}, ${capability}, ${createdBy ?? null})
    )
    SELECT version FROM bump
  `)
}

export async function removePropertyCapability(
  db: Database,
  propertyId: string,
  capability: string,
): Promise<void> {
  await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    del AS (
      DELETE FROM property_capability
      WHERE property_id = ${propertyId} AND capability = ${capability}
    )
    SELECT version FROM bump
  `)
}

// ── Snapshot ─────────────────────────────────────────────────────────

/** pg returns timestamptz as Date or string depending on driver path — normalize. */
function toDate(v: unknown): Date | null {
  if (v == null) return null
  return v instanceof Date ? v : new Date(v as string)
}

export async function loadPolicySnapshot(db: Database): Promise<PolicySnapshot> {
  const [version, orgPolicies, orgCapabilities, propertyPolicies, propertyCapabilities] =
    await Promise.all([
      getPolicyVersion(db),
      db.execute(
        sql`SELECT organization_id, cohort, suspended_at, suspended_reason FROM organization_policy`,
      ),
      db.execute(sql`SELECT organization_id, capability FROM organization_capability`),
      db.execute(
        sql`SELECT property_id, suspended_at, suspended_reason FROM property_policy`,
      ),
      db.execute(sql`SELECT property_id, capability FROM property_capability`),
    ])

  return {
    version,
    orgPolicies: orgPolicies.rows.map(
      (r): OrgPolicyRecord => ({
        organizationId: r.organization_id as string,
        cohort: r.cohort as string,
        suspendedAt: toDate(r.suspended_at),
        suspendedReason: (r.suspended_reason as string | null) ?? null,
      }),
    ),
    orgCapabilities: orgCapabilities.rows.map(
      (r): OrgCapabilityRecord => ({
        organizationId: r.organization_id as string,
        capability: r.capability as string,
      }),
    ),
    propertyPolicies: propertyPolicies.rows.map(
      (r): PropertyPolicyRecord => ({
        propertyId: r.property_id as string,
        suspendedAt: toDate(r.suspended_at),
        suspendedReason: (r.suspended_reason as string | null) ?? null,
      }),
    ),
    propertyCapabilities: propertyCapabilities.rows.map(
      (r): PropertyCapabilityRecord => ({
        propertyId: r.property_id as string,
        capability: r.capability as string,
      }),
    ),
    // Wildcard allowlists exist only in the env seed, never in the DB.
    orgAllowlistAll: [],
    propertyAllowlistAll: [],
  }
}

// ── Org-scoped state read (BQC-2.7 policy administration surface) ────

// The OrgPolicyState contract lives in application/ports (boundary rule);
// imported for the implementation and re-exported for existing consumers.
import type { OrgPolicyState } from '../../application/ports/property-access-grant.port'
export type { OrgPolicyState }

/** Org-scoped policy state for the admin surface — content-free by shape. */
export async function loadOrgPolicyState(
  db: Database,
  organizationId: string,
): Promise<OrgPolicyState> {
  const [policyRows, capabilityRows, propertyPolicyRows] = await Promise.all([
    db.execute(
      sql`SELECT organization_id, cohort, suspended_at, suspended_reason FROM organization_policy WHERE organization_id = ${organizationId}`,
    ),
    db.execute(
      sql`SELECT capability FROM organization_capability WHERE organization_id = ${organizationId} ORDER BY capability`,
    ),
    db.execute(
      sql`SELECT property_id, suspended_at, suspended_reason FROM property_policy WHERE property_id IN (SELECT id FROM properties WHERE organization_id = ${organizationId})`,
    ),
  ])
  const p = policyRows.rows[0] as Record<string, unknown> | undefined
  return {
    policy: p
      ? {
          organizationId: p.organization_id as string,
          cohort: p.cohort as string,
          suspendedAt: toDate(p.suspended_at),
          suspendedReason: (p.suspended_reason as string | null) ?? null,
        }
      : null,
    capabilities: capabilityRows.rows.map((r) => r.capability as string),
    propertyPolicies: propertyPolicyRows.rows.map(
      (r): PropertyPolicyRecord => ({
        propertyId: r.property_id as string,
        suspendedAt: toDate(r.suspended_at),
        suspendedReason: (r.suspended_reason as string | null) ?? null,
      }),
    ),
  }
}
