import { getAuditEventRetentionRule } from '#/contexts/feed/application/public-api'
import { RETENTION_RULES as SHARED_RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import type { RetentionRule } from '#/shared/db/retention/execute-retention-rule'

export const RETENTION_RULES: ReadonlyArray<RetentionRule> = [
  getAuditEventRetentionRule(),
  ...SHARED_RETENTION_RULES,
]
