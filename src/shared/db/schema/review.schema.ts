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
import { REPLY_LANGUAGE_TAG_SQL_PATTERN } from '../../reply-language-catalogue'
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
export const replyAuthorshipEnum = pgEnum('reply_authorship', ['human', 'ai_assisted'])

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    platform: reviewPlatformEnum('platform').notNull(),
    // Expand-phase compatibility cache. REV-01 keeps these columns until every
    // reader has cut over to review_source_contents, but lifecycle erasure can
    // now null them without deleting the stable Review identity.
    externalId: varchar('external_id', { length: 500 }),
    externalLocationId: varchar('external_location_id', { length: 500 }),
    googleConnectionId: uuid('google_connection_id').references(
      () => googleConnections.id,
      { onDelete: 'set null' },
    ),
    reviewerName: varchar('reviewer_name', { length: 255 }),
    reviewerProfilePhotoUrl: varchar('reviewer_profile_photo_url', { length: 1000 }),
    rating: integer('rating'),
    // Google concatenates its machine translation and the guest's original into
    // one `comment` field: "(Translated by Google) <en>\n\n(Original) <src>".
    // `text` holds the ORIGINAL — the AI language verifier must detect the
    // guest's language, not Google's English. The translation is kept for
    // display (migration 0061).
    text: text('text'),
    translatedText: text('translated_text'),
    languageCode: varchar('language_code', { length: 10 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
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
    sourceObservationSequence: bigint('source_observation_sequence', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    materialNormalizationVersion: varchar('material_normalization_version', {
      length: 64,
    }),
    materialSourceDigest: varchar('material_source_digest', { length: 64 }),
    materialNormalizedDigest: varchar('material_normalized_digest', { length: 64 }),
    analysisSequence: bigint('analysis_sequence', { mode: 'number' }).notNull(),
    aiSourceByteLength: integer('ai_source_byte_length'),
    aiSourceDigest: varchar('ai_source_digest', { length: 64 }),
    sourceContentState: varchar('source_content_state', { length: 24 })
      .notNull()
      .default('active'),
    sourceContentErasedAt: timestamp('source_content_erased_at', {
      withTimezone: true,
    }),
    replyStateRevision: bigint('reply_state_revision', { mode: 'number' })
      .notNull()
      .default(0),
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
      'reviews_source_observation_sequence_safe',
      sql`${t.sourceObservationSequence} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'reviews_material_comparison_head_valid',
      sql`(
        ${t.materialNormalizationVersion} IS NULL
        AND ${t.materialSourceDigest} IS NULL
        AND ${t.materialNormalizedDigest} IS NULL
      ) OR (
        ${t.materialNormalizationVersion} = 'legacy-unverified-v0'
        AND ${t.materialSourceDigest} IS NULL
        AND ${t.materialNormalizedDigest} IS NULL
      ) OR (
        ${t.materialNormalizationVersion} = 'review-material-v1'
        AND ${t.materialSourceDigest} IS NOT NULL
        AND ${t.materialSourceDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.materialNormalizedDigest} IS NOT NULL
        AND ${t.materialNormalizedDigest} ~ '^[0-9a-f]{64}$'
      )`,
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
    check(
      'reviews_reply_state_revision_safe',
      sql`${t.replyStateRevision} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'reviews_source_content_state_valid',
      sql`(
        ${t.sourceContentState} = 'active'
        AND ${t.sourceContentErasedAt} IS NULL
      ) OR (
        ${t.sourceContentState} IN ('source_expired', 'provider_deleted')
        AND ${t.sourceContentErasedAt} IS NOT NULL
        AND ${t.externalId} IS NULL
        AND ${t.externalLocationId} IS NULL
        AND ${t.googleConnectionId} IS NULL
        AND ${t.reviewerName} IS NULL
        AND ${t.reviewerProfilePhotoUrl} IS NULL
        AND ${t.rating} IS NULL
        AND ${t.text} IS NULL
        AND ${t.translatedText} IS NULL
        AND ${t.languageCode} IS NULL
        AND ${t.reviewedAt} IS NULL
        AND ${t.sourceCreatedAt} IS NULL
        AND ${t.sourceUpdatedAt} IS NULL
        AND ${t.contentHash} IS NULL
        AND ${t.aiSourceByteLength} IS NULL
        AND ${t.aiSourceDigest} IS NULL
      )`,
    ),
  ],
)

