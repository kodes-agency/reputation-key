// Review sync operational tables (migration 0007 / PRE17B).
// Canonical Drizzle model for review_sync_state, review_sync_runs,
// and inbound_webhook_receipts. BQR-1.1: schema parity with migrated DB.

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  bigint,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core'

/**
 * One row per property/source — incremental cursor and scheduling state.
 * property_id is varchar in the migration (not a FK uuid) for operational isolation.
 */
export const reviewSyncState = pgTable(
  'review_sync_state',
  {
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    source: text('source').notNull().default('google'),
    connectionId: varchar('connection_id', { length: 255 }),
    sourceEpoch: integer('source_epoch').notNull().default(0),
    watermarkUpdatedAt: timestamp('watermark_updated_at', { withTimezone: true }),
    watermarkSourceName: text('watermark_source_name'),
    overlapDurationMs: bigint('overlap_duration_ms', { mode: 'number' }).default(300_000),
    generationId: uuid('generation_id'),
    pageToken: text('page_token'),
    inventoryStartedAt: timestamp('inventory_started_at', { withTimezone: true }),
    inventoryCompletedAt: timestamp('inventory_completed_at', { withTimezone: true }),
    inventoryStatus: text('inventory_status').default('idle'),
    nextIncrementalAt: timestamp('next_incremental_at', { withTimezone: true }),
    nextInventoryAt: timestamp('next_inventory_at', { withTimezone: true }),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    lastNotificationAt: timestamp('last_notification_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastTerminalErrorAt: timestamp('last_terminal_error_at', { withTimezone: true }),
    errorClass: text('error_class'),
    errorRetryAt: timestamp('error_retry_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.source] }),
    index('review_sync_state_due_incremental_idx').on(t.nextIncrementalAt),
    index('review_sync_state_lease_expired_idx').on(t.leaseUntil),
  ],
)

/** Bounded operational history for sync runs (retain ~30 days). */
export const reviewSyncRuns = pgTable(
  'review_sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    source: text('source').notNull().default('google'),
    mode: text('mode').notNull(),
    sourceEpoch: integer('source_epoch'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    pageCount: integer('page_count').default(0),
    reviewCount: integer('review_count').default(0),
    createdCount: integer('created_count').default(0),
    updatedCount: integer('updated_count').default(0),
    deletedCount: integer('deleted_count').default(0),
    failedCount: integer('failed_count').default(0),
    result: text('result'),
    errorClass: text('error_class'),
  },
  (t) => [index('review_sync_runs_started_at_idx').on(t.startedAt)],
)

/**
 * BQC-1.5 — refresh sweep run record. One row per sweep run with the
 * resume cursor, counts, oldest due expiry, failures, and terminal state.
 * `budget_exhausted` runs resume from their cursor on the next run.
 */
export const reviewRefreshRuns = pgTable(
  'review_refresh_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Keyset cursor (contentExpiresAt, id) the run stopped at. */
    cursorContentExpiresAt: timestamp('cursor_content_expires_at', {
      withTimezone: true,
    }),
    cursorReviewId: uuid('cursor_review_id'),
    batchSize: integer('batch_size').notNull(),
    maxBatches: integer('max_batches').notNull(),
    batchesProcessed: integer('batches_processed').notNull().default(0),
    candidatesSeen: integer('candidates_seen').notNull().default(0),
    refreshDueCount: integer('refresh_due_count').notNull().default(0),
    enqueuedCount: integer('enqueued_count').notNull().default(0),
    enqueueFailedCount: integer('enqueue_failed_count').notNull().default(0),
    /** Oldest contentExpiresAt among refresh-due rows seen (alert input). */
    oldestDueContentExpiresAt: timestamp('oldest_due_content_expires_at', {
      withTimezone: true,
    }),
    /** 'running' | 'completed' | 'budget_exhausted' | 'failed' */
    status: text('status').notNull().default('running'),
    failureReason: text('failure_reason'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  },
  (t) => [index('review_refresh_runs_started_at_idx').on(t.startedAt)],
)

/**
 * BQC-1.6 — retention/deletion evidence. One row per retention subject per
 * sweep: content-free evidence only (subject, timestamps, counts, outcome,
 * error code, policy version). No deleted IDs' content, no payload copies.
 */
export const retentionRuns = pgTable(
  'retention_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Retention subject, e.g. 'outbox_events.published', 'reviews.purge'. */
    subject: text('subject').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    batchSize: integer('batch_size').notNull(),
    batches: integer('batches').notNull().default(0),
    rowsDeleted: integer('rows_deleted').notNull().default(0),
    /** 'completed' | 'failed' */
    outcome: text('outcome').notNull().default('completed'),
    errorCode: text('error_code'),
    policyVersion: integer('policy_version').notNull().default(1),
  },
  (t) => [index('retention_runs_subject_started_idx').on(t.subject, t.startedAt)],
)

/** Dedup receipts for Google Pub/Sub (and future inbound webhooks). */
export const inboundWebhookReceipts = pgTable(
  'inbound_webhook_receipts',
  {
    provider: text('provider').notNull().default('google'),
    topic: text('topic').notNull(),
    messageId: text('message_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    notificationKind: text('notification_kind'),
    resolvedPropertyId: varchar('resolved_property_id', { length: 255 }),
    outcome: text('outcome'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.topic, t.messageId] })],
)
