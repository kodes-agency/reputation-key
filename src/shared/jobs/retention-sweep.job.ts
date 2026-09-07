// Retention sweep job — BQC-1.6: production-scheduled bounded retention
// with content-free evidence for every subject.
//
// Runs Guest-owned Contact Request material expiry, Google import lifecycle,
// and the static rule registry through bounded owning seams. Per subject: an
// evidence row is opened before cleanup starts and closed with counts + outcome
// + error code (retention_runs, migration 0013). A failing subject does not
// block the others; the job throws after the sweep when any subject failed
// (queue retry + operator visibility).

import type { Job } from 'bullmq'
import type { Database } from '#/shared/db'
import {
  executeRetentionRule,
  type RetentionRule,
} from '#/shared/db/retention/execute-retention-rule'
import { closeRetentionRun, openRetentionRun } from '#/shared/db/retention/evidence'
import {
  assertRetentionRegistryApplyAllowed,
  type RetentionRegistryRule,
} from '#/shared/db/retention/retention-registry'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'retention-sweep' as const
export const GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT =
  'integration.google_import_v2.lifecycle' as const
export const GUEST_CONTACT_REQUEST_RETENTION_SUBJECT =
  'guest_contact_requests.expired_material' as const
const GOOGLE_IMPORT_LIFECYCLE_BATCH_SIZE = 100

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * BQC-7.8: significant actions in audit_logs retain a 365-day horizon:
 * long enough for the beta audit window plus investigation lag and bounded
 * so the table does not grow forever. retention_runs remains
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
 *
 */
