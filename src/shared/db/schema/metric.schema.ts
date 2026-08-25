// Metric context — Drizzle schema for metric_definitions & metric_readings tables
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  real,
  numeric,
  integer,
  boolean,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { createdAtColumn } from '../columns'
import { properties } from './property.schema'
import { portals } from './portal.schema'
import { portalGroups } from './portal-group.schema'
export const metricDefinitions = pgTable(
  'metric_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    // Legacy expand columns retained until governed-reader cutover is proven.
    entityLevel: varchar('entity_level', { length: 20 }).notNull(),
    valueType: varchar('value_type', { length: 20 }).notNull(),
    description: text('description'),
    valueKind: varchar('value_kind', { length: 20 }).notNull().default('counter'),
    workerDataFlag: boolean('worker_data_flag').notNull().default(false),
    privacyClass: varchar('privacy_class', { length: 50 })
      .notNull()
      .default('operational'),
    retentionClass: varchar('retention_class', { length: 50 })
      .notNull()
      .default('standard'),
    lifecycleStatus: varchar('lifecycle_status', { length: 20 })
      .notNull()
      .default('draft'),
    approvalOwner: varchar('approval_owner', { length: 255 })
      .notNull()
      .default('migration-pending'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('metric_definitions_key_unique').on(t.metricKey),
    check(
      'metric_definitions_value_kind_check',
      sql`${t.valueKind} IN ('counter', 'duration', 'level', 'ratio', 'average')`,
    ),
    check(
      'metric_definitions_lifecycle_check',
      sql`${t.lifecycleStatus} IN ('draft', 'approved', 'retired')`,
    ),
  ],
)

export const metricDefinitionVersions = pgTable(
  'metric_definition_versions',
  {
    id: uuid('id').primaryKey(),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => metricDefinitions.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    numeratorDescription: text('numerator_description').notNull(),
    denominatorDescription: text('denominator_description'),
    unit: varchar('unit', { length: 50 }).notNull(),
    precision: integer('precision').notNull().default(0),
    aggregationRule: text('aggregation_rule').notNull(),
    lateArrivalRule: text('late_arrival_rule').notNull(),
    allowedScopes: jsonb('allowed_scopes').$type<readonly string[]>().notNull(),
    attributionRule: text('attribution_rule').notNull(),
    minimumSample: integer('minimum_sample').notNull().default(1),
    insufficientDataBehavior: varchar('insufficient_data_behavior', {
      length: 20,
    })
      .notNull()
      .default('unavailable'),
    sourcePolicyAllowlist: jsonb('source_policy_allowlist')
      .$type<readonly string[]>()
      .notNull(),
    permittedConsumers: jsonb('permitted_consumers').$type<readonly string[]>().notNull(),
    employmentDecisionEligible: boolean('employment_decision_eligible')
      .notNull()
      .default(false),
    correctionBehavior: varchar('correction_behavior', { length: 30 })
      .notNull()
      .default('append_delta'),
    fairnessReviewStatus: varchar('fairness_review_status', { length: 30 })
      .notNull()
      .default('not_required'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('metric_definition_versions_number_unique').on(t.definitionId, t.version),
    uniqueIndex('metric_definition_versions_definition_id_id_key').on(
      t.definitionId,
      t.id,
    ),
    index('metric_definition_versions_effective_idx').on(t.definitionId, t.effectiveFrom),
    check('metric_definition_versions_sample_check', sql`${t.minimumSample} >= 0`),
    check('metric_definition_versions_precision_check', sql`${t.precision} >= 0`),
    check(
      'metric_definition_versions_insufficient_check',
      sql`${t.insufficientDataBehavior} IN ('unavailable', 'quarantine')`,
    ),
    check(
      'metric_definition_versions_employment_check',
      sql`${t.employmentDecisionEligible} = false`,
    ),
  ],
)

export const metricReadings = pgTable(
  'metric_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => portalGroups.id, { onDelete: 'set null' }),
    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    // Legacy REAL value remains during expand/backfill; governed readers use exactValue.
    value: real('value').notNull(),
    definitionVersionId: uuid('definition_version_id').references(
      () => metricDefinitionVersions.id,
      { onDelete: 'restrict' },
    ),
    sourceEventId: varchar('source_event_id', { length: 255 }),
    sourcePolicy: varchar('source_policy', { length: 80 }),
    exactValue: numeric('exact_value', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }),
    numerator: numeric('numerator', { precision: 30, scale: 10, mode: 'number' }),
    denominator: numeric('denominator', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }),
    sampleCount: integer('sample_count'),
    attributionQuality: varchar('attribution_quality', { length: 40 }),
    // Legacy property name retained: occurredAt maps to the original recorded_at.
    occurredAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    eventAt: timestamp('event_at', { withTimezone: true }),
    propertyLocalDate: varchar('property_local_date', { length: 10 }),
    dataQuality: varchar('data_quality', { length: 20 }),
    retentionClass: varchar('retention_class', { length: 50 }),
  },
  (t) => [
    uniqueIndex('metric_readings_version_source_unique')
      .on(t.definitionVersionId, t.sourceEventId)
      .where(
        sql`${t.definitionVersionId} IS NOT NULL AND ${t.sourceEventId} IS NOT NULL`,
      ),
    index('metric_readings_org_idx').on(t.organizationId),
    index('metric_readings_org_key_recorded_idx').on(
      t.organizationId,
      t.metricKey,
      t.occurredAt,
    ),
    index('metric_readings_org_property_idx').on(t.organizationId, t.propertyId),
    index('metric_readings_org_portal_idx').on(t.organizationId, t.portalId),
    index('metric_readings_org_prop_recorded_idx').on(
      t.organizationId,
      t.propertyId,
      t.occurredAt,
    ),
    index('metric_readings_org_group_idx').on(t.organizationId, t.groupId),
    index('metric_readings_recorded_at_idx').on(t.occurredAt),
    index('metric_readings_version_event_idx').on(t.definitionVersionId, t.eventAt),
    check(
      'metric_readings_attribution_quality_check',
      sql`${t.attributionQuality} IS NULL OR ${t.attributionQuality} IN ('exact', 'current_state_backfill', 'unresolved')`,
    ),
    check(
      'metric_readings_ratio_check',
      sql`(${t.numerator} IS NULL AND ${t.denominator} IS NULL) OR (${t.numerator} IS NOT NULL AND ${t.denominator} IS NOT NULL AND ${t.denominator} > 0)`,
    ),
    check(
      'metric_readings_governed_provenance_check',
      sql`${t.definitionVersionId} IS NULL OR (${t.sourceEventId} IS NOT NULL AND ${t.sourcePolicy} IS NOT NULL AND ${t.exactValue} IS NOT NULL AND ${t.sampleCount} IS NOT NULL AND ${t.attributionQuality} IS NOT NULL AND ${t.eventAt} IS NOT NULL AND ${t.propertyLocalDate} IS NOT NULL AND ${t.dataQuality} IS NOT NULL AND ${t.retentionClass} IS NOT NULL)`,
    ),
  ],
)

