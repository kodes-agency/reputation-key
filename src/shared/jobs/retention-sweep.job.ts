// Bounded retention through the owning cleanup seams and static registry.
// Evidence records counts and failures; one failed subject cannot block others.
// The worker entry point stays inactive until the approved activation release.

import type { Job } from 'bullmq'
import type { Database } from '#/shared/db'
import {
  executeRetentionRule,
  type RetentionRule,
} from '#/shared/db/retention/execute-retention-rule'
import { closeRetentionRun, openRetentionRun } from '#/shared/db/retention/evidence'
import { retentionRuleCutoff } from '#/shared/db/retention/retention-cutoff'
import { RESEND_WEBHOOK_DELIVERY_RETENTION_DAYS } from '#/shared/db/schema/notification.schema'
import { SCHEDULED_RETENTION_ACTIVE } from '#/shared/db/retention/scheduled-retention-activation'
import { SETTLED_OUTBOX_EVENTS_WHERE } from '#/shared/outbox/infrastructure/retention.server'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'retention-sweep' as const
export const GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT =
  'integration.google_import_v2.lifecycle' as const
export const GUEST_CONTACT_REQUEST_RETENTION_SUBJECT =
  'guest_contact_requests.expired_material' as const
/** ADR 0055, note 2026-10-24 (b): superseded observation copies past their clock. */
export const REVIEW_SUPERSEDED_OBSERVATION_RETENTION_SUBJECT =
  'review_source_observations.superseded_expired' as const
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
 * Privacy Notice §6: base Guest visit facts are kept for 24 months. The rating
 * fact carries its own deadline (retention_deadline, stamped 24 calendar months
 * out at submission). The counted visit and the visit record carry none, so
 * their rules count the same calendar months back from the run.
 */
const GUEST_VISIT_FACT_RETENTION_MONTHS = 24

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
 * DELIBERATELY ABSENT — event_consumer_receipts: a receipt is the dispatcher's
 * only proof that a consumer handled a fact, and redelivery replays every
 * published fact that lacks one, whatever its age. The table cascades from
 * outbox_events, so the outbox_events.published rule removes a receipt in the
 * statement that removes its fact and never before it. A rule of its own (its
 * own cutoff, per-run cap and failure isolation) could remove the receipt
 * first, and the fact was then delivered to its consumers again.
 */
