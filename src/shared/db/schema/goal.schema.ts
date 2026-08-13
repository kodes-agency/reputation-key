import type { AnyPgColumn } from 'drizzle-orm/pg-core'
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
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  unique,
  primaryKey,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'
import { portals } from './portal.schema'
import { portalGroups } from './portal.schema'
import { metricDefinitionVersions, metricReadings } from './metric.schema'

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }),
    portalGroupId: uuid('portal_group_id').references(() => portalGroups.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    goalType: varchar('goal_type', { length: 20 }).notNull(),
    aggregationFunction: varchar('aggregation_function', { length: 20 }).notNull(),
    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    targetValue: real('target_value').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    recurrenceRule: jsonb('recurrence_rule').$type<{ frequency: string }>(),
    rollingWindowDays: integer('rolling_window_days'),
    parentGoalId: uuid('parent_goal_id').references((): AnyPgColumn => goals.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('goals_org_idx').on(t.organizationId),
    index('goals_org_property_idx').on(t.organizationId, t.propertyId),
    index('goals_org_status_idx').on(t.organizationId, t.status),
    index('goals_parent_idx').on(t.parentGoalId),
    index('goals_portal_group_idx').on(t.portalGroupId),
    index('goals_org_portal_idx').on(t.organizationId, t.portalId),
  ],
)

export const goalProgress = pgTable(
  'goal_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    currentValue: real('current_value').notNull().default(0),
    currentSum: real('current_sum'),
    currentCount: integer('current_count'),
    lastComputedAt: timestamp('last_computed_at', { withTimezone: true }).notNull(),
    computedSource: varchar('computed_source', { length: 20 }).notNull(),
  },
  (t) => [
    uniqueIndex('goal_progress_goal_uniq').on(t.goalId),
    index('goal_progress_org_idx').on(t.organizationId),
  ],
)

export const goalDefinitions = pgTable(
  'goal_definitions',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    scopeKind: varchar('scope_kind', { length: 30 }).notNull(),
    portalGroupId: uuid('portal_group_id'),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    statusReason: text('status_reason'),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('goal_definitions_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    index('goal_definitions_scope_status_idx').on(
      t.organizationId,
      t.propertyId,
      t.status,
      t.scopeKind,
    ),
    foreignKey({
      name: 'goal_definitions_org_property_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goal_definitions_portal_group_fk',
      columns: [t.organizationId, t.propertyId, t.portalGroupId],
      foreignColumns: [
        portalGroups.organizationId,
        portalGroups.propertyId,
        portalGroups.id,
      ],
    }).onDelete('restrict'),
    check(
      'goal_definitions_scope_check',
      sql`(${t.scopeKind} = 'property' AND ${t.portalGroupId} IS NULL) OR (${t.scopeKind} = 'portal_group' AND ${t.portalGroupId} IS NOT NULL)`,
    ),
    check(
      'goal_definitions_status_check',
      sql`${t.status} IN ('active', 'paused', 'cancelled')`,
    ),
    check('goal_definitions_version_check', sql`${t.currentVersion} >= 1`),
    check('goal_definitions_name_check', sql`length(btrim(${t.name})) > 0`),
  ],
)

