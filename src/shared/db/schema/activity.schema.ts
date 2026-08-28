import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  index,
  uniqueIndex,
  integer,
  timestamp,
  check,
  bigint,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { createdAtColumn } from '../columns'

export const recentActivityEntries = pgTable(
  'recent_activity_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: varchar('actor_id', { length: 255 }).notNull(),
    actorName: varchar('actor_name', { length: 255 }).notNull(),
    actorAvatarUrl: text('actor_avatar_url'),
    actorRole: varchar('actor_role', { length: 50 }).notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    resourceId: varchar('resource_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    eventId: varchar('event_id', { length: 255 }),
    source: varchar('source', { length: 20 }).notNull().default('web'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('recent_activity_entries_resource_idx').on(
      t.resourceType,
      t.resourceId,
      t.createdAt,
    ),
    index('recent_activity_entries_org_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.createdAt,
    ),
    index('recent_activity_entries_event_id_idx').on(t.eventId),
    index('recent_activity_entries_actor_idx').on(t.actorId, t.createdAt),
    // ACT-006: enforce idempotency at the DB level — BullMQ delivers at-least-once,
    // so a unique constraint on (eventId, organizationId) is the TOCTOU-safe guard.
    uniqueIndex('recent_activity_entries_event_id_org_uniq').on(
      t.eventId,
      t.organizationId,
    ),
  ],
)

/**
 * Content-minimal receipts for explicitly authorized historical vocabulary
 * reconciliation. A receipt binds the exact tenant/source target set to its
 * reviewed canonical destination; it contains no row identifiers or payloads.
 */
export const recentActivityVocabularyReconciliations = pgTable(
  'recent_activity_vocabulary_reconciliations',
  {
    operationId: uuid('operation_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    sourceAction: varchar('source_action', { length: 50 }).notNull(),
    sourceResourceType: varchar('source_resource_type', { length: 50 }).notNull(),
    targetAction: varchar('target_action', { length: 50 }).notNull(),
    targetResourceType: varchar('target_resource_type', { length: 50 }).notNull(),
    targetFingerprintSha256: varchar('target_fingerprint_sha256', {
      length: 64,
    }).notNull(),
    targetCount: integer('target_count').notNull(),
    updatedCount: integer('updated_count').notNull(),
    authorizedBy: varchar('authorized_by', { length: 255 }).notNull(),
    authorizationEvidenceRef: varchar('authorization_evidence_ref', {
      length: 200,
    }).notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('recent_activity_vocabulary_reconciliations_org_time_idx').on(
      table.organizationId,
      table.appliedAt.desc(),
      table.operationId,
    ),
    check(
      'recent_activity_vocabulary_reconciliations_codes_valid',
      sql`${table.sourceAction} ~ '^[a-z][a-z0-9_]{0,49}$' AND ${table.sourceResourceType} ~ '^[a-z][a-z0-9_]{0,49}$' AND ${table.targetAction} ~ '^[a-z][a-z0-9_]{0,49}$' AND ${table.targetResourceType} ~ '^[a-z][a-z0-9_]{0,49}$'`,
    ),
    check(
      'recent_activity_vocabulary_reconciliations_fingerprint_valid',
      sql`${table.targetFingerprintSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'recent_activity_vocabulary_reconciliations_counts_valid',
      sql`${table.targetCount} >= 1 AND ${table.updatedCount} = ${table.targetCount}`,
    ),
    check(
      'recent_activity_vocabulary_reconciliations_evidence_ref_valid',
      sql`${table.authorizationEvidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$'`,
    ),
    check(
      'recent_activity_vocabulary_reconciliations_changes_kind',
      sql`${table.sourceAction} <> ${table.targetAction} OR ${table.sourceResourceType} <> ${table.targetResourceType}`,
    ),
  ],
)

/**
 * Activity-owned, content-free reconstruction authority for the 90-day
 * Recent Activity projection. It is deliberately independent from the shared
 * outbox FK lifecycle because published outbox rows expire after 30 days.
 */
export const recentActivityReplayFacts = pgTable(
  'recent_activity_replay_facts',
  {
    replayKey: varchar('replay_key', { length: 600 }).primaryKey(),
    projectionId: uuid('projection_id'),
    sourceKind: varchar('source_kind', { length: 40 }).notNull(),
    disposition: varchar('disposition', { length: 16 }).notNull(),
    sourceEventId: varchar('source_event_id', { length: 255 }),
    sourceEventType: text('source_event_type'),
    sourceEventVersion: integer('source_event_version'),
    sourceContext: text('source_context'),
    sourceAggregateId: text('source_aggregate_id'),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 }),
    actorSubjectId: varchar('actor_subject_id', { length: 255 }),
    actorLabelRedactedAt: timestamp('actor_label_redacted_at', {
      withTimezone: true,
    }),
    action: varchar('action', { length: 50 }),
    resourceType: varchar('resource_type', { length: 50 }),
    resourceId: varchar('resource_id', { length: 255 }),
    transitionPayload: jsonb('transition_payload'),
    source: varchar('source', { length: 20 }),
    sourceOccurredAt: timestamp('source_occurred_at', { withTimezone: true }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('recent_activity_replay_org_time_idx').on(
      table.organizationId,
      table.sourceOccurredAt.desc(),
      table.replayKey,
    ),
    index('recent_activity_replay_retention_idx').on(
      table.sourceOccurredAt,
      table.replayKey,
    ),
    index('recent_activity_replay_source_event_idx').on(
      table.sourceEventId,
      table.organizationId,
    ),
    index('recent_activity_replay_actor_idx').on(
      table.organizationId,
      table.actorSubjectId,
      table.replayKey,
    ),
    check(
      'recent_activity_replay_source_kind_check',
      sql`${table.sourceKind} IN ('durable_fact', 'legacy_projection_snapshot')`,
    ),
    check(
      'recent_activity_replay_disposition_check',
      sql`${table.disposition} IN ('projectable', 'obsolete')`,
    ),
    check(
      'recent_activity_replay_durable_source_check',
      sql`(${table.sourceKind} = 'durable_fact' AND ${table.sourceEventId} IS NOT NULL AND ${table.sourceEventType} IS NOT NULL AND ${table.sourceEventVersion} >= 1 AND ${table.sourceContext} IS NOT NULL AND ${table.sourceAggregateId} IS NOT NULL) OR (${table.sourceKind} = 'legacy_projection_snapshot' AND ${table.disposition} = 'projectable' AND ${table.sourceEventType} IS NULL AND ${table.sourceEventVersion} IS NULL AND ${table.sourceContext} IS NULL AND ${table.sourceAggregateId} IS NULL)`,
    ),
    check(
      'recent_activity_replay_projection_check',
      sql`(${table.disposition} = 'projectable' AND ${table.projectionId} IS NOT NULL AND ${table.action} IS NOT NULL AND ${table.resourceType} IS NOT NULL AND ${table.resourceId} IS NOT NULL AND ${table.transitionPayload} IS NOT NULL AND ${table.source} IN ('web', 'import')) OR (${table.disposition} = 'obsolete' AND ${table.projectionId} IS NULL AND ${table.actorSubjectId} IS NULL AND ${table.action} IS NULL AND ${table.resourceType} IS NULL AND ${table.resourceId} IS NULL AND ${table.transitionPayload} IS NULL AND ${table.source} IS NULL)`,
    ),
  ],
)

export type RecentActivityReplayFactRow = typeof recentActivityReplayFacts.$inferSelect

/**
 * Content-free, short-lived privacy fence. It prevents delayed durable facts or
 * a projection rebuild from restoring a label after an actor is anonymized.
 */
export const recentActivityActorLabelRedactions = pgTable(
  'recent_activity_actor_label_redactions',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    actorSubjectId: varchar('actor_subject_id', { length: 255 }).notNull(),
    redactedAt: timestamp('redacted_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'recent_activity_actor_label_redactions_pk',
      columns: [table.organizationId, table.actorSubjectId],
    }),
    index('recent_activity_actor_label_redactions_expiry_idx').on(
      table.expiresAt,
      table.organizationId,
      table.actorSubjectId,
    ),
    check(
      'recent_activity_actor_label_redactions_interval_check',
      sql`${table.expiresAt} > ${table.redactedAt}`,
    ),
  ],
)