export const metricCorrections = pgTable(
  'metric_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    readingId: uuid('reading_id')
      .notNull()
      .references(() => metricReadings.id, { onDelete: 'restrict' }),
    sourceEventId: varchar('source_event_id', { length: 255 }).notNull(),
    kind: varchar('kind', { length: 20 }).notNull(),
    reason: text('reason').notNull(),
    actorType: varchar('actor_type', { length: 20 }).notNull(),
    actorId: varchar('actor_id', { length: 255 }).notNull(),
    exactDelta: numeric('exact_delta', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }),
    replacementValue: numeric('replacement_value', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }),
    eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
    supersedesCorrectionId: uuid('supersedes_correction_id').references(
      (): AnyPgColumn => metricCorrections.id,
      { onDelete: 'restrict' },
    ),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('metric_corrections_source_unique').on(t.sourceEventId),
    uniqueIndex('metric_corrections_supersedes_unique')
      .on(t.supersedesCorrectionId)
      .where(sql`${t.supersedesCorrectionId} IS NOT NULL`),
    uniqueIndex('metric_corrections_root_unique')
      .on(t.readingId)
      .where(sql`${t.supersedesCorrectionId} IS NULL`),
    index('metric_corrections_reading_idx').on(t.readingId, t.recordedAt),
    check(
      'metric_corrections_kind_check',
      sql`${t.kind} IN ('retract', 'replace', 'adjust')`,
    ),
    check(
      'metric_corrections_operand_check',
      sql`(${t.kind} = 'retract' AND ${t.exactDelta} IS NULL AND ${t.replacementValue} IS NULL)
        OR (${t.kind} = 'replace' AND ${t.exactDelta} IS NULL AND ${t.replacementValue} IS NOT NULL)
        OR (${t.kind} = 'adjust' AND ${t.exactDelta} IS NOT NULL AND ${t.replacementValue} IS NULL)`,
    ),
  ],
)

export const metricQuarantine = pgTable(
  'metric_quarantine',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceEventId: varchar('source_event_id', { length: 255 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }),
    propertyId: uuid('property_id').references(() => properties.id, {
      onDelete: 'set null',
    }),
    definitionVersionId: uuid('definition_version_id').references(
      () => metricDefinitionVersions.id,
      { onDelete: 'restrict' },
    ),
    sourcePolicy: varchar('source_policy', { length: 80 }),
    reason: varchar('reason', { length: 80 }).notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    eventAt: timestamp('event_at', { withTimezone: true }),
    quarantinedAt: timestamp('quarantined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
  },
  (t) => [
    uniqueIndex('metric_quarantine_source_reason_unique').on(t.sourceEventId, t.reason),
    index('metric_quarantine_scope_idx').on(t.organizationId, t.propertyId),
  ],
)

export const metricSourceWatermarks = pgTable(
  'metric_source_watermarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consumerName: varchar('consumer_name', { length: 120 }).notNull(),
    sourceName: varchar('source_name', { length: 120 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').references(() => properties.id, {
      onDelete: 'cascade',
    }),
    definitionVersionId: uuid('definition_version_id').references(
      () => metricDefinitionVersions.id,
      { onDelete: 'restrict' },
    ),
    lastSourceEventId: varchar('last_source_event_id', { length: 255 }).notNull(),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('metric_source_watermarks_scope_unique').on(
      t.consumerName,
      t.sourceName,
      t.organizationId,
      t.propertyId,
      t.definitionVersionId,
    ),
  ],
)
