// Review context — Drizzle schema for reviews & replies tables

import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn } from '../columns'
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'
import { googleConnections } from './google-connection.schema'
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
})

export const reviewPlatformEnum = pgEnum('review_platform', ['google'])

export const replyStatusEnum = pgEnum('reply_status', [
  'draft',
  'pending_approval',
  'approved',
  'published',
  'rejected',
  'publish_failed',
])

export const replySourceEnum = pgEnum('reply_source', ['google_sync', 'internal'])

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    platform: reviewPlatformEnum('platform').notNull(),
    externalId: varchar('external_id', { length: 500 }).notNull(),
    externalLocationId: varchar('external_location_id', { length: 500 }).notNull(),
    googleConnectionId: uuid('google_connection_id').references(
      () => googleConnections.id,
      { onDelete: 'set null' },
    ),
    reviewerName: varchar('reviewer_name', { length: 255 }),
    reviewerProfilePhotoUrl: varchar('reviewer_profile_photo_url', { length: 1000 }),
    rating: integer('rating').notNull(),
    text: text('text'),
    languageCode: varchar('language_code', { length: 10 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    sentimentLabel: varchar('sentiment_label', { length: 20 }),
    sentimentScore: real('sentiment_score'),
    // PRE17B / BQR-1.1: Review source lifecycle (migration 0006)
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    firstFetchedAt: timestamp('first_fetched_at', { withTimezone: true }),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    contentExpiresAt: timestamp('content_expires_at', { withTimezone: true }),
    contentHash: text('content_hash'),
    sourceSeenGeneration: uuid('source_seen_generation'),
    sourceEpoch: integer('source_epoch').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    analysisSequence: bigint('analysis_sequence', { mode: 'number' }).notNull(),
    aiSourceByteLength: integer('ai_source_byte_length').notNull(),
    aiSourceDigest: varchar('ai_source_digest', { length: 64 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('reviews_platform_external_unique').on(
      t.platform,
      t.externalId,
      t.organizationId,
    ),
    uniqueIndex('reviews_tenant_identity_unique').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    index('reviews_property_idx').on(t.propertyId),
    index('reviews_org_idx').on(t.organizationId),
    index('reviews_expires_idx').on(t.expiresAt),
    // Composite index for dashboard review aggregation queries
    index('reviews_org_property_reviewed_idx').on(
      t.organizationId,
      t.propertyId,
      t.reviewedAt,
    ),
    index('reviews_google_connection_idx').on(t.googleConnectionId),
    // Migration 0006: incremental sync cursors (no text in covering indexes)
    index('reviews_property_updated_cursor_idx').on(
      t.propertyId,
      t.sourceUpdatedAt.desc(),
      t.id.desc(),
    ),
    index('reviews_property_created_cursor_idx').on(
      t.propertyId,
      t.sourceCreatedAt.desc(),
      t.id.desc(),
    ),
    index('reviews_content_expires_idx')
      .on(t.contentExpiresAt, t.id)
      .where(sql`content_expires_at IS NOT NULL`),
    check('reviews_source_epoch_safe', sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647`),
    check(
      'reviews_source_revision_safe',
      sql`${t.sourceRevision} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'reviews_analysis_sequence_safe',
      sql`${t.analysisSequence} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'reviews_ai_source_byte_length_valid',
      sql`${t.aiSourceByteLength} BETWEEN 1 AND '4294967295'::bigint`,
    ),
    check('reviews_ai_source_digest_valid', sql`${t.aiSourceDigest} ~ '^[0-9a-f]{64}$'`),
  ],
)

export const reviewSourceProvenanceQuarantine = pgTable(
  'review_source_provenance_quarantine',
  {
    reviewId: uuid('review_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    reason: text('reason').notNull(),
    quarantinedAt: timestamp('quarantined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('review_source_provenance_quarantine_org_idx').on(
      t.organizationId,
      t.quarantinedAt,
    ),
    check(
      'review_source_provenance_quarantine_reason_valid',
      sql`${t.reason} IN ('missing_property', 'cross_tenant_property')`,
    ),
  ],
)

export const reviewAiAnalysisHeads = pgTable(
  'review_ai_analysis_heads',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    headSequence: bigint('head_sequence', { mode: 'number' }).notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'review_ai_analysis_heads_pk',
      columns: [t.organizationId, t.propertyId, t.sourceEpoch],
    }),
    foreignKey({
      name: 'review_ai_analysis_heads_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
    check(
      'review_ai_analysis_heads_source_epoch_safe',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647`,
    ),
    check(
      'review_ai_analysis_heads_sequence_safe',
      sql`${t.headSequence} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
  ],
)

export const reviewProviderSubjectHmacKeyVersions = pgTable(
  'review_provider_subject_hmac_key_versions',
  {
    keyVersion: varchar('key_version', { length: 32 }).primaryKey(),
    keyDigest: varchar('key_digest', { length: 64 }).notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    createdAt: createdAtColumn(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    retiringAt: timestamp('retiring_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'review_provider_subject_key_version_valid',
      sql`${t.keyVersion} ~ '^[a-z0-9][a-z0-9._-]{0,31}$'`,
    ),
    check(
      'review_provider_subject_key_digest_valid',
      sql`${t.keyDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'review_provider_subject_key_state_valid',
      sql`${t.state} IN ('trusted_next', 'active', 'retiring')`,
    ),
    check(
      'review_provider_subject_key_generation_safe',
      sql`${t.generation} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
    uniqueIndex('review_provider_subject_one_active_idx')
      .on(t.state)
      .where(sql`${t.state} = 'active'`),
  ],
)

export const reviewProviderSnapshotRuns = pgTable(
  'review_provider_snapshot_runs',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    phase: varchar('phase', { length: 16 }).notNull(),
    expectedTotal: integer('expected_total'),
    mainCursorRef: varchar('main_cursor_ref', { length: 76 }),
    confirmationCursorRef: varchar('confirmation_cursor_ref', { length: 76 }),
    mainPageCount: integer('main_page_count').notNull().default(0),
    mainUniqueCount: integer('main_unique_count').notNull().default(0),
    confirmationPageCount: integer('confirmation_page_count').notNull().default(0),
    confirmationUniqueCount: integer('confirmation_unique_count').notNull().default(0),
    applyCursorReviewId: uuid('apply_cursor_review_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    confirmationDeadline: timestamp('confirmation_deadline', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    recordExpiresAt: timestamp('record_expires_at', { withTimezone: true }),
    failureCode: varchar('failure_code', { length: 64 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    foreignKey({
      name: 'review_provider_snapshot_runs_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
    uniqueIndex('review_provider_snapshot_one_active_idx')
      .on(t.organizationId, t.propertyId, t.sourceEpoch)
      .where(sql`${t.state} IN ('scanning', 'confirming', 'deleting')`),
    check(
      'review_provider_snapshot_runs_state_valid',
      sql`${t.state} IN ('scanning', 'confirming', 'deleting', 'completed', 'failed')`,
    ),
    check(
      'review_provider_snapshot_runs_phase_valid',
      sql`${t.phase} IN ('main', 'confirmation', 'apply', 'terminal')`,
    ),
    check(
      'review_provider_snapshot_runs_counts_valid',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647
        AND (${t.expectedTotal} IS NULL OR ${t.expectedTotal} BETWEEN 0 AND 10000)
        AND ${t.mainPageCount} BETWEEN 0 AND 200
        AND ${t.confirmationPageCount} BETWEEN 0 AND 200
        AND ${t.mainUniqueCount} BETWEEN 0 AND 10000
        AND ${t.confirmationUniqueCount} BETWEEN 0 AND 10000`,
    ),
    check(
      'review_provider_snapshot_runs_terminal_valid',
      sql`(
        (${t.state} IN ('completed', 'failed')
          AND ${t.terminalAt} IS NOT NULL
          AND ${t.recordExpiresAt} = ${t.terminalAt} + interval '30 days')
        OR
        (${t.state} NOT IN ('completed', 'failed')
          AND ${t.terminalAt} IS NULL
          AND ${t.recordExpiresAt} IS NULL)
      )`,
    ),
  ],
)

export const reviewProviderSubjects = pgTable(
  'review_provider_subjects',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    keyVersion: varchar('key_version', { length: 32 }).notNull(),
    locatorHmac: bytea('locator_hmac').notNull(),
    verifierHmac: bytea('verifier_hmac').notNull(),
    reviewId: uuid('review_id').notNull(),
    lastSourceRevision: bigint('last_source_revision', { mode: 'number' }).notNull(),
    state: varchar('state', { length: 24 }).notNull(),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }).notNull(),
    lastSeenSnapshotRunId: uuid('last_seen_snapshot_run_id'),
    firstMissingAt: timestamp('first_missing_at', { withTimezone: true }),
    firstMissingSnapshotRunId: uuid('first_missing_snapshot_run_id'),
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    unlinkExpiresAt: timestamp('unlink_expires_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'review_provider_subjects_pk',
      columns: [
        t.organizationId,
        t.propertyId,
        t.sourceEpoch,
        t.keyVersion,
        t.locatorHmac,
      ],
    }),
    foreignKey({
      name: 'review_provider_subjects_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'review_provider_subjects_key_version_fk',
      columns: [t.keyVersion],
      foreignColumns: [reviewProviderSubjectHmacKeyVersions.keyVersion],
    }).onDelete('restrict'),
    foreignKey({
      name: 'review_provider_subjects_last_seen_run_fk',
      columns: [t.lastSeenSnapshotRunId],
      foreignColumns: [reviewProviderSnapshotRuns.id],
    }).onDelete('set null'),
    uniqueIndex('review_provider_subjects_review_unique').on(
      t.organizationId,
      t.propertyId,
      t.sourceEpoch,
      t.reviewId,
    ),
    check(
      'review_provider_subjects_hmac_length_valid',
      sql`octet_length(${t.locatorHmac}) = 32 AND octet_length(${t.verifierHmac}) = 32`,
    ),
    check(
      'review_provider_subjects_controls_safe',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647
        AND ${t.lastSourceRevision} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'review_provider_subjects_state_valid',
      sql`${t.state} IN ('linked', 'source_expired', 'provider_deleted')`,
    ),
    check(
      'review_provider_subjects_unlink_valid',
      sql`(
        (${t.state} = 'linked' AND ${t.unlinkedAt} IS NULL AND ${t.unlinkExpiresAt} IS NULL)
        OR
        (${t.state} <> 'linked' AND ${t.unlinkedAt} IS NOT NULL
          AND ${t.unlinkExpiresAt} = ${t.unlinkedAt} + interval '2 years')
      )`,
    ),
    check(
      'review_provider_subjects_missing_pair_valid',
      sql`(${t.firstMissingAt} IS NULL) = (${t.firstMissingSnapshotRunId} IS NULL)`,
    ),
  ],
)