export const RETENTION_RULES: ReadonlyArray<RetentionRule> = [
  {
    // BETA.md §3: an optional Bug layout is kept no more than 30 days. The
    // row's own CHECK fixes the deadline at capture; this deletes on it.
    subject: 'beta_feedback_masked_layouts.expired',
    table: 'beta_feedback_masked_layouts',
    keyColumns: ['feedback_reference'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
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
    // The counted visit (Qualified Scan): identifiers and a time, no content.
    subject: 'guest_qualified_scans.deidentified_fact',
    table: 'guest_qualified_scans',
    keyColumns: ['id'],
    tsColumn: 'occurred_at',
    olderThanMonths: GUEST_VISIT_FACT_RETENTION_MONTHS,
  },
  {
    // The visit record. Unlike `ratings` and `feedback`, this table is still
    // written on every Portal visit, so its rows are current visit facts, not
    // pre-beta inventory: the two redactions above clear its pseudonyms early
    // and this removes what is left of the row at the published horizon.
    subject: 'scan_events.deidentified_fact',
    table: 'scan_events',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMonths: GUEST_VISIT_FACT_RETENTION_MONTHS,
  },
  {
    // Reporting's copy of each Guest fact, kept 24 calendar months from the
    // instant it was recorded. A correction restricts its reading's deletion
    // and removing it alone would revive the corrected value, so each batch
    // deletes a reading together with its corrections.
    subject: 'metric_readings.expired',
    table: 'metric_readings',
    keyColumns: ['id'],
    tsColumn: 'recorded_at',
    olderThanMonths: GUEST_VISIT_FACT_RETENTION_MONTHS,
    dependents: [
      {
        table: 'metric_corrections',
        referenceColumn: 'reading_id',
        keyColumn: 'id',
        selfReferenceColumn: 'supersedes_correction_id',
      },
    ],
  },
  {
    subject: 'outbox_events.published',
    table: 'outbox_events',
    keyColumns: ['id'],
    // Keep a full 30 days after publication, and longer while a catalogued
    // consumer still owes its receipt or recovery holds the fact. Receipts
    // leave only with their settled fact through the foreign-key cascade.
    tsColumn: 'published_at',
    olderThanMs: 30 * DAY_MS,
    extraWhere: SETTLED_OUTBOX_EVENTS_WHERE,
  },
  {
    subject: 'review_sync_runs',
    table: 'review_sync_runs',
    keyColumns: ['id'],
    tsColumn: 'started_at',
    olderThanMs: 30 * DAY_MS,
  },
  {
    // Push health ledger: ids, an enum and instants. The 7-day location health
    // and the 24-hour alert windows read well inside the 30 days.
    subject: 'review_first_sightings',
    table: 'review_first_sightings',
    keyColumns: ['organization_id', 'property_id', 'review_id'],
    tsColumn: 'first_seen_at',
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
    subject: 'idempotency_receipts',
    table: 'idempotency_receipts',
    keyColumns: ['scope', 'key'],
    tsColumn: 'recorded_at',
    olderThanMs: 30 * DAY_MS,
    // Initial sync keeps its one run identity until acceptance; abandoned
    // mappings retain the generic thirty-day cleanup once the event settles.
    extraWhere: `(scope <> 'review_import_sync' OR NOT EXISTS (
      SELECT 1 FROM outbox_events event
      WHERE event.id::text = idempotency_receipts.key
        AND event.event_type = 'property.google_binding.changed'
        AND NOT EXISTS (
          SELECT 1 FROM event_consumer_receipts receipt
          WHERE receipt.event_id = event.id AND receipt.consumer_name = 'integration.import-review-sync'
        )
    ))`,
  },
  {
    subject: 'google_import_discovery_records.expired',
    table: 'google_import_discovery_records',
    keyColumns: ['reference_key'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
  },
  // A notification lives 90 days from its latest ARRIVAL. A repeat event
  // coalesces into the unread row and stamps coalesced_latest_at, so an alert
  // re-raised yesterday is live whatever its created_at; a row never re-raised
  // arrived once, at created_at. Reading a notice extends neither.
  {
    subject: 'notifications',
    table: 'notifications',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 90 * DAY_MS,
    extraWhere: 'coalesced_latest_at IS NULL',
  },
  {
    subject: 'notifications.coalesced',
    table: 'notifications',
    keyColumns: ['id'],
    tsColumn: 'coalesced_latest_at',
    olderThanMs: 90 * DAY_MS,
    extraWhere: 'coalesced_latest_at IS NOT NULL',
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
    // Terminal rows, and any row whose notification the rules above removed:
    // nothing can send it, and a queue or digest row must never point at
    // nothing. Batch members cascade with the row.
    subject: 'notification_email_queue',
    table: 'notification_email_queue',
    keyColumns: ['id'],
    tsColumn: 'created_at',
    olderThanMs: 90 * DAY_MS,
    extraWhere:
      "(status IN ('accepted', 'delivered', 'bounced', 'complained', 'failed', 'suppressed', 'cancelled') OR NOT EXISTS (SELECT 1 FROM notifications n WHERE n.id = notification_email_queue.notification_id))",
  },
  {
    // What a delivered message's one-click unsubscribe link stands for. It
    // outlives the 90-day queue so the link keeps working in an inbox.
    subject: 'notification_unsubscribe_scopes',
    table: 'notification_unsubscribe_scopes',
    keyColumns: ['target_kind', 'target_id', 'property_id', 'category'],
    tsColumn: 'created_at',
    olderThanMs: 365 * DAY_MS,
  },
  {
    // Only has to outlast the provider's retry window.
    subject: 'resend_webhook_deliveries',
    table: 'resend_webhook_deliveries',
    keyColumns: ['event_id'],
    tsColumn: 'applied_at',
    olderThanMs: RESEND_WEBHOOK_DELIVERY_RETENTION_DAYS * DAY_MS,
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
  {
    // Review Analysis v3 (migration 0078). The analysis stamps `expires_at` when
    // it is generated, and nothing moves it: reading, correcting or aggregating an
    // analysis writes other rows. Its mention rows, their sentence numbers, its
    // aggregate contribution and that contribution's mention rows all cascade
    // from this row, so one delete takes the whole derivative. A v2 analysis is
    // not reached: v2 stays UNENFORCED (docs/BETA.md §3) until activation retires
    // its generation.
    subject: 'ai_review_analyses.v3_expired',
    table: 'ai_review_analyses',
    keyColumns: [
      'organization_id',
      'property_id',
      'review_id',
      'source_epoch',
      'source_revision',
      'analysis_sequence',
    ],
    tsColumn: 'expires_at',
    olderThanMs: 0,
    extraWhere: "analysis_profile_version = 'review-analysis-v3'",
  },
  {
    // Stable issue identities and manager presentation metadata remain while an
    // unexpired contribution points at them. Once the analysis rule above has
    // removed those references, the same run may remove the expired group;
    // members and redirects cascade with it.
    subject: 'ai_property_issue_groups.expired',
    table: 'ai_property_issue_groups',
    keyColumns: ['id'],
    tsColumn: 'expires_at',
    olderThanMs: 0,
    extraWhere:
      'NOT EXISTS (SELECT 1 FROM ai_property_aggregate_contribution_mentions m WHERE m.issue_group_id = ai_property_issue_groups.id)',
  },
]

type RetentionSweepDeps = Readonly<{
  db: Database
  clock: () => Date
  rules?: ReadonlyArray<RetentionRule>
  batchSize?: number
  guestContactRequestRetentionSweep?: (input: { batchSize: number }) => Promise<
    Readonly<{
      batches: number
      processed: number
      capped: boolean
      completedThrough: Date | null
    }>
  >
  /** Review blanks the provider content of superseded observation copies. */
  reviewObservationRetentionSweep?: (input: {
    batchSize: number
  }) => Promise<Readonly<{ batches: number; processed: number; capped: boolean }>>
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

type RetentionSweepFailure = { subject: string }
type RetentionSweepLogger = ReturnType<typeof getLogger>

/**
 * Close the open evidence row as `failed` (best effort — a close that itself
 * fails must not mask the original error) and record the failure so the job
 * still throws once every subject has been attempted.
 */
async function recordRetentionFailure(
  deps: RetentionSweepDeps,
  runId: string | undefined,
  subject: string,
  err: unknown,
  failures: RetentionSweepFailure[],
  logger: RetentionSweepLogger,
  logMessage: string,
): Promise<void> {
  failures.push({ subject })
  if (runId)
    await closeRetentionRun(deps.db, runId, {
      finishedAt: deps.clock(),
      outcome: 'failed',
      errorCode: 'retention_failed',
    }).catch(() => {})
  logger.warn({ err, subject }, logMessage)
}

async function sweepRedactedMaterial(
  deps: RetentionSweepDeps,
  sweep: NonNullable<RetentionSweepDeps['reviewObservationRetentionSweep']>,
  batchSize: number,
  failures: RetentionSweepFailure[],
  logger: RetentionSweepLogger,
  subject: string,
  label: string,
): Promise<void> {
  const startedAt = deps.clock()
  let runId: string | undefined
  try {
    runId = await openRetentionRun(deps.db, subject, batchSize, startedAt)
    const result = await sweep({ batchSize })
    await closeRetentionRun(deps.db, runId, {
      finishedAt: deps.clock(),
      batches: result.batches,
      rowsDeleted: 0,
      rowsRedacted: result.processed,
      // A capped pass still owes expired work. The existing retention.failure
      // alert stays raised until a later scheduled pass finishes the backlog.
      outcome: result.capped ? 'failed' : 'completed',
      ...(result.capped ? { errorCode: 'retention_capped' } : {}),
    })
    logger.info(
      { subject, ...result },
      result.capped
        ? `${label} retention sweep reached its batch cap`
        : `${label} retention sweep completed`,
    )
  } catch (err) {
    await recordRetentionFailure(
      deps,
      runId,
      subject,
      err,
      failures,
      logger,
      `${label} retention sweep failed`,
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
  let runId: string | undefined
  try {
    runId = await openRetentionRun(
      deps.db,
      subject,
      GOOGLE_IMPORT_LIFECYCLE_BATCH_SIZE,
      startedAt,
    )
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
    const cutoff = retentionRuleCutoff(rule, startedAt)
    let runId: string | undefined
    let batches = 0
    let rows = 0
    try {
      runId = await openRetentionRun(deps.db, rule.subject, batchSize, startedAt)
      const result = await executeRetentionRule(deps.db, rule, {
        cutoff,
        batchSize,
        onBatch: (batch, count) => {
          batches = batch
          rows += count
        },
      })
      await closeRetentionRun(deps.db, runId, {
        finishedAt: deps.clock(),
        batches: result.batches,
        rowsDeleted: result.rowsDeleted,
        rowsRedacted: result.rowsRedacted ?? 0,
        outcome: result.capped ? 'failed' : 'completed',
        ...(result.capped ? { errorCode: 'retention_capped' } : {}),
      })
      logger.info(
        { subject: rule.subject, ...result },
        result.capped
          ? 'retention sweep rule reached the per-run batch cap — remaining rows continue next scheduled run'
          : 'retention sweep rule completed',
      )
    } catch (err) {
      if (!runId) {
        failures.push({ subject: rule.subject })
        logger.warn({ err, subject: rule.subject }, 'retention evidence unavailable')
        continue
      }
      await closeRetentionRun(deps.db, runId, {
        finishedAt: deps.clock(),
        batches,
        rowsDeleted: rule.operation === 'redact' ? 0 : rows,
        rowsRedacted: rule.operation === 'redact' ? rows : 0,
        outcome: 'failed',
        errorCode: 'retention_failed',
      }).catch(() => {})
      failures.push({ subject: rule.subject })
      logger.warn({ err, subject: rule.subject }, 'retention sweep rule failed')
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

      const guestSweep = deps.guestContactRequestRetentionSweep
      if (guestSweep) {
        await sweepRedactedMaterial(
          deps,
          guestSweep,
          batchSize,
          failures,
          logger,
          GUEST_CONTACT_REQUEST_RETENTION_SUBJECT,
          'Contact Request',
        )
      }

      const observationSweep = deps.reviewObservationRetentionSweep
      if (observationSweep) {
        await sweepRedactedMaterial(
          deps,
          observationSweep,
          batchSize,
          failures,
          logger,
          REVIEW_SUPERSEDED_OBSERVATION_RETENTION_SUBJECT,
          'Superseded observation',
        )
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

/** The worker uses this entry point; isolated restore retains explicit apply. */
export const createScheduledRetentionSweepHandler = (deps: RetentionSweepDeps) => {
  const apply = createRetentionSweepHandler(deps)
  return async (job: Job) => {
    if (!SCHEDULED_RETENTION_ACTIVE) {
      getLogger().info({ mode: 'inactive' }, 'scheduled retention is inactive')
      return { mode: 'inactive' } as const
    }
    return apply(job)
  }
}