/**
 * The independently erasable provider-content cache for a stable Review.
 *
 * During the REV-01 expand phase writers dual-write this row and the nullable
 * compatibility columns on `reviews`. Readers remain on the compatibility
 * columns until shadow parity is sealed. Expiry/provider deletion removes this
 * row and scrubs those columns atomically; the Review, RepKey Reply, Inbox, and
 * audit identities remain.
 */
export const reviewSourceContents = pgTable(
  'review_source_contents',
  {
    reviewId: uuid('review_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
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
    translatedText: text('translated_text'),
    languageCode: varchar('language_code', { length: 10 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    firstFetchedAt: timestamp('first_fetched_at', { withTimezone: true }),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).notNull(),
    contentExpiresAt: timestamp('content_expires_at', { withTimezone: true }).notNull(),
    contentHash: text('content_hash'),
    sourceEpoch: integer('source_epoch').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    aiSourceByteLength: integer('ai_source_byte_length').notNull(),
    aiSourceDigest: varchar('ai_source_digest', { length: 64 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    foreignKey({
      name: 'review_source_contents_review_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.reviewId],
      foreignColumns: [reviews.organizationId, reviews.propertyId, reviews.id],
    }).onDelete('cascade'),
    uniqueIndex('review_source_contents_provider_identity_unique').on(
      t.platform,
      t.externalId,
      t.organizationId,
    ),
    index('review_source_contents_expiry_idx').on(t.contentExpiresAt, t.reviewId),
    index('review_source_contents_connection_idx').on(t.googleConnectionId),
    check('review_source_contents_rating_valid', sql`${t.rating} BETWEEN 1 AND 5`),
    check(
      'review_source_contents_epoch_revision_safe',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647
        AND ${t.sourceRevision} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    check(
      'review_source_contents_ai_source_valid',
      sql`${t.aiSourceByteLength} BETWEEN 1 AND '4294967295'::bigint
        AND ${t.aiSourceDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

/**
 * Stable, numbered business revisions. Provider content can be erased from a
 * revision while its identity and comparison evidence remain available to
 * RepKey-owned workflow records.
 */
export const materialReviewRevisions = pgTable(
  'material_review_revisions',
  {
    reviewId: uuid('review_id').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    normalizationVersion: varchar('normalization_version', { length: 64 }).notNull(),
    sourceDigest: varchar('source_digest', { length: 64 }),
    normalizedDigest: varchar('normalized_digest', { length: 64 }),
    rating: integer('rating'),
    normalizedText: text('normalized_text'),
    contentState: varchar('content_state', { length: 24 }).notNull().default('active'),
    contentErasedAt: timestamp('content_erased_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'material_review_revisions_pk',
      columns: [t.reviewId, t.revision],
    }),
    foreignKey({
      name: 'material_review_revisions_review_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.reviewId],
      foreignColumns: [reviews.organizationId, reviews.propertyId, reviews.id],
    }).onDelete('cascade'),
    index('material_review_revisions_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.reviewId,
      t.revision,
    ),
    check(
      'material_review_revisions_controls_safe',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647
        AND ${t.revision} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
    check(
      'material_review_revisions_comparison_valid',
      sql`(
        ${t.normalizationVersion} = 'legacy-unverified-v0'
        AND ${t.sourceDigest} IS NULL
        AND ${t.normalizedDigest} IS NULL
      ) OR (
        ${t.normalizationVersion} = 'review-material-v1'
        AND ${t.sourceDigest} IS NOT NULL
        AND ${t.sourceDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.normalizedDigest} IS NOT NULL
        AND ${t.normalizedDigest} ~ '^[0-9a-f]{64}$'
      )`,
    ),
    check(
      'material_review_revisions_content_state_valid',
      sql`(
        ${t.contentState} = 'active'
        AND ${t.contentErasedAt} IS NULL
        AND ${t.rating} IS NOT NULL
        AND ${t.rating} BETWEEN 1 AND 5
      ) OR (
        ${t.contentState} IN ('source_expired', 'provider_deleted')
        AND ${t.contentErasedAt} IS NOT NULL
        AND ${t.rating} IS NULL
        AND ${t.normalizedText} IS NULL
      )`,
    ),
  ],
)

/**
 * Versioned provider observations. An observation records both the exact and
 * normalized comparison digests; its material revision link changes only when
 * rating or normalized original guest text changes.
 */
export const reviewSourceObservations = pgTable(
  'review_source_observations',
  {
    reviewId: uuid('review_id').notNull(),
    observationSequence: bigint('observation_sequence', { mode: 'number' }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    observationKey: varchar('observation_key', { length: 64 }).notNull(),
    observationDigest: varchar('observation_digest', { length: 64 }).notNull(),
    materialRevision: bigint('material_revision', { mode: 'number' }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    contentExpiresAt: timestamp('content_expires_at', { withTimezone: true }).notNull(),
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    sourceDigest: varchar('source_digest', { length: 64 }),
    normalizationVersion: varchar('normalization_version', { length: 64 }).notNull(),
    normalizedDigest: varchar('normalized_digest', { length: 64 }),
    comparisonResult: varchar('comparison_result', { length: 40 }).notNull(),
    rating: integer('rating'),
    originalText: text('original_text'),
    translatedText: text('translated_text'),
    languageCode: varchar('language_code', { length: 10 }),
    reviewerName: varchar('reviewer_name', { length: 255 }),
    reviewerProfilePhotoUrl: varchar('reviewer_profile_photo_url', { length: 1000 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    contentState: varchar('content_state', { length: 24 }).notNull().default('active'),
    contentErasedAt: timestamp('content_erased_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'review_source_observations_pk',
      columns: [t.reviewId, t.observationSequence],
    }),
    foreignKey({
      name: 'review_source_observations_review_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.reviewId],
      foreignColumns: [reviews.organizationId, reviews.propertyId, reviews.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'review_source_observations_material_revision_fk',
      columns: [t.reviewId, t.materialRevision],
      foreignColumns: [
        materialReviewRevisions.reviewId,
        materialReviewRevisions.revision,
      ],
    }).onDelete('restrict'),
    uniqueIndex('review_source_observations_key_unique').on(
      t.reviewId,
      t.sourceEpoch,
      t.observationKey,
    ),
    index('review_source_observations_digest_idx').on(
      t.reviewId,
      t.sourceEpoch,
      t.observationDigest,
    ),
    index('review_source_observations_expiry_idx').on(
      t.contentState,
      t.contentExpiresAt,
      t.reviewId,
      t.observationSequence,
    ),
    check(
      'review_source_observations_controls_safe',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647
        AND ${t.observationSequence} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.materialRevision} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
    check(
      'review_source_observations_digest_valid',
      sql`${t.observationKey} ~ '^[0-9a-f]{64}$'
        AND ${t.observationDigest} ~ '^[0-9a-f]{64}$'
        AND (
          (${t.normalizationVersion} = 'legacy-unverified-v0'
            AND ${t.sourceDigest} IS NULL
            AND ${t.normalizedDigest} IS NULL)
          OR
          (${t.normalizationVersion} = 'review-material-v1'
            AND ${t.sourceDigest} IS NOT NULL
            AND ${t.sourceDigest} ~ '^[0-9a-f]{64}$'
            AND ${t.normalizedDigest} IS NOT NULL
            AND ${t.normalizedDigest} ~ '^[0-9a-f]{64}$')
        )`,
    ),
    check(
      'review_source_observations_comparison_valid',
      sql`${t.comparisonResult} IN (
        'backfilled_unverified',
        'initial_material_revision',
        'unchanged',
        'material_change',
        'normalization_shadow_match',
        'baseline_unavailable',
        'out_of_order_ignored'
      )`,
    ),
    check(
      'review_source_observations_content_state_valid',
      sql`(
        ${t.contentState} = 'active'
        AND ${t.contentErasedAt} IS NULL
        AND ${t.rating} IS NOT NULL
        AND ${t.rating} BETWEEN 1 AND 5
        AND ${t.reviewedAt} IS NOT NULL
      ) OR (
        ${t.contentState} IN ('source_expired', 'provider_deleted')
        AND ${t.contentErasedAt} IS NOT NULL
        AND ${t.rating} IS NULL
        AND ${t.originalText} IS NULL
        AND ${t.translatedText} IS NULL
        AND ${t.languageCode} IS NULL
        AND ${t.reviewerName} IS NULL
        AND ${t.reviewerProfilePhotoUrl} IS NULL
        AND ${t.reviewedAt} IS NULL
        AND ${t.sourceCreatedAt} IS NULL
        AND ${t.sourceUpdatedAt} IS NULL
      )`,
    ),
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
      .references(() => reviews.id, { onDelete: 'restrict' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    text: text('text').notNull(),
    // Canonical language selected for this reply's public text. Nullable for
    // legacy/provider-mirrored replies that predate language selection.
    replyLanguageTag: varchar('reply_language_tag', { length: 35 }),
    status: replyStatusEnum('status').notNull(),
    source: replySourceEnum('source').notNull(),
    createdBy: varchar('created_by', { length: 255 }),
    approvedBy: varchar('approved_by', { length: 255 }),
    rejectedBy: varchar('rejected_by', { length: 255 }),
    rejectionReason: text('rejection_reason'),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    authorship: replyAuthorshipEnum('authorship'),
    stateRevision: bigint('state_revision', { mode: 'number' }).notNull().default(1),
    originOperationId: uuid('origin_operation_id'),
    originSourceEpoch: integer('origin_source_epoch'),
    originSourceRevision: bigint('origin_source_revision', { mode: 'number' }),
    originBaseReplyStateRevision: bigint('origin_base_reply_state_revision', {
      mode: 'number',
    }),
    originReplyDraftingEpoch: integer('origin_reply_drafting_epoch'),
    originPropertyProfileVersion: integer('origin_property_profile_version'),
    originAiProfileVersion: varchar('origin_ai_profile_version', { length: 100 }),
    originReplyTemplateId: varchar('origin_reply_template_id', { length: 64 }),
    originReplyTemplateCatalogueVersion: varchar(
      'origin_reply_template_catalogue_version',
      { length: 100 },
    ),
    originReplyTemplateCatalogueDigest: varchar(
      'origin_reply_template_catalogue_digest',
      { length: 64 },
    ),
    originConcreteLanguageTag: varchar('origin_concrete_language_tag', {
      length: 35,
    }),
    originTemplateGroup: varchar('origin_template_group', { length: 35 }),
    aiDraftExpiresAt: timestamp('ai_draft_expires_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // BQC-3.8 (migration 0015): durable publication state machine overlay.
    // text + CHECK (replies_publication_state_check /
    // replies_publication_last_error_class_check), matching the hand-written
    // migration idiom — the allowed values are pinned by
    // PersistedPublicationState / PublicationFailureClass in the domain.
    publicationState: text('publication_state'),
    // RPL-01: monotonic authorization generation. Every approval,
    // edit-and-republish, or explicit retry advances it exactly once; durable
    // intents and publish jobs carry the generation as their stale-work fence.
    publicationCycle: bigint('publication_cycle', { mode: 'number' })
      .notNull()
      .default(0),
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
    check(
      'replies_state_revision_safe',
      sql`${t.stateRevision} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
    check(
      'replies_reply_language_tag_valid',
      sql`${t.replyLanguageTag} IS NULL OR ${t.replyLanguageTag} ~ ${sql.raw(`'${REPLY_LANGUAGE_TAG_SQL_PATTERN}'`)}`,
    ),
    uniqueIndex('replies_origin_operation_unique')
      .on(t.originOperationId)
      .where(sql`origin_operation_id IS NOT NULL`),
    check(
      'replies_authorship_valid',
      sql`(
        (${t.source} = 'google_sync' AND ${t.authorship} IS NULL AND ${t.aiGenerated} = false)
        OR (
          ${t.source} = 'internal'
          AND ${t.authorship} IS NOT NULL
          AND (
            (${t.aiGenerated} = false AND ${t.authorship} = 'human')
            OR (${t.aiGenerated} = true AND ${t.authorship} = 'ai_assisted')
          )
        )
      )`,
    ),
    check(
      'replies_ai_provenance_valid',
      sql`(
        (
          ${t.authorship} = 'ai_assisted'
          AND ${t.originOperationId} IS NOT NULL
          AND ${t.originSourceEpoch} >= 0
          AND ${t.originSourceRevision} >= 1
          AND ${t.originBaseReplyStateRevision} BETWEEN 0 AND '9007199254740991'::bigint
          AND ${t.originReplyDraftingEpoch} >= 1
          AND ${t.originPropertyProfileVersion} >= 1
          AND ${t.originAiProfileVersion} = 'reply-suggestion-v1'
          AND ${t.originReplyTemplateId} IN (
            'appreciation_positive',
            'appreciation_neutral',
            'recovery_service',
            'acknowledge_concern'
          )
          AND ${t.originReplyTemplateCatalogueVersion} = 'gbp-reply-template-catalogue-v1'
          AND ${t.originReplyTemplateCatalogueDigest} = 'ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f'
          AND ${t.originTemplateGroup} IN (
            'en-Latn', 'es-Latn', 'fr-Latn', 'de-Latn', 'pt-Latn',
            'it-Latn', 'nl-Latn', 'pl-Latn', 'tr-Latn', 'uk-Cyrl',
            'ru-Cyrl', 'ar-Arab', 'he-Hebr', 'hi-Deva', 'bn-Beng',
            'ta-Taml', 'th-Thai', 'vi-Latn', 'id-Latn', 'zh-Hans',
            'zh-Hant', 'ja-Jpan', 'ko-Kore', 'bg-Cyrl'
          )
          AND (
            ${t.originConcreteLanguageTag} = ${t.originTemplateGroup}
            OR ${t.originConcreteLanguageTag} ~~ (${t.originTemplateGroup} || '-%')
          )
          AND ${t.aiDraftExpiresAt} IS NOT NULL
        )
        OR (
          ${t.originOperationId} IS NULL
          AND ${t.originSourceEpoch} IS NULL
          AND ${t.originSourceRevision} IS NULL
          AND ${t.originBaseReplyStateRevision} IS NULL
          AND ${t.originReplyDraftingEpoch} IS NULL
          AND ${t.originPropertyProfileVersion} IS NULL
          AND ${t.originAiProfileVersion} IS NULL
          AND ${t.originReplyTemplateId} IS NULL
          AND ${t.originReplyTemplateCatalogueVersion} IS NULL
          AND ${t.originReplyTemplateCatalogueDigest} IS NULL
          AND ${t.originConcreteLanguageTag} IS NULL
          AND ${t.originTemplateGroup} IS NULL
          AND ${t.aiDraftExpiresAt} IS NULL
        )
      )`,
    ),
    // Migration 0015: publication state machine overlays (DO-block guarded).
    check(
      'replies_publication_state_check',
      sql`${t.publicationState} IN ('requested', 'authorized', 'sending', 'published', 'terminal', 'ambiguous', 'cancelled')`,
    ),
    check(
      'replies_publication_last_error_class_check',
      sql`${t.publicationLastErrorClass} IN ('terminal_rejection', 'retryable', 'ambiguous')`,
    ),
    check(
      'replies_publication_cycle_safe',
      sql`${t.publicationCycle} BETWEEN 0 AND '9007199254740991'::bigint`,
    ),
    // Migration 0015: ambiguous-outcome reconciliation sweep lookup.
    index('replies_publication_reconcile_idx')
      .on(t.organizationId, t.reconcileDueAt)
      .where(sql`publication_state = 'ambiguous' AND reconcile_due_at IS NOT NULL`),
  ],
)
