// Guest context — Drizzle schema for scan_events, ratings, feedback tables
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { portalPublicationSnapshots, portals } from './portal.schema'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'

export const scanEvents = pgTable(
  'scan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'restrict' }),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }),
    ipHash: text('ip_hash'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('scan_events_session_idx').on(t.sessionId),
    index('scan_events_portal_idx').on(t.portalId),
  ],
)

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'restrict' }),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }),
    value: integer('value').notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    ipHash: text('ip_hash'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('ratings_session_portal_unique').on(t.sessionId, t.portalId),
    index('ratings_portal_idx').on(t.portalId),
  ],
)

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'restrict' }),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }),
    ratingId: uuid('rating_id').references(() => ratings.id, { onDelete: 'set null' }),
    comment: text('comment').notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    ipHash: text('ip_hash'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    // F162: Unique constraint prevents duplicate feedback from same session+portal
    uniqueIndex('feedback_session_portal_unique').on(t.sessionId, t.portalId),
    index('feedback_portal_idx').on(t.portalId),
  ],
)

/**
 * Canonical guest response aggregate. The legacy ratings/feedback tables remain
 * read-only migration sources; new public writes target this table.
 */
export const guestResponses = pgTable(
  'guest_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    integrityOutcome: varchar('integrity_outcome', { length: 32 })
      .notNull()
      .default('accepted'),
    integrityReasonCode: varchar('integrity_reason_code', { length: 100 })
      .notNull()
      .default('legacy_included'),
    integrityRevision: integer('integrity_revision').notNull().default(1),
    integrityAssessedAt: timestamp('integrity_assessed_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    rating: integer('rating'),
    categoryId: uuid('category_id'),
    responseConsent: boolean('response_consent').notNull().default(false),
    textConsent: boolean('text_consent').notNull().default(false),
    mediaConsent: boolean('media_consent').notNull().default(false),
    privateFeedbackThreshold: integer('private_feedback_threshold'),
    ratingSourceEventId: varchar('rating_source_event_id', { length: 255 }),
    feedbackSourceEventId: varchar('feedback_source_event_id', { length: 255 }),
    correctionCount: integer('correction_count').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    correctedAt: timestamp('corrected_at', { withTimezone: true }),
    feedbackSubmittedAt: timestamp('feedback_submitted_at', { withTimezone: true }),
    feedbackWithdrawnAt: timestamp('feedback_withdrawn_at', { withTimezone: true }),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    retentionDeadline: timestamp('retention_deadline', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => [
    uniqueIndex('guest_responses_org_id_key').on(t.organizationId, t.id),
    uniqueIndex('guest_responses_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
    ),
    index('guest_responses_portal_status_idx').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.status,
    ),
    index('guest_responses_portal_integrity_idx').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.integrityOutcome,
    ),
    foreignKey({
      name: 'guest_responses_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'guest_responses_portal_property_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check(
      'guest_responses_status_valid',
      sql`${t.status} IN ('pending', 'submitted', 'corrected', 'moderated', 'deleted', 'expired')`,
    ),
    check(
      'guest_responses_integrity_outcome_valid',
      sql`${t.integrityOutcome} IN ('accepted', 'filtered_automatically', 'under_review')`,
    ),
    check(
      'guest_responses_integrity_reason_valid',
      sql`${t.integrityReasonCode} ~ '^[a-z0-9]+(_[a-z0-9]+)*$'`,
    ),
    check('guest_responses_integrity_revision_valid', sql`${t.integrityRevision} >= 1`),
    check(
      'guest_responses_rating_valid',
      sql`${t.rating} IS NULL OR (${t.rating} >= 1 AND ${t.rating} <= 5)`,
    ),
    check(
      'guest_responses_correction_count_valid',
      sql`${t.correctionCount} >= 0 AND ${t.correctionCount} <= 1`,
    ),
    check(
      'guest_responses_private_feedback_threshold_valid',
      sql`${t.privateFeedbackThreshold} IS NULL OR ${t.privateFeedbackThreshold} BETWEEN 1 AND 5`,
    ),
    check(
      'guest_responses_feedback_withdrawal_valid',
      sql`${t.feedbackWithdrawnAt} IS NULL OR (${t.feedbackSubmittedAt} IS NOT NULL AND ${t.textConsent} = false AND ${t.feedbackSourceEventId} IS NULL)`,
    ),
  ],
)

/**
 * Append-only explanation of every response-integrity decision. This table
 * deliberately contains no rating value, feedback text, session, or network
 * pseudonym: reviewers can audit eligibility without gaining guest content.
 */
export const guestResponseIntegrityDecisions = pgTable(
  'guest_response_integrity_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    responseId: uuid('response_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    revision: integer('revision').notNull(),
    previousOutcome: varchar('previous_outcome', { length: 32 }),
    outcome: varchar('outcome', { length: 32 }).notNull(),
    reasonCode: varchar('reason_code', { length: 100 }).notNull(),
    source: varchar('source', { length: 20 }).notNull(),
    actorId: varchar('actor_id', { length: 255 }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('guest_response_integrity_decisions_response_revision_key').on(
      t.responseId,
      t.revision,
    ),
    index('guest_response_integrity_decisions_scope_outcome_idx').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.outcome,
      t.decidedAt,
    ),
    foreignKey({
      name: 'guest_response_integrity_decisions_response_scope_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.responseId],
      foreignColumns: [
        guestResponses.organizationId,
        guestResponses.propertyId,
        guestResponses.portalId,
        guestResponses.id,
      ],
    }).onDelete('cascade'),
    check('guest_response_integrity_decisions_revision_valid', sql`${t.revision} >= 1`),
    check(
      'guest_response_integrity_decisions_initial_revision_valid',
      sql`(${t.revision} = 1 AND ${t.previousOutcome} IS NULL) OR (${t.revision} > 1 AND ${t.previousOutcome} IS NOT NULL)`,
    ),
    check(
      'guest_response_integrity_decisions_previous_outcome_valid',
      sql`${t.previousOutcome} IS NULL OR ${t.previousOutcome} IN ('accepted', 'filtered_automatically', 'under_review')`,
    ),
    check(
      'guest_response_integrity_decisions_outcome_valid',
      sql`${t.outcome} IN ('accepted', 'filtered_automatically', 'under_review')`,
    ),
    check(
      'guest_response_integrity_decisions_reason_valid',
      sql`${t.reasonCode} ~ '^[a-z0-9]+(_[a-z0-9]+)*$'`,
    ),
    check(
      'guest_response_integrity_decisions_source_valid',
      sql`${t.source} IN ('system', 'automatic', 'reviewer', 'migration')`,
    ),
  ],
)

/**
 * Immutable-by-contract submission context for a canonical Guest Response.
 * Historical rows intentionally have no backfilled record: current Portal
 * state must never be presented as evidence of an earlier guest experience.
 */
export const guestResponseExperienceSnapshots = pgTable(
  'guest_response_experience_snapshots',
  {
    responseId: uuid('response_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    publicationState: varchar('publication_state', { length: 20 }).notNull(),
    publicationSnapshotId: uuid('publication_snapshot_id'),
    publicationVersion: integer('publication_version'),
    publicationDigest: varchar('publication_digest', { length: 64 }),
    configurationDigest: varchar('configuration_digest', { length: 64 }).notNull(),
    guestLocale: varchar('guest_locale', { length: 35 }).notNull(),
    languagePackVersion: varchar('language_pack_version', { length: 100 }).notNull(),
    privateFeedbackThreshold: integer('private_feedback_threshold').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('guest_response_experience_snapshots_org_key').on(
      t.organizationId,
      t.responseId,
    ),
    foreignKey({
      name: 'guest_response_experience_snapshots_response_scope_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.responseId],
      foreignColumns: [
        guestResponses.organizationId,
        guestResponses.propertyId,
        guestResponses.portalId,
        guestResponses.id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'guest_response_experience_snapshots_publication_scope_fk',
      columns: [
        t.organizationId,
        t.propertyId,
        t.portalId,
        t.publicationSnapshotId,
        t.publicationVersion,
        t.publicationDigest,
      ],
      foreignColumns: [
        portalPublicationSnapshots.organizationId,
        portalPublicationSnapshots.propertyId,
        portalPublicationSnapshots.portalId,
        portalPublicationSnapshots.id,
        portalPublicationSnapshots.version,
        portalPublicationSnapshots.configurationDigest,
      ],
    }).onDelete('restrict'),
    check(
      'guest_response_experience_snapshots_publication_state_valid',
      sql`${t.publicationState} = 'published'`,
    ),
    check(
      'guest_response_experience_snapshots_configuration_digest_valid',
      sql`${t.configurationDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'guest_response_experience_snapshots_publication_reference_valid',
      sql`(${t.publicationSnapshotId} IS NULL AND ${t.publicationVersion} IS NULL AND ${t.publicationDigest} IS NULL) OR (${t.publicationSnapshotId} IS NOT NULL AND ${t.publicationVersion} >= 1 AND ${t.publicationDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      'guest_response_experience_snapshots_guest_locale_valid',
      sql`${t.guestLocale} ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'`,
    ),
    check(
      'guest_response_experience_snapshots_threshold_valid',
      sql`${t.privateFeedbackThreshold} BETWEEN 1 AND 5`,
    ),
  ],
)

/**
 * Short-lived recovery authority. Keeping the signed-session pseudonym outside
 * the response fact lets it disappear after 24 hours without deleting the
 * rating/tombstone needed by managerial analytics and correction lineage.
 */
export const guestResponseSessionBindings = pgTable(
  'guest_response_session_bindings',
  {
    responseId: uuid('response_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('guest_response_session_bindings_dedupe').on(
      t.organizationId,
      t.portalId,
      t.sessionId,
    ),
    index('guest_response_session_bindings_expiry_idx').on(t.expiresAt),
    foreignKey({
      name: 'guest_response_session_bindings_response_tenant_fk',
      columns: [t.organizationId, t.responseId],
      foreignColumns: [guestResponses.organizationId, guestResponses.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'guest_response_session_bindings_response_scope_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.responseId],
      foreignColumns: [
        guestResponses.organizationId,
        guestResponses.propertyId,
        guestResponses.portalId,
        guestResponses.id,
      ],
    }).onDelete('cascade'),
    check(
      'guest_response_session_bindings_live_window',
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
)

/**
 * Guest-authored private text has its own 90-day lifecycle. The response row
 * retains only consent/timestamps/lineage, so delayed text deletion can never
 * prolong the session pseudonym or the other way around.
 */
export const guestResponsePrivateFeedback = pgTable(
  'guest_response_private_feedback',
  {
    responseId: uuid('response_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    body: text('body').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('guest_response_private_feedback_expiry_idx').on(t.expiresAt),
    foreignKey({
      name: 'guest_response_private_feedback_response_tenant_fk',
      columns: [t.organizationId, t.responseId],
      foreignColumns: [guestResponses.organizationId, guestResponses.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'guest_response_private_feedback_response_scope_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.responseId],
      foreignColumns: [
        guestResponses.organizationId,
        guestResponses.propertyId,
        guestResponses.portalId,
        guestResponses.id,
      ],
    }).onDelete('cascade'),
    check(
      'guest_response_private_feedback_body_length',
      sql`char_length(${t.body}) BETWEEN 1 AND 2000`,
    ),
    check(
      'guest_response_private_feedback_live_window',
      sql`${t.expiresAt} > ${t.submittedAt}`,
    ),
  ],
)

/**
 * Short-lived correctness receipt for qualified destination actions. The
 * content-free outbox fact is retained independently; this session pseudonym
 * exists only for the signed-session dedupe window.
 */
export const guestDestinationActionReceipts = pgTable(
  'guest_destination_action_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    destinationId: varchar('destination_id', { length: 255 }).notNull(),
    destinationKind: varchar('destination_kind', { length: 24 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('guest_destination_action_receipts_dedupe').on(
      t.organizationId,
      t.portalId,
      t.sessionId,
      t.destinationKind,
      t.destinationId,
    ),
    index('guest_destination_action_receipts_expiry_idx').on(t.expiresAt),
    foreignKey({
      name: 'guest_destination_action_receipts_portal_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check(
      'guest_destination_action_receipts_kind_valid',
      sql`${t.destinationKind} IN ('google_review', 'secondary_link')`,
    ),
    check(
      'guest_destination_action_receipts_live_window',
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
)

/**
 * One durable row per media upload issuance. State transitions use a processing
 * lease so withdrawal/moderation deletion wins races with object confirmation.
 */
export const guestResponseMedia = pgTable(
  'guest_response_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    responseId: uuid('response_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    objectKey: varchar('object_key', { length: 700 }).notNull(),
    contentType: varchar('content_type', { length: 40 }).notNull(),
    declaredSizeBytes: integer('declared_size_bytes').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('issued'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    processingLease: uuid('processing_lease'),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    publicUrl: varchar('public_url', { length: 1000 }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => [
    uniqueIndex('guest_response_media_object_key_unique').on(t.objectKey),
    index('guest_response_media_response_status_idx').on(
      t.organizationId,
      t.responseId,
      t.status,
    ),
    foreignKey({
      name: 'guest_response_media_response_tenant_fk',
      columns: [t.organizationId, t.responseId],
      foreignColumns: [guestResponses.organizationId, guestResponses.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'guest_response_media_response_property_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.responseId],
      foreignColumns: [
        guestResponses.organizationId,
        guestResponses.propertyId,
        guestResponses.portalId,
        guestResponses.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'guest_response_media_portal_tenant_fk',
      columns: [t.organizationId, t.portalId],
      foreignColumns: [portals.organizationId, portals.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'guest_response_media_portal_property_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check(
      'guest_response_media_status_valid',
      sql`${t.status} IN ('issued', 'processing', 'ready', 'purge_pending', 'deleted', 'quarantined', 'expired')`,
    ),
    check(
      'guest_response_media_size_valid',
      sql`${t.declaredSizeBytes} > 0 AND ${t.declaredSizeBytes} <= 10485760`,
    ),
  ],
)

/**
 * A guest's request for a manager follow-up. Contact material is deliberately
 * outside the rating/feedback aggregate and is unreadable without an audited
 * reveal. Terminal states keep only a content-free lifecycle tombstone.
 */
export const guestContactRequests = pgTable(
  'guest_contact_requests',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    responseId: uuid('response_id').notNull(),
    publicationSnapshotId: uuid('publication_snapshot_id').notNull(),
    publicationVersion: integer('publication_version').notNull(),
    publicationDigest: varchar('publication_digest', { length: 64 }).notNull(),
    contactRequestEnabled: boolean('contact_request_enabled').notNull(),
    noticeId: varchar('notice_id', { length: 100 }).notNull(),
    noticeVersion: varchar('notice_version', { length: 100 }).notNull(),
    noticeDigest: varchar('notice_digest', { length: 64 }).notNull(),
    noticeLocale: varchar('notice_locale', { length: 35 }).notNull(),
    retentionPolicyVersion: varchar('retention_policy_version', {
      length: 100,
    }).notNull(),
    purpose: varchar('purpose', { length: 50 }).notNull(),
    consentGranted: boolean('consent_granted').notNull().default(false),
    encryptedContact: text('encrypted_contact'),
    encryptionKeyId: varchar('encryption_key_id', { length: 50 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('guest_contact_requests_org_id_key').on(t.organizationId, t.id),
    uniqueIndex('guest_contact_requests_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
    ),
    uniqueIndex('guest_contact_requests_response_key').on(t.organizationId, t.responseId),
    index('guest_contact_requests_expiry_idx').on(t.status, t.expiresAt, t.id),
    foreignKey({
      name: 'guest_contact_requests_response_scope_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.responseId],
      foreignColumns: [
        guestResponses.organizationId,
        guestResponses.propertyId,
        guestResponses.portalId,
        guestResponses.id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'guest_contact_requests_portal_scope_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'guest_contact_requests_publication_evidence_fk',
      columns: [
        t.organizationId,
        t.propertyId,
        t.portalId,
        t.publicationSnapshotId,
        t.publicationVersion,
        t.publicationDigest,
        t.contactRequestEnabled,
        t.noticeId,
        t.noticeVersion,
        t.noticeDigest,
        t.noticeLocale,
        t.purpose,
        t.retentionPolicyVersion,
      ],
      foreignColumns: [
        portalPublicationSnapshots.organizationId,
        portalPublicationSnapshots.propertyId,
        portalPublicationSnapshots.portalId,
        portalPublicationSnapshots.id,
        portalPublicationSnapshots.version,
        portalPublicationSnapshots.configurationDigest,
        portalPublicationSnapshots.contactRequestEnabled,
        portalPublicationSnapshots.contactNoticeId,
        portalPublicationSnapshots.contactNoticeVersion,
        portalPublicationSnapshots.contactNoticeDigest,
        portalPublicationSnapshots.contactNoticeLocale,
        portalPublicationSnapshots.contactRequestPurpose,
        portalPublicationSnapshots.contactRetentionPolicyVersion,
      ],
    }).onDelete('restrict'),
    check(
      'guest_contact_requests_purpose_valid',
      sql`${t.purpose} = 'manager_follow_up'`,
    ),
    check(
      'guest_contact_requests_key_id_valid',
      sql`${t.encryptionKeyId} IS NULL OR ${t.encryptionKeyId} ~ '^[a-z0-9][a-z0-9._-]{0,49}$'`,
    ),
    check(
      'guest_contact_requests_publication_evidence_valid',
      sql`${t.publicationVersion} >= 1
        AND ${t.publicationDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.contactRequestEnabled} = true
        AND char_length(${t.noticeId}) BETWEEN 1 AND 100
        AND char_length(${t.noticeVersion}) BETWEEN 1 AND 100
        AND ${t.noticeDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.noticeLocale} ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
        AND ${t.retentionPolicyVersion} = 'guest-contact-retention-30d-v1'`,
    ),
    check(
      'guest_contact_requests_retention_exact',
      sql`${t.expiresAt} = ${t.submittedAt} + INTERVAL '720:00:00'`,
    ),
    check(
      'guest_contact_requests_lifecycle_valid',
      sql`(
        ${t.status} = 'active'
        AND ${t.consentGranted} = true
        AND ${t.encryptedContact} IS NOT NULL
        AND ${t.encryptionKeyId} IS NOT NULL
        AND ${t.withdrawnAt} IS NULL
        AND ${t.purgedAt} IS NULL
      ) OR (
        ${t.status} = 'withdrawn'
        AND ${t.consentGranted} = false
        AND ${t.encryptedContact} IS NULL
        AND ${t.withdrawnAt} IS NOT NULL
        AND ${t.purgedAt} IS NULL
      ) OR (
        ${t.status} = 'expired'
        AND ${t.consentGranted} = false
        AND ${t.encryptedContact} IS NULL
        AND ${t.withdrawnAt} IS NULL
        AND ${t.purgedAt} IS NOT NULL
      )`,
    ),
  ],
)

/** Content-free evidence for every successful just-in-time reveal. */
export const guestContactRequestRevealAudits = pgTable(
  'guest_contact_request_reveal_audits',
  {
    id: uuid('id').primaryKey(),
    contactRequestId: uuid('contact_request_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    actorId: varchar('actor_id', { length: 255 }).notNull(),
    accessPurpose: varchar('access_purpose', { length: 50 }).notNull(),
    authorityBasis: varchar('authority_basis', { length: 32 }).notNull(),
    revealedAt: timestamp('revealed_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('guest_contact_reveal_audits_request_idx').on(
      t.organizationId,
      t.contactRequestId,
      t.revealedAt,
    ),
    foreignKey({
      name: 'guest_contact_reveal_audits_request_scope_fk',
      columns: [t.organizationId, t.propertyId, t.portalId, t.contactRequestId],
      foreignColumns: [
        guestContactRequests.organizationId,
        guestContactRequests.propertyId,
        guestContactRequests.portalId,
        guestContactRequests.id,
      ],
    }).onDelete('cascade'),
    check(
      'guest_contact_reveal_audits_purpose_valid',
      sql`${t.accessPurpose} = 'respond_to_contact_request'`,
    ),
    check(
      'guest_contact_reveal_audits_authority_valid',
      sql`${t.authorityBasis} IN ('account_admin', 'portal_creator', 'responsible_manager')`,
    ),
  ],
)

/** Restart-safe global checkpoint for the serialized 30-day purge authority. */
export const guestContactRequestPurgeCheckpoints = pgTable(
  'guest_contact_request_purge_checkpoints',
  {
    authority: varchar('authority', { length: 64 }).primaryKey(),
    cursorExpiresAt: timestamp('cursor_expires_at', { withTimezone: true }),
    cursorId: uuid('cursor_id'),
    completedThrough: timestamp('completed_through', { withTimezone: true }),
    processedCount: integer('processed_count').notNull().default(0),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    check(
      'guest_contact_purge_checkpoint_authority_valid',
      sql`${t.authority} = 'guest-contact-30d-v1'`,
    ),
    check(
      'guest_contact_purge_checkpoint_cursor_pair',
      sql`(${t.cursorExpiresAt} IS NULL) = (${t.cursorId} IS NULL)`,
    ),
    check('guest_contact_purge_checkpoint_count_valid', sql`${t.processedCount} >= 0`),
  ],
)
