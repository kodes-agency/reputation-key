import { writeAuditEvent } from '#/contexts/feed/public-api'
import type { Tx } from '#/shared/outbox/commit'

export type GoalAudit = Readonly<{
  organizationId: string
  propertyId: string
  /** The acting user's id, or 'system' for a change no person made. */
  actorId: string
  action: string
  /** Defaults to the Program. */
  resourceType?: 'goal_program' | 'goal_monthly_result'
  resourceId: string
  /** The id of the row the change creates; a fresh id when it creates none. */
  sourceId: string
  at: Date
}>

/**
 * One audit event per Goal change, in the change's own transaction. The event
 * shape refuses a malformed id, which throws and rolls the change back.
 */
export async function writeGoalAudit(tx: Tx, audit: GoalAudit): Promise<void> {
  const isSystem = audit.actorId === 'system'
  await writeAuditEvent(tx, {
    organizationId: audit.organizationId,
    propertyId: audit.propertyId,
    actorType: isSystem ? 'system' : 'user',
    actorId: isSystem ? null : audit.actorId,
    action: audit.action,
    outcome: 'succeeded',
    resourceType: audit.resourceType ?? 'goal_program',
    resourceId: audit.resourceId,
    sourceKind: 'interactive_command',
    sourceId: audit.sourceId,
    sourceEventType: null,
    sourceEventVersion: null,
    sourceContext: null,
    sourceAggregateId: null,
    occurredAt: audit.at,
  })
}