/**
 * Tenant-local sequence authority for restricted Operational Action History.
 * This is deliberately separate from the Recent Activity projection and its
 * replay authority: sequence coverage is operational readiness evidence, not a
 * cryptographic or immutable-audit claim.
 */
export const operationalActionHistoryHeads = pgTable(
  'operational_action_history_heads',
  {
    organizationId: varchar('organization_id', { length: 255 }).primaryKey(),
    lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(0),
    lastRecordedAt: timestamp('last_recorded_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'operational_action_history_heads_sequence_nonnegative',
      sql`${table.lastSequence} >= 0`,
    ),
  ],
)

/**
 * Minimal, identifier-only Operational Action History authority. It has no
 * generic details/payload column by design. Migration 0149 installs mutation
 * guards which allow only hold-aware actor/resource identifier redaction.
 */
export const operationalActionHistoryRecords = pgTable(
  'operational_action_history_records',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    propertyId: varchar('property_id', { length: 255 }),
    actorType: varchar('actor_type', { length: 16 }).notNull(),
    actorId: varchar('actor_id', { length: 255 }),
    actorRedactedAt: timestamp('actor_redacted_at', { withTimezone: true }),
    action: varchar('action', { length: 80 }).notNull(),
    outcome: varchar('outcome', { length: 16 }).notNull(),
    resourceType: varchar('resource_type', { length: 40 }).notNull(),
    resourceId: varchar('resource_id', { length: 255 }),
    resourceRedactedAt: timestamp('resource_redacted_at', { withTimezone: true }),
    reasonCode: varchar('reason_code', { length: 128 }),
    provenanceKind: varchar('provenance_kind', { length: 32 }).notNull(),
    provenanceId: varchar('provenance_id', { length: 255 }).notNull(),
    sourceEventType: varchar('source_event_type', { length: 128 }),
    sourceEventVersion: integer('source_event_version'),
    sourceContext: varchar('source_context', { length: 128 }),
    sourceAggregateId: varchar('source_aggregate_id', { length: 255 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('operational_action_history_org_sequence_uniq').on(
      table.organizationId,
      table.sequence,
    ),
    uniqueIndex('operational_action_history_provenance_uniq').on(
      table.organizationId,
      table.provenanceKind,
      table.provenanceId,
    ),
    index('operational_action_history_org_time_idx').on(
      table.organizationId,
      table.occurredAt.desc(),
      table.sequence.desc(),
    ),
    index('operational_action_history_actor_idx').on(
      table.organizationId,
      table.actorId,
      table.occurredAt,
    ),
    index('operational_action_history_resource_idx').on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
      table.occurredAt,
    ),
    check('operational_action_history_sequence_positive', sql`${table.sequence} >= 1`),
    check(
      'operational_action_history_outcome_valid',
      sql`${table.outcome} IN ('succeeded', 'denied', 'failed')`,
    ),
    check(
      'operational_action_history_actor_valid',
      sql`(${table.actorType} IN ('user', 'operator', 'service') AND (${table.actorId} IS NOT NULL OR ${table.actorRedactedAt} IS NOT NULL)) OR (${table.actorType} IN ('system', 'public') AND ${table.actorId} IS NULL AND ${table.actorRedactedAt} IS NULL)`,
    ),
    check(
      'operational_action_history_resource_valid',
      sql`${table.resourceId} IS NOT NULL OR ${table.resourceRedactedAt} IS NOT NULL OR ${table.action} IN ('authentication.decision', 'authorization.decision')`,
    ),
    check(
      'operational_action_history_identifier_shape',
      sql`(${table.actorId} IS NULL OR ${table.actorId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') AND (${table.resourceId} IS NULL OR ${table.resourceId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') AND ${table.provenanceId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$' AND (${table.reasonCode} IS NULL OR ${table.reasonCode} ~ '^[a-z][a-z0-9_.:-]{0,127}$')`,
    ),
    check(
      'operational_action_history_provenance_valid',
      sql`(${table.provenanceKind} = 'domain_fact' AND ${table.sourceEventType} ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND ${table.sourceEventVersion} >= 1 AND ${table.sourceContext} ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND ${table.sourceAggregateId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') OR (${table.provenanceKind} IN ('policy_decision', 'interactive_command', 'worker_command', 'operator_command', 'history_access', 'history_lifecycle') AND ${table.sourceEventType} IS NULL AND ${table.sourceEventVersion} IS NULL AND ${table.sourceContext} IS NULL AND ${table.sourceAggregateId} IS NULL)`,
    ),
    check(
      'operational_action_history_kind_valid',
      sql`(${table.action} = 'authentication.decision' AND ${table.resourceType} = 'account') OR (${table.action} = 'authorization.decision' AND ${table.resourceType} = 'policy') OR (${table.action} = 'member.role_changed' AND ${table.resourceType} = 'member') OR (${table.action} = 'property_access.changed' AND ${table.resourceType} = 'property_grant') OR (${table.action} = 'sensitive_data.accessed' AND ${table.resourceType} = 'data_export') OR (${table.action} = 'sensitive_data.exported' AND ${table.resourceType} = 'data_export') OR (${table.action} = 'capability.changed' AND ${table.resourceType} = 'capability') OR (${table.action} = 'policy.changed' AND ${table.resourceType} = 'policy') OR (${table.action} = 'google_connection.connected' AND ${table.resourceType} = 'google_connection') OR (${table.action} = 'google_connection.disconnected' AND ${table.resourceType} = 'google_connection') OR (${table.action} = 'google_reply.published' AND ${table.resourceType} = 'reply') OR (${table.action} = 'guest_feedback.moderated' AND ${table.resourceType} = 'feedback') OR (${table.action} = 'portal_upload.validated' AND ${table.resourceType} = 'upload') OR (${table.action} = 'privacy_request.received' AND ${table.resourceType} = 'privacy_request') OR (${table.action} = 'privacy_request.fulfilled' AND ${table.resourceType} = 'privacy_request') OR (${table.action} = 'property.archived' AND ${table.resourceType} = 'property') OR (${table.action} = 'property.restored' AND ${table.resourceType} = 'property') OR (${table.action} = 'property.deleted' AND ${table.resourceType} = 'property') OR (${table.action} = 'portal.archived' AND ${table.resourceType} = 'portal') OR (${table.action} = 'portal.published' AND ${table.resourceType} = 'portal') OR (${table.action} = 'operator.command_executed' AND ${table.resourceType} = 'operator_command') OR (${table.action} = 'operational_history.accessed' AND ${table.resourceType} = 'operational_history') OR (${table.action} = 'operational_history.exported' AND ${table.resourceType} = 'operational_history') OR (${table.action} = 'operational_history.legal_hold_placed' AND ${table.resourceType} = 'operational_history') OR (${table.action} = 'operational_history.legal_hold_released' AND ${table.resourceType} = 'operational_history') OR (${table.action} = 'operational_history.redaction_applied' AND ${table.resourceType} = 'operational_history') OR (${table.action} = 'operational_history.retention_assessed' AND ${table.resourceType} = 'operational_history')`,
    ),
    check(
      'operational_action_history_time_valid',
      sql`${table.recordedAt} >= ${table.occurredAt} AND (${table.actorRedactedAt} IS NULL OR ${table.actorRedactedAt} >= ${table.recordedAt}) AND (${table.resourceRedactedAt} IS NULL OR ${table.resourceRedactedAt} >= ${table.recordedAt})`,
    ),
  ],
)

