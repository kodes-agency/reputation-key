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
  OrgPolicyRecord,
  PropertyPolicyRecord,
} from '#/shared/domain/policy-records'
import type {
  PolicySnapshot,
  OrgCapabilityRecord,
  PropertyCapabilityRecord,
} from '#/shared/auth/persisted-policy-store'

type PolicySqlExecutor = Pick<Database, 'execute'>

// ── Version ──────────────────────────────────────────────────────────

export async function getPolicyControlVersion(
  db: Database,
): Promise<Readonly<{ version: number; emergencyKillVersion: number }>> {
  const rows = await db.execute(
    sql`SELECT version, emergency_kill_version FROM policy_version WHERE scope = 'global'`,
  )
  const row = rows.rows[0] as
    { version: number | string; emergency_kill_version: number | string } | undefined
  return {
    version: Number(row?.version ?? 0),
    emergencyKillVersion: Number(row?.emergency_kill_version ?? 0),
  }
}

export async function getPolicyVersion(db: Database): Promise<number> {
  return (await getPolicyControlVersion(db)).version
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
  db: PolicySqlExecutor,
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
  db: PolicySqlExecutor,
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
  db: PolicySqlExecutor,
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
  db: PolicySqlExecutor,
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
  db: PolicySqlExecutor,
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
  db: PolicySqlExecutor,
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

/**
 * Grant a property every capability currently allowlisted for its
 * organization. A freshly created property has an EMPTY property_capability
 * set, and an empty set denies every non-core capability
 * (`property_not_allowlisted`) — this is the provisioning step that closes
 * that gap.
 *
 * One statement: the version bump, the INSERT … SELECT and the RETURNING read
 * commit together, so a granted capability is never visible without its
 * version bump. Idempotent by the (property_id, capability) primary key —
 * re-running grants only what is missing and returns exactly what it added.
 */
export async function provisionPropertyCapabilitiesFromOrganization(
  db: Database,
  input: Readonly<{
    organizationId: string
    propertyId: string
    createdBy?: string
  }>,
): Promise<ReadonlyArray<string>> {
  const rows = await db.execute(sql`
    WITH ${BUMP_POLICY_VERSION_SQL},
    ins AS (
      INSERT INTO property_capability (property_id, capability, created_by)
      SELECT ${input.propertyId}::uuid, oc.capability, ${input.createdBy ?? null}
      FROM organization_capability oc
      WHERE oc.organization_id = ${input.organizationId}
      ON CONFLICT (property_id, capability) DO NOTHING
      RETURNING capability
    )
    SELECT capability FROM ins ORDER BY capability
  `)
  return rows.rows.map((r) => r.capability as string)
}

// ── Allowlist reads (provisioning drift + operator report) ───────────

export async function listOrganizationCapabilities(
  db: Database,
  organizationId: string,
): Promise<ReadonlyArray<string>> {
  const rows = await db.execute(sql`
    SELECT capability FROM organization_capability
    WHERE organization_id = ${organizationId}
    ORDER BY capability
  `)
  return rows.rows.map((r) => r.capability as string)
}

export async function listPropertyCapabilities(
  db: Database,
  propertyId: string,
): Promise<ReadonlyArray<string>> {
  const rows = await db.execute(sql`
    SELECT capability FROM property_capability
    WHERE property_id = ${propertyId}::uuid
    ORDER BY capability
  `)
  return rows.rows.map((r) => r.capability as string)
}

/** The property's organization — null when the property is absent. */
export async function getPropertyOrganizationId(
  db: Database,
  propertyId: string,
): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT organization_id FROM properties WHERE id = ${propertyId}::uuid LIMIT 1
  `)
  const row = rows.rows[0] as { organization_id: string } | undefined
  return row?.organization_id ?? null
}

/**
 * Active, non-deleted properties of an organization — the targets of an
 * organization-wide capability sync (a purged or lifecycle-parked property is
 * not provisioned).
 */
export async function listProvisionablePropertyIds(
  db: Database,
  organizationId: string,
): Promise<ReadonlyArray<string>> {
  const rows = await db.execute(sql`
    SELECT id FROM properties
    WHERE organization_id = ${organizationId}
      AND deleted_at IS NULL
      AND lifecycle_state = 'active'
    ORDER BY id
  `)
  return rows.rows.map((r) => r.id as string)
}

// ── Snapshot ─────────────────────────────────────────────────────────

/** pg returns timestamptz as Date or string depending on driver path — normalize. */
function toDate(v: unknown): Date | null {
  if (v == null) return null
  return v instanceof Date ? v : new Date(v as string)
}

export async function loadPolicySnapshot(db: Database): Promise<PolicySnapshot> {
  const [
    control,
    killedCapabilities,
    orgPolicies,
    orgCapabilities,
    propertyPolicies,
    propertyCapabilities,
  ] = await Promise.all([
    getPolicyControlVersion(db),
    db.execute(
      sql`SELECT capability FROM capability_execution_control WHERE denied = true`,
    ),
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
    version: control.version,
    emergencyKillVersion: control.emergencyKillVersion,
    killedCapabilities: killedCapabilities.rows.map((row) => row.capability as string),
    orgPolicies: orgPolicies.rows.map((r): OrgPolicyRecord => ({
      organizationId: r.organization_id as string,
      cohort: r.cohort as string,
      suspendedAt: toDate(r.suspended_at),
      suspendedReason: (r.suspended_reason as string | null) ?? null,
    })),
    orgCapabilities: orgCapabilities.rows.map((r): OrgCapabilityRecord => ({
      organizationId: r.organization_id as string,
      capability: r.capability as string,
    })),
    propertyPolicies: propertyPolicies.rows.map((r): PropertyPolicyRecord => ({
      propertyId: r.property_id as string,
      suspendedAt: toDate(r.suspended_at),
      suspendedReason: (r.suspended_reason as string | null) ?? null,
    })),
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
    propertyPolicies: propertyPolicyRows.rows.map((r): PropertyPolicyRecord => ({
      propertyId: r.property_id as string,
      suspendedAt: toDate(r.suspended_at),
      suspendedReason: (r.suspended_reason as string | null) ?? null,
    })),
  }
}
