// BQC-2.2 — content-free policy decision audit (real PostgreSQL).
//
// Records that an authorization decision happened: actor kind, action,
// capability, execution kind, allow/deny + stable reason, policy version,
// correlation id. Nothing else — no payloads, no content (ADR 0030's
// content-free posture applied to authorization evidence; phase §2.2).
// Audit rows deliberately have no tenant FKs: evidence survives tenant
// deletion (BQC-1.7).
//
// The writer is used by the ExecutionPolicy (BQC-2.3+); the entry shape IS
// the engine's DecisionAuditEntry (aliased — BQC-7.5 dedupe): actorType /
// executionKind / decision are CHECK-constrained at the table.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { DecisionAuditEntry } from '#/shared/auth/execution-policy'

export type PolicyDecisionEntry = DecisionAuditEntry

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
