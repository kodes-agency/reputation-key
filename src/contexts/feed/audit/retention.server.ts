import { AUDIT_EVENT_RETENTION_DAYS } from '#/shared/db/schema/audit-events.schema'
import type { RetentionRule } from '#/shared/db/retention/execute-retention-rule'

export const auditEventCutoff = (observedAt: Date): Date => {
  if (!Number.isFinite(observedAt.getTime()))
    throw new Error('Invalid audit observation time')
  return new Date(observedAt.getTime() - AUDIT_EVENT_RETENTION_DAYS * 86_400_000)
}

export const AUDIT_EVENT_RETENTION_RULE: RetentionRule = Object.freeze({
  subject: 'audit_events',
  table: 'audit_events',
  keyColumns: ['id'],
  tsColumn: 'occurred_at',
  olderThanMs: AUDIT_EVENT_RETENTION_DAYS * 86_400_000,
})
