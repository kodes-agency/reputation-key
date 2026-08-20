// Leaderboard context — Drizzle schema for leaderboard snapshots and entries.
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  integer,
  real,
  numeric,
  boolean,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { createdAtColumn } from '../columns'
import { properties } from './property.schema'
import { portalGroups } from './portal-group.schema'
import { metricDefinitions, metricDefinitionVersions } from './metric.schema'

export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    period: varchar('period', { length: 30 }).notNull(),
    scope: varchar('scope', { length: 20 }).notNull(),
    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    scoreKey: varchar('score_key', { length: 100 }).notNull().default('overall'),
    lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('leaderboard_snapshots_key_unique').on(
      t.propertyId,
      t.period,
      t.scope,
      t.metricKey,
      t.scoreKey,
    ),
    index('leaderboard_snapshots_property_idx').on(t.propertyId),
  ],
)

export const leaderboardEntries = pgTable(
  'leaderboard_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => leaderboardSnapshots.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    targetType: varchar('target_type', { length: 20 }).notNull(),
    targetId: uuid('target_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    metricValue: real('metric_value').notNull(),
    normalizedScore: real('normalized_score').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('leaderboard_entries_snapshot_rank_idx').on(t.snapshotId, t.rank),
    index('leaderboard_entries_target_idx').on(t.targetType, t.targetId),
  ],
)

/**
 * Property-local opt-in required before any badge or board work is visible or
 * scheduled. The legal/consultation facts are snapshotted rather than inferred
 * from a global feature flag.
 */
