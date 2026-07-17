// BQC-2.2 — content-free policy decision audit (real PostgreSQL).
//
// Records that an authorization decision happened: actor kind, action,
// capability, execution kind, allow/deny + stable reason, policy version,
// correlation id. Nothing else — no payloads, no content (ADR 0030's
// content-free posture applied to authorization evidence; phase §2.2).
// Audit rows deliberately have no tenant FKs: evidence survives tenant
// deletion (BQC-1.7).
//
// The writer is used by the ExecutionPolicy (BQC-2.3+); fields are plain
// strings here — the engine's own types narrow them at the call site.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type PolicyDecisionEntry = Readonly<{
  actorType: string // user | system | operator | public (CHECK-enforced)
  actorId: string | null
  organizationId: string | null
  propertyId: string | null
  action: string
  capability: string | null
  executionKind: string // interactive | worker | consumer | schedule | operator | public
  decision: string // allow | deny
  reason: string
  policyVersion: string
  correlationId: string | null
}>

export async function writePolicyDecision(
  db: Database,
  entry: PolicyDecisionEntry,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO policy_decision_audit (
      actor_type, actor_id, organization_id, property_id,
      action, capability, execution_kind, decision, reason,
      policy_version, correlation_id
    ) VALUES (
      ${entry.actorType}, ${entry.actorId}, ${entry.organizationId}, ${entry.propertyId},
      ${entry.action}, ${entry.capability}, ${entry.executionKind}, ${entry.decision},
      ${entry.reason}, ${entry.policyVersion}, ${entry.correlationId}
    )
  `)
}