/** Active and released legal holds remain append-oriented lifecycle evidence. */
export const operationalActionHistoryLegalHolds = pgTable(
  'operational_action_history_legal_holds',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    reasonCode: varchar('reason_code', { length: 128 }).notNull(),
    protectsFrom: timestamp('protects_from', { withTimezone: true }).notNull(),
    protectsThrough: timestamp('protects_through', { withTimezone: true }),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
    placedByActorId: varchar('placed_by_actor_id', { length: 255 }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedByActorId: varchar('released_by_actor_id', { length: 255 }),
    releaseReasonCode: varchar('release_reason_code', { length: 128 }),
  },
  (table) => [
    index('operational_action_history_hold_org_idx').on(
      table.organizationId,
      table.releasedAt,
      table.protectsFrom,
    ),
    check(
      'operational_action_history_hold_interval_valid',
      sql`${table.protectsThrough} IS NULL OR ${table.protectsThrough} >= ${table.protectsFrom}`,
    ),
    check(
      'operational_action_history_hold_release_valid',
      sql`(${table.releasedAt} IS NULL AND ${table.releasedByActorId} IS NULL AND ${table.releaseReasonCode} IS NULL) OR (${table.releasedAt} IS NOT NULL AND ${table.releasedByActorId} IS NOT NULL AND ${table.releaseReasonCode} IS NOT NULL AND ${table.releasedAt} >= ${table.placedAt})`,
    ),
    check(
      'operational_action_history_hold_identifiers_valid',
      sql`${table.reasonCode} ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND ${table.placedByActorId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$' AND (${table.releasedByActorId} IS NULL OR ${table.releasedByActorId} ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') AND (${table.releaseReasonCode} IS NULL OR ${table.releaseReasonCode} ~ '^[a-z][a-z0-9_.:-]{0,127}$')`,
    ),
  ],
)

export type OperationalActionHistoryRecordRow =
  typeof operationalActionHistoryRecords.$inferSelect
