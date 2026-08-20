// Retention sweep job — BQC-1.6: production-scheduled bounded retention
// with content-free evidence for every subject.
//
// Runs the static rule registry (outbox, receipts, sync runs, webhook
// receipts, notifications, activity, cache) through the bounded CTE
// executor. Per rule: an evidence row is opened before deletion starts and
// closed with counts + outcome + error code (retention_runs, migration
// 0013). A failing rule does not block the others; the job throws after
// the sweep when any rule failed (queue retry + operator visibility).

import type { Job } from 'bullmq'
import type { Database } from '#/shared/db'
import {
  executeRetentionRule,
  type RetentionRule,
} from '#/shared/db/retention/execute-retention-rule'
import { closeRetentionRun, openRetentionRun } from '#/shared/db/retention/evidence'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'retention-sweep' as const
export const GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT =
  'integration.google_import_v2.lifecycle' as const
const GOOGLE_IMPORT_LIFECYCLE_BATCH_SIZE = 100

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * BQC-7.8: audit-evidence retention horizon — 365 days. The beta audit
 * trail (operator/policy decisions in policy_decision_audit, significant
 * actions in audit_logs) is compliance-adjacent evidence: long enough to
 * cover the beta audit window plus investigation lag, bounded so the tables
 * do not grow forever. Distinct from retention_runs, which is
 * indefinite-by-design (see the registry comment below).
 */
const AUDIT_EVIDENCE_RETENTION_MS = 365 * DAY_MS

/**
 * The retention rule registry. Durations per table docs:
 * outbox/sync/webhook ~30d operational history; notifications/activity 90d
 * (documented in their CONTEXT docs); cache expires per-entry; audit
 * evidence 365d (AUDIT_EVIDENCE_RETENTION_MS, BQC-7.8).
 *
 * DELIBERATELY ABSENT — retention_runs: the evidence chain FOR deletions is
 * indefinite-by-design (BQC-7.8). Deleting the evidence rows would erase the
 * proof of erasure; table size is monitored via the metrics snapshot
 * instead. Documented in docs/operations/backup-and-lifecycle.md.
 */
export const RETENTION_RULES: ReadonlyArray<RetentionRule> = [
  {
    subject: 'outbox_events.published',
    table: 'outbox_events',
    keyColumns: ['id'],
    // BQC-3.7: keyed on published_at (the rule already filters published rows)
    // so an event unpublished 29d then published survives a full 30d window —
    // created_at keying deleted it ~1d after publication. 30d is BQC-1.6's
    // deliberate value; the applied migration file's comment says 7d/90d —
    // that comment drift is NOT fixed here (applied migrations are immutable).
    tsColumn: 'published_at',
    olderThanMs: 30 * DAY_MS,
    extraWhere: 'published_at IS NOT NULL',
  },
  {
    subject: 'event_consumer_receipts',
    table: 'event_consumer_receipts',
    keyColumns: ['event_id', 'consumer_name'],
    tsColumn: 'created_at',
    olderThanMs: 30 * DAY_MS,
  },
  {
    subject: 'review_sync_runs',
    table: 'review_sync_runs',
    keyColumns: ['id'],
    tsColumn: 'started_at',
    olderThanMs: 30 * DAY_MS,
  },
  {
    subject: 'review_refresh_runs',
    table: 'review_refresh_runs',
    keyColumns: ['id'],
    tsColumn: 'started_at',
    olderThanMs: 30 * DAY_MS,
  },
  {
    subject: 'inbound_webhook_receipts',
    table: 'inbound_webhook_receipts',
    keyColumns: ['provider', 'topic', 'message_id'],
    tsColumn: 'received_at',
    olderThanMs: 30 * DAY_MS,
  },
  {
    subject: 'notifications',
    table: 'notifications',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 90 * DAY_MS,
  },
  {
    subject: 'notification_email_queue',
    table: 'notification_email_queue',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 90 * DAY_MS,
    extraWhere: "status IN ('sent', 'failed', 'cancelled', 'suppressed')",
  },
  {
    subject: 'activity_log',
    table: 'activity_log',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 90 * DAY_MS,
  },
  {
    // BQC-7.8: operator/policy decision audit — the beta audit trail
    // horizon (365d from the decision timestamp).
    subject: 'policy_decision_audit',
    table: 'policy_decision_audit',
    keyColumns: ['id'],
    tsColumn: 'occurred_at',
    olderThanMs: AUDIT_EVIDENCE_RETENTION_MS,
  },
  {
    // BQC-7.8: significant-action audit log — same 365d horizon.
    subject: 'audit_logs',
    table: 'audit_logs',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: AUDIT_EVIDENCE_RETENTION_MS,
  },
]