export const goalDefinitionVersions = pgTable(
  'goal_definition_versions',
  {
    id: uuid('id').primaryKey(),
    definitionId: uuid('definition_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    version: integer('version').notNull(),
    metricDefinitionId: uuid('metric_definition_id').notNull(),
    metricDefinitionVersionId: uuid('metric_definition_version_id').notNull(),
    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    metricValueKind: varchar('metric_value_kind', { length: 20 }).notNull(),
    metricMinimumSample: integer('metric_minimum_sample').notNull(),
    metricAllowedScopes: jsonb('metric_allowed_scopes')
      .$type<readonly string[]>()
      .notNull(),
    metricPermittedConsumers: jsonb('metric_permitted_consumers')
      .$type<readonly string[]>()
      .notNull(),
    metricEmploymentDecisionEligible: boolean('metric_employment_decision_eligible')
      .notNull()
      .default(false),
    measureKind: varchar('measure_kind', { length: 20 }).notNull(),
    targetValue: numeric('target_value', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }).notNull(),
    sourcePolicy: varchar('source_policy', { length: 80 }).notNull(),
    propertyTimezone: varchar('property_timezone', { length: 64 }).notNull(),
    recurrenceRule: jsonb('recurrence_rule')
      .$type<Readonly<{ frequency: string; interval: number }>>()
      .notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    changeReason: text('change_reason').notNull(),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique('goal_definition_versions_definition_version_key').on(
      t.definitionId,
      t.version,
    ),
    unique('goal_definition_versions_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    unique('goal_definition_versions_org_property_definition_id_key').on(
      t.organizationId,
      t.propertyId,
      t.definitionId,
      t.id,
    ),
    index('goal_definition_versions_effective_idx').on(
      t.organizationId,
      t.propertyId,
      t.definitionId,
      t.effectiveFrom,
    ),
    foreignKey({
      name: 'goal_definition_versions_definition_fk',
      columns: [t.organizationId, t.propertyId, t.definitionId],
      foreignColumns: [
        goalDefinitions.organizationId,
        goalDefinitions.propertyId,
        goalDefinitions.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goal_definition_versions_metric_version_fk',
      columns: [t.metricDefinitionId, t.metricDefinitionVersionId],
      foreignColumns: [
        metricDefinitionVersions.definitionId,
        metricDefinitionVersions.id,
      ],
    }).onDelete('restrict'),
    check(
      'goal_definition_versions_kind_check',
      sql`${t.measureKind} IN ('progress', 'level', 'ratio')`,
    ),
    check('goal_definition_versions_target_check', sql`${t.targetValue} > 0`),
    check(
      'goal_definition_versions_metric_sample_check',
      sql`${t.metricMinimumSample} >= 1`,
    ),
    check(
      'goal_definition_versions_employment_check',
      sql`${t.metricEmploymentDecisionEligible} = false`,
    ),
    check(
      'goal_definition_versions_effective_check',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
)

export const goalPeriods = pgTable(
  'goal_periods',
  {
    id: uuid('id').primaryKey(),
    definitionId: uuid('definition_id').notNull(),
    definitionVersionId: uuid('definition_version_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    propertyTimezone: varchar('property_timezone', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('open'),
    statusReason: text('status_reason'),
    evaluationWatermark: timestamp('evaluation_watermark', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('goal_periods_identity_key').on(
      t.definitionId,
      t.definitionVersionId,
      t.periodStart,
      t.periodEnd,
    ),
    unique('goal_periods_org_property_id_key').on(t.organizationId, t.propertyId, t.id),
    unique('goal_periods_org_property_definition_version_id_key').on(
      t.organizationId,
      t.propertyId,
      t.definitionId,
      t.definitionVersionId,
      t.id,
    ),
    index('goal_periods_due_idx')
      .on(t.status, t.periodEnd, t.organizationId, t.propertyId)
      .where(sql`${t.status} IN ('scheduled', 'open')`),
    foreignKey({
      name: 'goal_periods_definition_fk',
      columns: [t.organizationId, t.propertyId, t.definitionId],
      foreignColumns: [
        goalDefinitions.organizationId,
        goalDefinitions.propertyId,
        goalDefinitions.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goal_periods_version_fk',
      columns: [t.organizationId, t.propertyId, t.definitionId, t.definitionVersionId],
      foreignColumns: [
        goalDefinitionVersions.organizationId,
        goalDefinitionVersions.propertyId,
        goalDefinitionVersions.definitionId,
        goalDefinitionVersions.id,
      ],
    }).onDelete('restrict'),
    check('goal_periods_bounds_check', sql`${t.periodEnd} > ${t.periodStart}`),
    check(
      'goal_periods_status_check',
      sql`${t.status} IN ('scheduled', 'open', 'closed', 'cancelled')`,
    ),
  ],
)

export const goalEvaluations = pgTable(
  'goal_evaluations',
  {
    id: uuid('id').primaryKey(),
    periodId: uuid('period_id').notNull(),
    definitionId: uuid('definition_id').notNull(),
    definitionVersionId: uuid('definition_version_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    metricReadingId: uuid('metric_reading_id').references(() => metricReadings.id, {
      onDelete: 'restrict',
    }),
    sourceEventId: varchar('source_event_id', { length: 255 }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    state: varchar('state', { length: 30 }).notNull(),
    reason: text('reason'),
    value: numeric('value', { precision: 30, scale: 10, mode: 'number' }),
    numerator: numeric('numerator', { precision: 30, scale: 10, mode: 'number' }),
    denominator: numeric('denominator', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }),
    sampleCount: integer('sample_count'),
    achieved: boolean('achieved').notNull().default(false),
    evaluationWatermark: timestamp('evaluation_watermark', {
      withTimezone: true,
    }).notNull(),
    supersedesEvaluationId: uuid('supersedes_evaluation_id').references(
      (): AnyPgColumn => goalEvaluations.id,
      { onDelete: 'restrict' },
    ),
    correctionReadingId: uuid('correction_reading_id').references(
      () => metricReadings.id,
      { onDelete: 'restrict' },
    ),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique('goal_evaluations_idempotency_key').on(
      t.organizationId,
      t.propertyId,
      t.idempotencyKey,
    ),
    unique('goal_evaluations_org_property_period_id_key').on(
      t.organizationId,
      t.propertyId,
      t.periodId,
      t.id,
    ),
    index('goal_evaluations_history_idx').on(
      t.organizationId,
      t.propertyId,
      t.periodId,
      t.createdAt,
    ),
    foreignKey({
      name: 'goal_evaluations_period_fk',
      columns: [
        t.organizationId,
        t.propertyId,
        t.definitionId,
        t.definitionVersionId,
        t.periodId,
      ],
      foreignColumns: [
        goalPeriods.organizationId,
        goalPeriods.propertyId,
        goalPeriods.definitionId,
        goalPeriods.definitionVersionId,
        goalPeriods.id,
      ],
    }).onDelete('restrict'),
    check(
      'goal_evaluations_state_check',
      sql`${t.state} IN ('eligible', 'insufficient_data', 'unavailable', 'quarantined')`,
    ),
    check(
      'goal_evaluations_ratio_check',
      sql`(${t.numerator} IS NULL AND ${t.denominator} IS NULL) OR (${t.numerator} IS NOT NULL AND ${t.denominator} IS NOT NULL AND ${t.denominator} > 0)`,
    ),
    check(
      'goal_evaluations_sample_check',
      sql`${t.sampleCount} IS NULL OR ${t.sampleCount} >= 0`,
    ),
    check(
      'goal_evaluations_value_state_check',
      sql`(${t.state} = 'eligible' AND ${t.value} IS NOT NULL) OR (${t.state} <> 'eligible' AND ${t.value} IS NULL AND ${t.achieved} = false)`,
    ),
  ],
)

export const goalTimezoneEventReceipts = pgTable(
  'goal_timezone_event_receipts',
  {
    sourceEventId: varchar('source_event_id', { length: 255 }).notNull(),
    definitionId: uuid('definition_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    propertyVersion: integer('property_version').notNull(),
    newDefinitionVersionId: uuid('new_definition_version_id').notNull(),
    newPeriodId: uuid('new_period_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceEventId, t.definitionId] }),
    foreignKey({
      name: 'goal_timezone_receipts_definition_fk',
      columns: [t.organizationId, t.propertyId, t.definitionId],
      foreignColumns: [
        goalDefinitions.organizationId,
        goalDefinitions.propertyId,
        goalDefinitions.id,
      ],
    }).onDelete('restrict'),
  ],
)

export const goalRefreshReceipts = pgTable(
  'goal_refresh_receipts',
  {
    sourceEventId: varchar('source_event_id', { length: 255 }).notNull(),
    periodId: uuid('period_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    evaluationId: uuid('evaluation_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceEventId, t.periodId] }),
    foreignKey({
      name: 'goal_refresh_receipts_period_fk',
      columns: [t.organizationId, t.propertyId, t.periodId],
      foreignColumns: [
        goalPeriods.organizationId,
        goalPeriods.propertyId,
        goalPeriods.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goal_refresh_receipts_evaluation_fk',
      columns: [t.organizationId, t.propertyId, t.periodId, t.evaluationId],
      foreignColumns: [
        goalEvaluations.organizationId,
        goalEvaluations.propertyId,
        goalEvaluations.periodId,
        goalEvaluations.id,
      ],
    }).onDelete('restrict'),
  ],
)