export const recognitionActivations = pgTable(
  'recognition_activations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    capabilityPolicyVersion: varchar('capability_policy_version', {
      length: 80,
    }).notNull(),
    jurisdiction: varchar('jurisdiction', { length: 80 }).notNull(),
    noticeStatus: varchar('notice_status', { length: 30 }).notNull(),
    consultationStatus: varchar('consultation_status', { length: 30 }).notNull(),
    metricDefinitionVersionId: uuid('metric_definition_version_id')
      .notNull()
      .references(() => metricDefinitionVersions.id, { onDelete: 'restrict' }),
    aggregation: varchar('aggregation', { length: 20 }).notNull(),
    periodKind: varchar('period_kind', { length: 20 }).notNull(),
    minimumExposure: integer('minimum_exposure').notNull(),
    minimumSample: integer('minimum_sample').notNull(),
    freshnessSeconds: integer('freshness_seconds').notNull(),
    minimumCompleteness: numeric('minimum_completeness', {
      precision: 6,
      scale: 5,
      mode: 'number',
    }).notNull(),
    audience: varchar('audience', { length: 80 }).notNull(),
    acknowledgedBy: varchar('acknowledged_by', { length: 255 }).notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull(),
    deactivationReason: text('deactivation_reason'),
    employmentDecisionEligible: boolean('employment_decision_eligible')
      .notNull()
      .default(false),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('recognition_activations_active_property_unique')
      .on(t.organizationId, t.propertyId)
      .where(sql`${t.status} = 'active' AND ${t.effectiveTo} IS NULL`),
    uniqueIndex('recognition_activations_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    index('recognition_activations_property_status_idx').on(
      t.organizationId,
      t.propertyId,
      t.status,
    ),
    foreignKey({
      name: 'recognition_activations_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'recognition_activations_status_check',
      sql`${t.status} IN ('active', 'inactive')`,
    ),
    check('recognition_activations_notice_check', sql`${t.noticeStatus} = 'completed'`),
    check(
      'recognition_activations_consultation_check',
      sql`${t.consultationStatus} IN ('completed', 'not_required')`,
    ),
    check(
      'recognition_activations_aggregation_check',
      sql`${t.aggregation} IN ('sum', 'latest', 'ratio')`,
    ),
    check(
      'recognition_activations_period_kind_check',
      sql`${t.periodKind} IN ('weekly', 'monthly', 'quarterly')`,
    ),
    check(
      'recognition_activations_thresholds_check',
      sql`${t.minimumExposure} >= 1 AND ${t.minimumSample} >= 1 AND ${t.freshnessSeconds} > 0 AND ${t.minimumCompleteness} >= 0 AND ${t.minimumCompleteness} <= 1`,
    ),
    check(
      'recognition_activations_audience_check',
      sql`${t.audience} = 'property_managers_and_scoped_staff'`,
    ),
    check(
      'recognition_activations_employment_check',
      sql`${t.employmentDecisionEligible} = false`,
    ),
    check(
      'recognition_activations_interval_check',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
)

export const recognitionActivationGroups = pgTable(
  'recognition_activation_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    activationId: uuid('activation_id').notNull(),
    portalGroupId: uuid('portal_group_id').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('recognition_activation_groups_unique').on(
      t.activationId,
      t.portalGroupId,
    ),
    index('recognition_activation_groups_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.portalGroupId,
    ),
    foreignKey({
      name: 'recognition_activation_groups_activation_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.activationId],
      foreignColumns: [
        recognitionActivations.organizationId,
        recognitionActivations.propertyId,
        recognitionActivations.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'recognition_activation_groups_portal_group_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalGroupId],
      foreignColumns: [
        portalGroups.organizationId,
        portalGroups.propertyId,
        portalGroups.id,
      ],
    }).onDelete('restrict'),
  ],
)

export const recognitionBoardSnapshots = pgTable(
  'recognition_board_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    activationId: uuid('activation_id').notNull(),
    metricDefinitionId: uuid('metric_definition_id')
      .notNull()
      .references(() => metricDefinitions.id, { onDelete: 'restrict' }),
    metricDefinitionVersionId: uuid('metric_definition_version_id')
      .notNull()
      .references(() => metricDefinitionVersions.id, { onDelete: 'restrict' }),
    aggregation: varchar('aggregation', { length: 20 }).notNull(),
    periodKind: varchar('period_kind', { length: 20 }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    timezone: varchar('timezone', { length: 100 }).notNull(),
    minimumExposure: integer('minimum_exposure').notNull(),
    minimumSample: integer('minimum_sample').notNull(),
    freshnessSeconds: integer('freshness_seconds').notNull(),
    minimumCompleteness: numeric('minimum_completeness', {
      precision: 6,
      scale: 5,
      mode: 'number',
    }).notNull(),
    sourceWatermark: timestamp('source_watermark', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    eligibilityReason: varchar('eligibility_reason', { length: 60 }),
    correctionGeneration: integer('correction_generation').notNull().default(0),
    employmentDecisionEligible: boolean('employment_decision_eligible')
      .notNull()
      .default(false),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('recognition_board_snapshots_key_unique').on(
      t.organizationId,
      t.propertyId,
      t.periodStart,
      t.periodEnd,
      t.metricDefinitionVersionId,
      t.sourceWatermark,
      t.correctionGeneration,
    ),
    uniqueIndex('recognition_board_snapshots_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    index('recognition_board_snapshots_property_period_idx').on(
      t.organizationId,
      t.propertyId,
      t.periodEnd,
    ),
    foreignKey({
      name: 'recognition_board_snapshots_activation_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.activationId],
      foreignColumns: [
        recognitionActivations.organizationId,
        recognitionActivations.propertyId,
        recognitionActivations.id,
      ],
    }).onDelete('restrict'),
    check(
      'recognition_board_snapshots_aggregation_check',
      sql`${t.aggregation} IN ('sum', 'latest', 'ratio')`,
    ),
    check(
      'recognition_board_snapshots_period_check',
      sql`${t.periodKind} IN ('weekly', 'monthly', 'quarterly')`,
    ),
    check(
      'recognition_board_snapshots_status_check',
      sql`${t.status} IN ('building', 'ready', 'stale', 'insufficient', 'corrected')`,
    ),
    check(
      'recognition_board_snapshots_thresholds_check',
      sql`${t.minimumExposure} >= 1 AND ${t.minimumSample} >= 1 AND ${t.freshnessSeconds} > 0 AND ${t.minimumCompleteness} >= 0 AND ${t.minimumCompleteness} <= 1`,
    ),
    check(
      'recognition_board_snapshots_period_bounds_check',
      sql`${t.periodEnd} > ${t.periodStart}`,
    ),
    check(
      'recognition_board_snapshots_employment_check',
      sql`${t.employmentDecisionEligible} = false`,
    ),
  ],
)

export const recognitionBoardEntries = pgTable(
  'recognition_board_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    portalGroupId: uuid('portal_group_id').notNull(),
    value: numeric('value', { precision: 30, scale: 10, mode: 'number' }),
    numerator: numeric('numerator', { precision: 30, scale: 10, mode: 'number' }),
    denominator: numeric('denominator', { precision: 30, scale: 10, mode: 'number' }),
    sampleCount: integer('sample_count').notNull(),
    exposureCount: integer('exposure_count').notNull(),
    completeness: numeric('completeness', {
      precision: 6,
      scale: 5,
      mode: 'number',
    }).notNull(),
    rank: integer('rank'),
    tieGroup: integer('tie_group'),
    eligibilityReason: varchar('eligibility_reason', { length: 60 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    sourceWatermark: timestamp('source_watermark', { withTimezone: true }).notNull(),
    correctionGeneration: integer('correction_generation').notNull().default(0),
    employmentDecisionEligible: boolean('employment_decision_eligible')
      .notNull()
      .default(false),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('recognition_board_entries_snapshot_group_unique').on(
      t.snapshotId,
      t.portalGroupId,
    ),
    index('recognition_board_entries_rank_idx').on(t.snapshotId, t.rank),
    foreignKey({
      name: 'recognition_board_entries_snapshot_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.snapshotId],
      foreignColumns: [
        recognitionBoardSnapshots.organizationId,
        recognitionBoardSnapshots.propertyId,
        recognitionBoardSnapshots.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'recognition_board_entries_portal_group_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalGroupId],
      foreignColumns: [
        portalGroups.organizationId,
        portalGroups.propertyId,
        portalGroups.id,
      ],
    }).onDelete('restrict'),
    check(
      'recognition_board_entries_status_check',
      sql`${t.status} IN ('ranked', 'insufficient', 'stale', 'corrected')`,
    ),
    check(
      'recognition_board_entries_rank_status_check',
      sql`(${t.status} IN ('ranked', 'corrected') AND ${t.rank} >= 1 AND ${t.tieGroup} >= 1) OR (${t.status} IN ('insufficient', 'stale') AND ${t.rank} IS NULL AND ${t.tieGroup} IS NULL)`,
    ),
    check(
      'recognition_board_entries_evidence_bounds_check',
      sql`${t.sampleCount} >= 0 AND ${t.exposureCount} >= 0 AND ${t.completeness} >= 0 AND ${t.completeness} <= 1`,
    ),
    check(
      'recognition_board_entries_ratio_consistency_check',
      sql`(${t.numerator} IS NULL AND ${t.denominator} IS NULL) OR (${t.numerator} IS NOT NULL AND ${t.denominator} IS NOT NULL AND ${t.denominator} > 0 AND ${t.value} IS NOT NULL AND abs(${t.value} - (${t.numerator} / ${t.denominator})) < 0.0000000001)`,
    ),
    check(
      'recognition_board_entries_employment_check',
      sql`${t.employmentDecisionEligible} = false`,
    ),
  ],
)

export const recognitionReconciliationEvents = pgTable(
  'recognition_reconciliation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    metricDefinitionVersionId: uuid('metric_definition_version_id')
      .notNull()
      .references(() => metricDefinitionVersions.id, { onDelete: 'restrict' }),
    sourceEventId: varchar('source_event_id', { length: 255 }).notNull(),
    correctionReference: varchar('correction_reference', { length: 255 }),
    sourceWatermark: timestamp('source_watermark', { withTimezone: true }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('recognition_reconciliation_events_source_unique').on(
      t.organizationId,
      t.propertyId,
      t.metricDefinitionVersionId,
      t.sourceEventId,
    ),
    index('recognition_reconciliation_events_watermark_idx').on(
      t.organizationId,
      t.propertyId,
      t.sourceWatermark,
    ),
  ],
)