export const reviewProviderSnapshotMembers = pgTable(
  'review_provider_snapshot_members',
  {
    runId: uuid('run_id').notNull(),
    reviewId: uuid('review_id').notNull(),
    mainSeen: boolean('main_seen').notNull().default(false),
    confirmationSeen: boolean('confirmation_seen').notNull().default(false),
  },
  (t) => [
    primaryKey({
      name: 'review_provider_snapshot_members_pk',
      columns: [t.runId, t.reviewId],
    }),
    foreignKey({
      name: 'review_provider_snapshot_members_run_fk',
      columns: [t.runId],
      foreignColumns: [reviewProviderSnapshotRuns.id],
    }).onDelete('cascade'),
  ],
)

export const reviewProviderDeletionCandidates = pgTable(
  'review_provider_deletion_candidates',
  {
    runId: uuid('run_id').notNull(),
    reviewId: uuid('review_id').notNull(),
    expectedMappingState: varchar('expected_mapping_state', { length: 24 }).notNull(),
    expectedSourceRevision: bigint('expected_source_revision', {
      mode: 'number',
    }).notNull(),
    state: varchar('state', { length: 24 }).notNull().default('pending'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'review_provider_deletion_candidates_pk',
      columns: [t.runId, t.reviewId],
    }),
    foreignKey({
      name: 'review_provider_deletion_candidates_run_fk',
      columns: [t.runId],
      foreignColumns: [reviewProviderSnapshotRuns.id],
    }).onDelete('cascade'),
    check(
      'review_provider_deletion_candidates_state_valid',
      sql`${t.state} IN ('pending', 'confirmed_missing', 'observed')`,
    ),
    check(
      'review_provider_deletion_candidates_mapping_state_valid',
      sql`${t.expectedMappingState} IN ('linked', 'source_expired')`,
    ),
    check(
      'review_provider_deletion_candidates_revision_safe',
      sql`${t.expectedSourceRevision} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
  ],
)

export const replies = pgTable(
  'replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    text: text('text').notNull(),
    status: replyStatusEnum('status').notNull(),
    source: replySourceEnum('source').notNull(),
    createdBy: varchar('created_by', { length: 255 }),
    approvedBy: varchar('approved_by', { length: 255 }),
    rejectedBy: varchar('rejected_by', { length: 255 }),
    rejectionReason: text('rejection_reason'),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // BQC-3.8 (migration 0015): durable publication state machine overlay.
    // text + CHECK (replies_publication_state_check /
    // replies_publication_last_error_class_check), matching the hand-written
    // migration idiom — the allowed values are pinned by
    // PersistedPublicationState / PublicationFailureClass in the domain.
    publicationState: text('publication_state'),
    publicationAttempts: integer('publication_attempts').notNull().default(0),
    publicationLastErrorClass: text('publication_last_error_class'),
    reconcileDueAt: timestamp('reconcile_due_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  // NOTE: a partial unique index for one published reply per review does NOT
  // exist in the journaled migration track (it was a historical sidecar). If
  // the product wants that constraint it needs a new journaled migration —
  // drizzle 0.45 can express it via uniqueIndex(...).on(...).where(...).
  (t) => [
    uniqueIndex('replies_review_source_unique').on(
      t.reviewId,
      t.source,
      t.organizationId,
    ),
    index('replies_review_idx').on(t.reviewId),
    index('replies_org_idx').on(t.organizationId),
    // Migration 0015: publication state machine overlays (DO-block guarded).
    check(
      'replies_publication_state_check',
      sql`${t.publicationState} IN ('requested', 'authorized', 'sending', 'published', 'terminal', 'ambiguous', 'cancelled')`,
    ),
    check(
      'replies_publication_last_error_class_check',
      sql`${t.publicationLastErrorClass} IN ('terminal_rejection', 'retryable', 'ambiguous')`,
    ),
    // Migration 0015: ambiguous-outcome reconciliation sweep lookup.
    index('replies_publication_reconcile_idx')
      .on(t.organizationId, t.reconcileDueAt)
      .where(sql`publication_state = 'ambiguous' AND reconcile_due_at IS NOT NULL`),
  ],
)
