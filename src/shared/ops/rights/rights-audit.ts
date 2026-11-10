// The audit event one applied rights request leaves. Content-free: the
// operator, the scope, the Organization and Property, and the verification
// reference. Written after the run, whatever its outcome, so an erasure that
// stopped half way is on record too.

import { randomUUID } from 'node:crypto'
import type { RightsRequestPlan } from './rights-request-command'

export type RightsAuditEvent = Readonly<{
  organizationId: string
  propertyId: string | null
  actorType: 'operator'
  actorId: string
  action: string
  outcome: 'succeeded' | 'failed'
  resourceType: 'rights_request'
  resourceId: string | null
  sourceKind: 'operator_command'
  sourceId: string
  sourceEventType: null
  sourceEventVersion: null
  sourceContext: null
  sourceAggregateId: null
  occurredAt: Date
}>

export type RightsAudit = Readonly<{
  operatorId: string
  write: (event: RightsAuditEvent) => Promise<void>
  now?: () => Date
  /** One id per run, so two attempts at the same request never collide. */
  runId?: () => string
}>

export function rightsAuditEvent(
  audit: RightsAudit,
  plan: RightsRequestPlan,
  run: Readonly<{ erases: boolean; outcome: RightsAuditEvent['outcome'] }>,
): RightsAuditEvent {
  return {
    organizationId: plan.organizationId,
    propertyId: plan.propertyId ?? null,
    actorType: 'operator',
    actorId: audit.operatorId,
    action: run.erases ? `rights.erase.${plan.scope}` : 'rights.final_warning.queued',
    outcome: run.outcome,
    resourceType: 'rights_request',
    resourceId: plan.verificationRef ?? null,
    sourceKind: 'operator_command',
    sourceId: `rights-${(audit.runId ?? randomUUID)()}`,
    sourceEventType: null,
    sourceEventVersion: null,
    sourceContext: null,
    sourceAggregateId: null,
    occurredAt: (audit.now ?? (() => new Date()))(),
  }
}