export const RETENTION_RULES: ReadonlyArray<RetentionRule> = [
  {
    subject: 'guest_response_private_feedback.expired',
    table: 'guest_response_private_feedback',
    keyColumns: ['response_id'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  {
    subject: 'guest_response_session_bindings.expired',
    table: 'guest_response_session_bindings',
    keyColumns: ['response_id'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  {
    // The canonical row is content-free after the class split. Its absolute
    // deadline is 24 calendar months from initial submission.
    subject: 'guest_responses.deidentified_fact',
    table: 'guest_responses',
    keyColumns: ['id'],
    tsColumn: 'retention_deadline',
    olderThanMs: 0,
  },
  {
    // The content-free destination fact survives, but the signed-session
    // pseudonym used to enforce first-action semantics does not.
    subject: 'guest_destination_action_receipts.expired',
    table: 'guest_destination_action_receipts',
    keyColumns: ['id'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  {
    // The identifier-only Qualified Scan survives independently of the
    // signed-session pseudonym used to enforce the rolling 24-hour window.
    subject: 'guest_qualified_scan_receipts.expired',
    table: 'guest_qualified_scan_receipts',
    keyColumns: ['id'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  {
    // One content-free, Portal-scoped authority replaces per-fact network
    // hashes. Its database check fixes every row to exactly seven days.
    subject: 'guest_network_pressure_records.expired',
    table: 'guest_network_pressure_records',
    keyColumns: ['id'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  ...(['scan_events', 'ratings', 'feedback'] as const).map((table): RetentionRule => ({
    subject: `${table}.abuse_pseudonym`,
    table,
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 7 * DAY_MS,
    extraWhere: 'ip_hash IS NOT NULL',
    operation: 'redact',
    redactColumns: ['ip_hash'],
  })),
  ...(['scan_events', 'ratings', 'feedback'] as const).map((table): RetentionRule => ({
    subject: `${table}.guest_session_pseudonym`,
    table,
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: DAY_MS,
    extraWhere: 'session_id IS NOT NULL',
    operation: 'redact',
    redactColumns: ['session_id'],
  })),
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
    subject: 'google_import_discovery_records.expired',
    table: 'google_import_discovery_records',
    keyColumns: ['reference_key'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  {
    subject: 'google_import_discovery_invalidations.expired',
    table: 'google_import_discovery_invalidations',
    keyColumns: ['invalidation_key'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  {
    // Prepared rows remain recoverable and manual-review rows remain visible
    // to support. Only settled, content-free saga fences age out.
    subject: 'invited_registration_attempts.settled',
    table: 'invited_registration_attempts',
    keyColumns: ['id'],
    tsColumn: 'updated_at',
    olderThanMs: 90 * DAY_MS,
    extraWhere: "state IN ('accepted', 'compensated')",
  },
  {
    subject: 'notifications',
    table: 'notifications',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 90 * DAY_MS,
  },
  {
    subject: 'notification_digest_batches',
    table: 'notification_digest_batches',
    keyColumns: ['id'],
    tsColumn: 'updated_at',
    olderThanMs: 90 * DAY_MS,
    extraWhere: "state IN ('accepted', 'terminal')",
  },
  {
    subject: 'notification_email_queue',
    table: 'notification_email_queue',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 90 * DAY_MS,
    extraWhere:
      "status IN ('accepted', 'delivered', 'bounced', 'complained', 'failed', 'suppressed')",
  },
  {
    subject: 'recent_activity_replay_facts',
    table: 'recent_activity_replay_facts',
    keyColumns: ['replay_key'],
    tsColumn: 'source_occurred_at',
    olderThanMs: 90 * DAY_MS,
  },
  {
    subject: 'recent_activity_actor_label_redactions.expired',
    table: 'recent_activity_actor_label_redactions',
    keyColumns: ['organization_id', 'actor_subject_id'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  {
    subject: 'recent_activity_entries',
    table: 'recent_activity_entries',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 90 * DAY_MS,
  },
  {
    // BQC-7.8: significant-action operational records — same 365d horizon.
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
  /**
   * LIF-01-T16 — counsel-registry rules a caller wants executed destructively.
   *
   * Handing registry rules to the scheduled sweep is exactly how "report-only"
   * quietly becomes "apply", so the refusal lives at this boundary rather than
   * in a caller that is trusted to check approval first. Every rule is checked
   * BEFORE any evidence row is opened and before any rule runs, so a refused
   * sweep leaves no partial evidence behind.
   */
  registryApplyRules?: ReadonlyArray<RetentionRegistryRule>
  batchSize?: number
  guestContactRequestRetentionSweep?: (input: { batchSize: number }) => Promise<
    Readonly<{
      batches: number
      processed: number
      capped: boolean
      completedThrough: Date | null
    }>
  >
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

type RetentionSweepFailure = { subject: string; error: string }
type RetentionSweepLogger = ReturnType<typeof getLogger>

/**
 * Close the open evidence row as `failed` (best effort — a close that itself
 * fails must not mask the original error) and record the failure so the job
 * still throws once every subject has been attempted.
 */
async function recordRetentionFailure(
  deps: RetentionSweepDeps,
  runId: string,
  subject: string,
  err: unknown,
  failures: RetentionSweepFailure[],
  logger: RetentionSweepLogger,
  logMessage: string,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  failures.push({ subject, error: message })
  await closeRetentionRun(deps.db, runId, {
    finishedAt: deps.clock(),
    outcome: 'failed',
    errorCode: message.slice(0, 200),
  }).catch(() => {})
  logger.warn({ err, subject }, logMessage)
}

async function sweepGuestContactRequests(
  deps: RetentionSweepDeps,
  sweep: NonNullable<RetentionSweepDeps['guestContactRequestRetentionSweep']>,
  batchSize: number,
  failures: RetentionSweepFailure[],
  logger: RetentionSweepLogger,
): Promise<void> {
  const subject = GUEST_CONTACT_REQUEST_RETENTION_SUBJECT
  const startedAt = deps.clock()
  const runId = await openRetentionRun(deps.db, subject, batchSize, startedAt)
  try {
    const result = await sweep({ batchSize })
    await closeRetentionRun(deps.db, runId, {
      finishedAt: deps.clock(),
      batches: result.batches,
      rowsDeleted: 0,
      rowsRedacted: result.processed,
      outcome: 'completed',
    })
    logger.info(
      { subject, ...result },
      result.capped
        ? 'Contact Request retention sweep reached its batch cap'
        : 'Contact Request retention sweep completed',
    )
  } catch (err) {
    await recordRetentionFailure(
      deps,
      runId,
      subject,
      err,
      failures,
      logger,
      'Contact Request retention sweep failed',
    )
  }
}

async function sweepGoogleImportLifecycle(
  deps: RetentionSweepDeps,
  sweep: NonNullable<RetentionSweepDeps['googleImportLifecycleSweep']>,
  failures: RetentionSweepFailure[],
  logger: RetentionSweepLogger,
): Promise<void> {
  const subject = GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT
  const startedAt = deps.clock()
  const runId = await openRetentionRun(
    deps.db,
    subject,
    GOOGLE_IMPORT_LIFECYCLE_BATCH_SIZE,
    startedAt,
  )
  try {
    const result = await sweep()
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
    await recordRetentionFailure(
      deps,
      runId,
      subject,
      err,
      failures,
      logger,
      'Google import lifecycle retention sweep failed',
    )
  }
}

async function sweepRetentionRules(
  deps: RetentionSweepDeps,
  rules: ReadonlyArray<RetentionRule>,
  batchSize: number,
  failures: RetentionSweepFailure[],
  logger: RetentionSweepLogger,
): Promise<void> {
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
        rowsRedacted: result.rowsRedacted ?? 0,
        outcome: 'completed',
      })
      logger.info(
        { subject: rule.subject, ...result },
        result.capped
          ? // BQC-3.7: the drain stopped at the per-run batch cap with rows
            // remaining — the next scheduled run continues where this one
            // stopped. The evidence row still closes as 'completed'.
            'retention sweep rule reached the per-run batch cap — remaining rows continue next scheduled run'
          : 'retention sweep rule completed',
      )
    } catch (err) {
      await recordRetentionFailure(
        deps,
        runId,
        rule.subject,
        err,
        failures,
        logger,
        'retention sweep rule failed',
      )
    }
  }
}

export const createRetentionSweepHandler = (deps: RetentionSweepDeps) => {
  const rules = deps.rules ?? RETENTION_RULES
  const batchSize = deps.batchSize ?? 500

  return async (_job: Job) => {
    return trace('job.retentionSweep', async () => {
      const logger = getLogger()
      const failures: RetentionSweepFailure[] = []

      // Refuse first, before any evidence row exists.
      for (const registryRule of deps.registryApplyRules ?? []) {
        assertRetentionRegistryApplyAllowed(registryRule)
      }

      const guestSweep = deps.guestContactRequestRetentionSweep
      if (guestSweep) {
        await sweepGuestContactRequests(deps, guestSweep, batchSize, failures, logger)
      }

      const importSweep = deps.googleImportLifecycleSweep
      if (importSweep) {
        await sweepGoogleImportLifecycle(deps, importSweep, failures, logger)
      }

      await sweepRetentionRules(deps, rules, batchSize, failures, logger)

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
