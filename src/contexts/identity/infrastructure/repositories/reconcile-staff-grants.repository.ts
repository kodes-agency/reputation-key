// BQC-2.3 — staff→grant reconciliation (operator tool, real PostgreSQL).
//
// Phase BQC-2 §2.3/§5: reconcile legacy staff assignments to PROPOSED grants
// with a reviewable report — never a blind conversion. The report separates
// clean rows from anomalies; apply only converts clean rows (source
// 'migration'), skips pairs that already have an active grant, and is
// idempotent. Every applied batch bumps policy_version in the same statement.
//
// Anomalies (never auto-converted — they need human review):
//   org_mismatch      — assignment.organization_id ≠ property.organization_id
//   property_inactive — property missing or soft-deleted

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { BUMP_POLICY_VERSION_SQL } from './policy-version-sql'

export type ReconcileAnomalyKind = 'org_mismatch' | 'property_inactive' | 'user_missing'

export type ReconcileAnomaly = Readonly<{
  kind: ReconcileAnomalyKind
  organizationId: string
  userId: string
  propertyId: string
  detail: string
}>

export type ReconcileOrgRow = Readonly<{
  organizationId: string
  activeAssignments: number
  distinctPairs: number
  alreadyGranted: number
  toCreate: number
  anomalies: number
}>

export type ReconcileReport = Readonly<{
  organizations: ReadonlyArray<ReconcileOrgRow>
  anomalyRows: ReadonlyArray<ReconcileAnomaly>
  generatedAt: Date
}>

/** Optional scope — reconcile specific pilot orgs first; omit for all orgs. */
export type ReconcileScope = Readonly<{ organizationIds?: ReadonlyArray<string> }>

type AssignmentRow = Readonly<{
  organization_id: string
  user_id: string
  property_id: string
  property_org: string | null
  property_deleted_at: Date | string | null
  user_exists: string | null
  active_grant_id: string | null
}>

type CleanPair = Readonly<{ organizationId: string; propertyId: string; userId: string }>

async function loadAssignments(
  db: Database,
  scope?: ReconcileScope,
): Promise<ReadonlyArray<AssignmentRow>> {
  const orgFilter = scope?.organizationIds?.length
    ? sql`AND sa.organization_id IN (${sql.join(
        scope.organizationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``
  const rows = await db.execute(sql`
    SELECT sa.organization_id, sa.user_id, sa.property_id,
           p.organization_id AS property_org,
           p.deleted_at AS property_deleted_at,
           u.id AS user_exists,
           g.id AS active_grant_id
    FROM staff_assignments sa
    LEFT JOIN properties p ON p.id = sa.property_id
    LEFT JOIN "user" u ON u.id = sa.user_id
    LEFT JOIN property_access_grant g
      ON g.organization_id = sa.organization_id
     AND g.property_id = sa.property_id
     AND g.user_id = sa.user_id
     AND g.revoked_at IS NULL
    WHERE sa.deleted_at IS NULL
    ${orgFilter}
  `)
  return rows.rows as unknown as ReadonlyArray<AssignmentRow>
}

function classify(rows: ReadonlyArray<AssignmentRow>): {
  pairs: Map<string, CleanPair & { alreadyGranted: boolean }>
  anomalies: ReconcileAnomaly[]
} {
  const pairs = new Map<string, CleanPair & { alreadyGranted: boolean }>()
  const anomalies: ReconcileAnomaly[] = []
  const seenAnomalies = new Set<string>()

  for (const r of rows) {
    const anomalyKey = `${r.organization_id}:${r.user_id}:${r.property_id}`
    const push = (anomaly: ReconcileAnomaly) => {
      if (seenAnomalies.has(anomalyKey)) return
      seenAnomalies.add(anomalyKey)
      anomalies.push(anomaly)
    }
    if (r.property_org == null || r.property_deleted_at != null) {
      push({
        kind: 'property_inactive',
        organizationId: r.organization_id,
        userId: r.user_id,
        propertyId: r.property_id,
        detail: r.property_org == null ? 'property row missing' : 'property soft-deleted',
      })
      continue
    }
    if (r.property_org !== r.organization_id) {
      push({
        kind: 'org_mismatch',
        organizationId: r.organization_id,
        userId: r.user_id,
        propertyId: r.property_id,
        detail: `property belongs to ${r.property_org}`,
      })
      continue
    }
    if (r.user_exists == null) {
      push({
        kind: 'user_missing',
        organizationId: r.organization_id,
        userId: r.user_id,
        propertyId: r.property_id,
        detail: 'no user row — grant FK would be violated',
      })
      continue
    }
    pairs.set(anomalyKey, {
      organizationId: r.organization_id,
      propertyId: r.property_id,
      userId: r.user_id,
      alreadyGranted: r.active_grant_id != null,
    })
  }
  return { pairs, anomalies }
}

export async function buildReconcileReport(
  db: Database,
  scope?: ReconcileScope,
): Promise<ReconcileReport> {
  const rows = await loadAssignments(db, scope)
  const { pairs, anomalies } = classify(rows)

  const byOrg = new Map<string, { assignments: number; anomalies: number }>()
  for (const r of rows) {
    const entry = byOrg.get(r.organization_id) ?? { assignments: 0, anomalies: 0 }
    entry.assignments += 1
    byOrg.set(r.organization_id, entry)
  }
  for (const a of anomalies) {
    byOrg.get(a.organizationId)!.anomalies += 1
  }

  const organizations: ReconcileOrgRow[] = [...byOrg.entries()]
    .map(([organizationId, counts]) => {
      const orgPairs = [...pairs.values()].filter(
        (p) => p.organizationId === organizationId,
      )
      const alreadyGranted = orgPairs.filter((p) => p.alreadyGranted).length
      return {
        organizationId,
        activeAssignments: counts.assignments,
        distinctPairs: orgPairs.length,
        alreadyGranted,
        toCreate: orgPairs.length - alreadyGranted,
        anomalies: counts.anomalies,
      }
    })
    .sort((a, b) => a.organizationId.localeCompare(b.organizationId))

  return { organizations, anomalyRows: anomalies, generatedAt: new Date() }
}

export async function applyReconciliation(
  db: Database,
  report: ReconcileReport,
  options: Readonly<{ createdBy: string; scope?: ReconcileScope }>,
): Promise<Readonly<{ created: number }>> {
  const rows = await loadAssignments(db, options.scope)
  const { pairs } = classify(rows)
  void report // pairs are recomputed at apply time — never trust a stale report

  let created = 0
  for (const pair of pairs.values()) {
    if (pair.alreadyGranted) continue
    const inserted = await db.execute(sql`
      WITH ${BUMP_POLICY_VERSION_SQL},
      ins AS (
        INSERT INTO property_access_grant
          (organization_id, property_id, user_id, source, created_by)
        VALUES (
          ${pair.organizationId},
          ${pair.propertyId},
          ${pair.userId},
          'migration',
          ${options.createdBy}
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      SELECT id FROM ins
    `)
    created += inserted.rows.length
  }
  return { created }
}