type RetentionSweepDeps = Readonly<{
  db: Database
  clock: () => Date
  rules?: ReadonlyArray<RetentionRule>
  batchSize?: number
  googleImportLifecycleSweep?: () => Promise<
    Readonly<{
      expiredItemsVisited: number
      receiptsReconciled: number
      itemsTerminalized: number
      parentsPurged: number
      propertyReceiptsSwept: number
      unreleasedExpiredReceipts: number
    }>
  >
}>

export const createRetentionSweepHandler = (deps: RetentionSweepDeps) => {
  const rules = deps.rules ?? RETENTION_RULES
  const batchSize = deps.batchSize ?? 500

  return async (_job: Job) => {
    return trace('job.retentionSweep', async () => {
      const logger = getLogger()
      const failures: Array<{ subject: string; error: string }> = []

      if (deps.googleImportLifecycleSweep) {
        const subject = GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT
        const startedAt = deps.clock()
        const runId = await openRetentionRun(
          deps.db,
          subject,
          GOOGLE_IMPORT_LIFECYCLE_BATCH_SIZE,
          startedAt,
        )
        try {
          const result = await deps.googleImportLifecycleSweep()
          await closeRetentionRun(deps.db, runId, {
            finishedAt: deps.clock(),
            batches: 1,
            rowsDeleted: result.parentsPurged + result.propertyReceiptsSwept,
            outcome: 'completed',
          })
          logger.info(
            { subject, ...result },
            'Google import lifecycle retention sweep completed',
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          failures.push({ subject, error: message })
          await closeRetentionRun(deps.db, runId, {
            finishedAt: deps.clock(),
            outcome: 'failed',
            errorCode: message.slice(0, 200),
          }).catch(() => {})
          logger.warn({ err, subject }, 'Google import lifecycle retention sweep failed')
        }
      }

      for (const rule of rules) {
        const startedAt = deps.clock()
        const cutoff = new Date(startedAt.getTime() - rule.olderThanMs)
        const runId = await openRetentionRun(deps.db, rule.subject, batchSize, startedAt)
        try {
          const result = await executeRetentionRule(deps.db, rule, { cutoff, batchSize })
          await closeRetentionRun(deps.db, runId, {
            finishedAt: deps.clock(),
            batches: result.batches,
            rowsDeleted: result.rowsDeleted,
            outcome: 'completed',
          })
          if (result.capped) {
            // BQC-3.7: the drain stopped at the per-run batch cap with rows
            // remaining — the next scheduled run continues where this one
            // stopped. The evidence row still closes as 'completed'.
            logger.info(
              { subject: rule.subject, ...result },
              'retention sweep rule reached the per-run batch cap — remaining rows continue next scheduled run',
            )
          } else {
            logger.info(
              { subject: rule.subject, ...result },
              'retention sweep rule completed',
            )
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          failures.push({ subject: rule.subject, error: message })
          await closeRetentionRun(deps.db, runId, {
            finishedAt: deps.clock(),
            outcome: 'failed',
            errorCode: message.slice(0, 200),
          }).catch(() => {})
          logger.warn({ err, subject: rule.subject }, 'retention sweep rule failed')
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `retention sweep: ${failures.length} rule(s) failed: ${failures
            .map((f) => f.subject)
            .join(', ')}`,
        )
      }
    })
  }
}
