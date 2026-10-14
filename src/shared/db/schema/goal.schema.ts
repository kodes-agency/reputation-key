import type { AnyPgColumn } from 'drizzle-orm/pg-core'
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  smallint,
  doublePrecision,
  boolean,
  text,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'
import { portals } from './portal.schema'
import { portalGroups } from './portal.schema'

// Canonical beta Goal Program storage. All Goal behavior is persisted in this
// family; the pre-beta and intermediate governed Goal families were removed.
export const goalPrograms = pgTable(
  'goal_programs',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('scheduled'),
    statusReason: text('status_reason'),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('goal_programs_org_property_id_key').on(t.organizationId, t.propertyId, t.id),
    index('goal_programs_property_status_idx').on(
      t.organizationId,
      t.propertyId,
      t.status,
    ),
    foreignKey({
      name: 'goal_programs_property_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check('goal_programs_name_check', sql`length(btrim(${t.name})) > 0`),
    check('goal_programs_version_check', sql`${t.currentVersion} >= 1`),
    check(
      'goal_programs_status_check',
      sql`${t.status} IN ('scheduled', 'active', 'paused', 'ended')`,
    ),
  ],
)

export const goalProgramVersions = pgTable(
  'goal_program_versions',
  {
    id: uuid('id').primaryKey(),
    programId: uuid('program_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    version: integer('version').notNull(),
    metricDefinitionId: uuid('metric_definition_id').notNull(),
    metricDefinitionVersionId: uuid('metric_definition_version_id').notNull(),
    metricKey: varchar('metric_key', { length: 40 }).notNull(),
    metricMinimumSample: integer('metric_minimum_sample').notNull(),
    targetValue: numeric('target_value', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }).notNull(),
    propertyTimezone: varchar('property_timezone', { length: 64 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    changeReason: text('change_reason').notNull(),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique('goal_program_versions_program_version_key').on(t.programId, t.version),
    unique('goal_program_versions_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    unique('goal_program_versions_assignment_fk_key').on(
      t.organizationId,
      t.propertyId,
      t.programId,
      t.id,
      t.metricKey,
    ),
    // What a month target change references, so its following version is one
    // of its own Program. An index, as migration 0054 built it.
    uniqueIndex('goal_program_versions_target_change_fk_key').on(
      t.organizationId,
      t.propertyId,
      t.programId,
      t.id,
    ),
    index('goal_program_versions_effective_idx').on(
      t.organizationId,
      t.propertyId,
      t.programId,
      t.effectiveFrom,
    ),
    foreignKey({
      name: 'goal_program_versions_program_fk',
      columns: [t.organizationId, t.propertyId, t.programId],
      foreignColumns: [
        goalPrograms.organizationId,
        goalPrograms.propertyId,
        goalPrograms.id,
      ],
    }).onDelete('restrict'),
    check('goal_program_versions_version_check', sql`${t.version} >= 1`),
    check(
      'goal_program_versions_metric_check',
      sql`${t.metricKey} IN ('qualified_scans', 'portal_rating_count', 'portal_rating_average')`,
    ),
    check(
      'goal_program_versions_metric_version_check',
      sql`(
        (${t.metricKey} = 'qualified_scans' AND ${t.metricDefinitionVersionId} = '11111111-1111-4111-8111-111111111301'::uuid)
        OR (${t.metricKey} = 'portal_rating_count' AND ${t.metricDefinitionVersionId} = '11111111-1111-4111-8111-111111111302'::uuid)
        OR (${t.metricKey} = 'portal_rating_average' AND ${t.metricDefinitionVersionId} = '11111111-1111-4111-8111-111111111303'::uuid)
      )`,
    ),
    check(
      'goal_program_versions_sample_check',
      sql`((${t.metricKey} IN ('qualified_scans', 'portal_rating_count') AND ${t.metricMinimumSample} = 0) OR (${t.metricKey} = 'portal_rating_average' AND ${t.metricMinimumSample} = 10))`,
    ),
    check(
      'goal_program_versions_target_check',
      sql`((${t.metricKey} IN ('qualified_scans', 'portal_rating_count') AND ${t.targetValue} > 0 AND ${t.targetValue} = trunc(${t.targetValue})) OR (${t.metricKey} = 'portal_rating_average' AND ${t.targetValue} BETWEEN 1 AND 5 AND ${t.targetValue} * 10 = trunc(${t.targetValue} * 10)))`,
    ),
    check(
      'goal_program_versions_effective_check',
      // A scheduled Program ended before its first month retains an immutable
      // but empty [from, from) definition interval. PostgreSQL range semantics
      // then release the subject immediately without deleting history.
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    check(
      'goal_program_versions_timezone_check',
      sql`length(btrim(${t.propertyTimezone})) > 0`,
    ),
    check(
      'goal_program_versions_reason_check',
      sql`length(btrim(${t.changeReason})) > 0`,
    ),
  ],
)

export const goalSubjectAssignments = pgTable(
  'goal_subject_assignments',
  {
    id: uuid('id').primaryKey(),
    programId: uuid('program_id').notNull(),
    programVersionId: uuid('program_version_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    metricKey: varchar('metric_key', { length: 40 }).notNull(),
    subjectKind: varchar('subject_kind', { length: 24 }).notNull(),
    propertySubjectId: uuid('property_subject_id'),
    portalGroupId: uuid('portal_group_id'),
    portalId: uuid('portal_id'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique('goal_subject_assignments_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    unique('goal_subject_assignments_result_fk_key').on(
      t.organizationId,
      t.propertyId,
      t.programId,
      t.programVersionId,
      t.id,
    ),
    index('goal_subject_assignments_program_idx').on(
      t.organizationId,
      t.propertyId,
      t.programId,
      t.effectiveFrom,
    ),
    index('goal_subject_assignments_subject_idx').on(
      t.organizationId,
      t.propertyId,
      t.subjectKind,
      t.propertySubjectId,
      t.portalGroupId,
      t.portalId,
    ),
    foreignKey({
      name: 'goal_subject_assignments_version_fk',
      columns: [
        t.organizationId,
        t.propertyId,
        t.programId,
        t.programVersionId,
        t.metricKey,
      ],
      foreignColumns: [
        goalProgramVersions.organizationId,
        goalProgramVersions.propertyId,
        goalProgramVersions.programId,
        goalProgramVersions.id,
        goalProgramVersions.metricKey,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goal_subject_assignments_property_subject_fk',
      columns: [t.organizationId, t.propertySubjectId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goal_subject_assignments_portal_group_fk',
      columns: [t.organizationId, t.propertyId, t.portalGroupId],
      foreignColumns: [
        portalGroups.organizationId,
        portalGroups.propertyId,
        portalGroups.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goal_subject_assignments_portal_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    check(
      'goal_subject_assignments_subject_check',
      sql`(
        (${t.subjectKind} = 'property' AND ${t.propertySubjectId} = ${t.propertyId} AND ${t.portalGroupId} IS NULL AND ${t.portalId} IS NULL)
        OR (${t.subjectKind} = 'portal_group' AND ${t.propertySubjectId} IS NULL AND ${t.portalGroupId} IS NOT NULL AND ${t.portalId} IS NULL)
        OR (${t.subjectKind} = 'portal' AND ${t.propertySubjectId} IS NULL AND ${t.portalGroupId} IS NULL AND ${t.portalId} IS NOT NULL)
      )`,
    ),
    check(
      'goal_subject_assignments_metric_check',
      sql`${t.metricKey} IN ('qualified_scans', 'portal_rating_count', 'portal_rating_average')`,
    ),
    check(
      'goal_subject_assignments_effective_check',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
)

export const goalMonthlyResults = pgTable(
  'goal_monthly_results',
  {
    id: uuid('id').primaryKey(),
    assignmentId: uuid('assignment_id').notNull(),
    programId: uuid('program_id').notNull(),
    programVersionId: uuid('program_version_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    propertyTimezone: varchar('property_timezone', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('open'),
    evaluationState: varchar('evaluation_state', { length: 24 })
      .notNull()
      .default('updating'),
    value: numeric('value', { precision: 30, scale: 10, mode: 'number' }),
    sampleCount: integer('sample_count').notNull().default(0),
    achieved: boolean('achieved'),
    reason: text('reason'),
    sourceCompleteThrough: timestamp('source_complete_through', {
      withTimezone: true,
    }),
    evaluationWatermark: timestamp('evaluation_watermark', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    // The target of this one month. NULL means the month uses its version's
    // target. guard_goal_monthly_result_v1 lets a row take or change one only
    // while it is open and its period has not ended, on INSERT and on UPDATE,
    // and holds it to the version's measure rule.
    targetValue: numeric('target_value', { precision: 30, scale: 10, mode: 'number' }),
  },
  (t) => [
    unique('goal_monthly_results_assignment_period_key').on(
      t.assignmentId,
      t.periodStart,
      t.periodEnd,
    ),
    unique('goal_monthly_results_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    // What a month target change references, so the month it names is one of
    // its own Program. An index, as migration 0054 built it.
    uniqueIndex('goal_monthly_results_target_change_fk_key').on(
      t.organizationId,
      t.propertyId,
      t.programId,
      t.id,
    ),
    index('goal_monthly_results_due_idx').on(
      t.status,
      t.periodEnd,
      t.organizationId,
      t.propertyId,
    ),
    foreignKey({
      name: 'goal_monthly_results_assignment_fk',
      columns: [
        t.organizationId,
        t.propertyId,
        t.programId,
        t.programVersionId,
        t.assignmentId,
      ],
      foreignColumns: [
        goalSubjectAssignments.organizationId,
        goalSubjectAssignments.propertyId,
        goalSubjectAssignments.programId,
        goalSubjectAssignments.programVersionId,
        goalSubjectAssignments.id,
      ],
    }).onDelete('restrict'),
    check('goal_monthly_results_bounds_check', sql`${t.periodEnd} > ${t.periodStart}`),
    check('goal_monthly_results_sample_check', sql`${t.sampleCount} >= 0`),
    check(
      'goal_monthly_results_status_check',
      sql`${t.status} IN ('open', 'reconciling', 'closed')`,
    ),
    check(
      'goal_monthly_results_state_check',
      sql`${t.evaluationState} IN ('eligible', 'updating', 'insufficient_data', 'unavailable', 'quarantined')`,
    ),
    check(
      'goal_monthly_results_value_state_check',
      sql`(${t.evaluationState} = 'eligible' AND ${t.value} IS NOT NULL AND ${t.achieved} IS NOT NULL AND ${t.reason} IS NULL) OR (${t.evaluationState} <> 'eligible' AND ${t.achieved} IS NULL)`,
    ),
    check(
      'goal_monthly_results_closed_check',
      sql`(${t.status} = 'closed' AND ${t.closedAt} IS NOT NULL AND ${t.evaluationWatermark} IS NOT NULL AND ${t.evaluationState} <> 'updating') OR (${t.status} <> 'closed' AND ${t.closedAt} IS NULL)`,
    ),
    check(
      'goal_monthly_results_source_check',
      sql`(
        ${t.sourceCompleteThrough} IS NULL OR ${t.sourceCompleteThrough} <= ${t.periodEnd}
      ) AND (
        ${t.status} <> 'closed'
        OR ${t.evaluationState} NOT IN ('eligible', 'insufficient_data')
        OR ${t.sourceCompleteThrough} = ${t.periodEnd}
      )`,
    ),
    check(
      'goal_monthly_results_target_value_check',
      sql`${t.targetValue} IS NULL OR ${t.targetValue} > 0`,
    ),
  ],
)

export const goalResultRevisions = pgTable(
  'goal_result_revisions',
  {
    id: uuid('id').primaryKey(),
    monthlyResultId: uuid('monthly_result_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    revision: integer('revision').notNull(),
    supersedesRevisionId: uuid('supersedes_revision_id').references(
      (): AnyPgColumn => goalResultRevisions.id,
      { onDelete: 'restrict' },
    ),
    evaluationState: varchar('evaluation_state', { length: 24 }).notNull(),
    value: numeric('value', { precision: 30, scale: 10, mode: 'number' }),
    sampleCount: integer('sample_count').notNull(),
    achieved: boolean('achieved'),
    reason: text('reason'),
    sourceCompleteThrough: timestamp('source_complete_through', {
      withTimezone: true,
    }),
    evaluationWatermark: timestamp('evaluation_watermark', {
      withTimezone: true,
    }).notNull(),
    changeReason: text('change_reason').notNull(),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique('goal_result_revisions_result_revision_key').on(t.monthlyResultId, t.revision),
    unique('goal_result_revisions_org_property_result_id_key').on(
      t.organizationId,
      t.propertyId,
      t.monthlyResultId,
      t.id,
    ),
    index('goal_result_revisions_history_idx').on(
      t.organizationId,
      t.propertyId,
      t.monthlyResultId,
      t.revision,
    ),
    foreignKey({
      name: 'goal_result_revisions_result_fk',
      columns: [t.organizationId, t.propertyId, t.monthlyResultId],
      foreignColumns: [
        goalMonthlyResults.organizationId,
        goalMonthlyResults.propertyId,
        goalMonthlyResults.id,
      ],
    }).onDelete('restrict'),
    check('goal_result_revisions_revision_check', sql`${t.revision} >= 1`),
    check('goal_result_revisions_sample_check', sql`${t.sampleCount} >= 0`),
    check(
      'goal_result_revisions_state_check',
      sql`${t.evaluationState} IN ('eligible', 'insufficient_data', 'unavailable', 'quarantined')`,
    ),
    check(
      'goal_result_revisions_value_state_check',
      sql`(${t.evaluationState} = 'eligible' AND ${t.value} IS NOT NULL AND ${t.achieved} IS NOT NULL AND ${t.reason} IS NULL) OR (${t.evaluationState} <> 'eligible' AND ${t.achieved} IS NULL)`,
    ),
    check(
      'goal_result_revisions_reason_check',
      sql`length(btrim(${t.changeReason})) > 0`,
    ),
  ],
)

// Every change to a month's own target: who, when, the old and the new value
// and an optional note. One command writes one row per month it changed, all
// sharing `changeId`, and never two for the same month. `followingOutcome`
// records what happened to the months after it. The month and the following
// version a row names belong to the Program it names. The application only
// appends rows; the table has no guard trigger, because it records a value
// from before the month closed, not closed evidence.
export const goalMonthTargetChanges = pgTable(
  'goal_month_target_changes',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    programId: uuid('program_id').notNull(),
    monthlyResultId: uuid('monthly_result_id').notNull(),
    changeId: uuid('change_id').notNull(),
    previousTargetValue: numeric('previous_target_value', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }).notNull(),
    newTargetValue: numeric('new_target_value', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }).notNull(),
    followingOutcome: varchar('following_outcome', { length: 32 }).notNull(),
    followingReason: varchar('following_reason', { length: 40 }),
    followingVersionId: uuid('following_version_id'),
    note: text('note'),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    unique('goal_month_target_changes_change_result_key').on(
      t.changeId,
      t.monthlyResultId,
    ),
    index('goal_month_target_changes_program_idx').on(
      t.organizationId,
      t.propertyId,
      t.programId,
      t.createdAt,
    ),
    foreignKey({
      name: 'goal_month_target_changes_result_fk',
      columns: [t.organizationId, t.propertyId, t.programId, t.monthlyResultId],
      foreignColumns: [
        goalMonthlyResults.organizationId,
        goalMonthlyResults.propertyId,
        goalMonthlyResults.programId,
        goalMonthlyResults.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goal_month_target_changes_program_fk',
      columns: [t.organizationId, t.propertyId, t.programId],
      foreignColumns: [
        goalPrograms.organizationId,
        goalPrograms.propertyId,
        goalPrograms.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goal_month_target_changes_following_version_fk',
      columns: [t.organizationId, t.propertyId, t.programId, t.followingVersionId],
      foreignColumns: [
        goalProgramVersions.organizationId,
        goalProgramVersions.propertyId,
        goalProgramVersions.programId,
        goalProgramVersions.id,
      ],
    }).onDelete('restrict'),
    check(
      'goal_month_target_changes_outcome_check',
      sql`${t.followingOutcome} IN ('applied', 'replaced_scheduled_change', 'kept_scheduled_change', 'not_applied', 'not_requested')`,
    ),
    check(
      'goal_month_target_changes_note_check',
      sql`${t.note} IS NULL OR char_length(btrim(${t.note})) BETWEEN 1 AND 500`,
    ),
    check(
      'goal_month_target_changes_value_check',
      sql`${t.newTargetValue} > 0 AND ${t.newTargetValue} <> ${t.previousTargetValue}`,
    ),
  ],
)

// Property Google rating goal (ADR 0067). Not a Goal Program: no months,
// subjects or metric readings. One active goal per Property, aimed at the
// one-decimal number Google shows. `source_epoch` is the Property's Google
// binding epoch when the goal was set; a goal outlives no change of it. The
// `last_*` columns are what the set or the last evaluation stored, so the next
// one can tell a transition (a tenth gained or lost, a new status) from a
// repeat.
// A CHECK passes when its expression is NULL, so every check below states
// `IS NOT NULL` wherever a nullable column must hold a value.
export const propertyRatingGoals = pgTable(
  'property_rating_goals',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    mode: varchar('mode', { length: 8 }).notNull(),
    targetTenths: smallint('target_tenths').notNull(),
    pacePerWeek: smallint('pace_per_week'),
    status: varchar('status', { length: 8 }).notNull().default('active'),
    endedReason: varchar('ended_reason', { length: 32 }),
    baselineReviewCount: integer('baseline_review_count').notNull(),
    baselineGoogleAverage: doublePrecision('baseline_google_average').notNull(),
    baselineExactAverage: doublePrecision('baseline_exact_average').notNull(),
    lastDisplayedTenths: smallint('last_displayed_tenths'),
    lastEvaluatedStatus: varchar('last_evaluated_status', { length: 24 }),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
    // What the goal's notices compare with (migration 0057): the last status
    // that was not a wait for Google, and when the managers were last told the
    // goal fell below pace, and that it can't be reached at the recent mix.
    lastKnownStatus: varchar('last_known_status', { length: 24 }),
    belowPaceNoticedAt: timestamp('below_pace_noticed_at', { withTimezone: true }),
    cantReachNoticedAt: timestamp('cant_reach_noticed_at', { withTimezone: true }),
    reachedAt: timestamp('reached_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    unique('property_rating_goals_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    uniqueIndex('property_rating_goals_one_active_idx')
      .on(t.organizationId, t.propertyId)
      .where(sql`${t.status} = 'active'`),
    index('property_rating_goals_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.createdAt,
    ),
    foreignKey({
      name: 'property_rating_goals_property_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    check(
      'property_rating_goals_source_epoch_check',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647`,
    ),
    check(
      'property_rating_goals_plan_check',
      sql`(${t.mode} = 'climb' AND ${t.pacePerWeek} IS NOT NULL AND ${t.targetTenths} BETWEEN 11 AND 49 AND ${t.pacePerWeek} BETWEEN 1 AND 200)
        OR (${t.mode} = 'keep' AND ${t.pacePerWeek} IS NULL AND ${t.targetTenths} BETWEEN 10 AND 50)`,
    ),
    check(
      'property_rating_goals_status_check',
      sql`(${t.status} = 'active' AND ${t.endedReason} IS NULL AND ${t.reachedAt} IS NULL AND ${t.endedAt} IS NULL)
        OR (${t.status} = 'reached' AND ${t.mode} = 'climb' AND ${t.endedReason} IS NULL AND ${t.reachedAt} IS NOT NULL AND ${t.endedAt} IS NULL)
        OR (${t.status} = 'ended' AND ${t.endedReason} IS NOT NULL AND ${t.endedReason} IN ('manager', 'google_location_changed', 'property_archived') AND ${t.reachedAt} IS NULL AND ${t.endedAt} IS NOT NULL)`,
    ),
    check(
      'property_rating_goals_baseline_check',
      sql`${t.baselineReviewCount} BETWEEN 1 AND 10000
        AND ${t.baselineGoogleAverage} BETWEEN 0 AND 5
        AND ${t.baselineExactAverage} BETWEEN 0 AND 5`,
    ),
    check(
      'property_rating_goals_evaluation_check',
      sql`(${t.lastDisplayedTenths} IS NULL OR ${t.lastDisplayedTenths} BETWEEN 0 AND 50)
        AND (${t.lastEvaluatedStatus} IS NULL OR ${t.lastEvaluatedStatus} IN ('waiting_for_google', 'reached', 'cant_reach_at_mix', 'getting_started', 'on_pace', 'below_pace', 'holding', 'dropped_below'))`,
    ),
    check(
      'property_rating_goals_notice_mark_check',
      sql`${t.lastKnownStatus} IS NULL OR ${t.lastKnownStatus} IN ('reached', 'cant_reach_at_mix', 'getting_started', 'on_pace', 'below_pace', 'holding', 'dropped_below')`,
    ),
    check('property_rating_goals_version_check', sql`${t.version} >= 1`),
  ],
)

// Each change to a rating goal's target, pace or mode: who, when, old -> new,
// one row per field. No reason (ADR 0067). Values are text: a target in
// tenths, a pace a week (NULL when a goal keeps instead), or a mode.
export const propertyRatingGoalChanges = pgTable(
  'property_rating_goal_changes',
  {
    id: uuid('id').primaryKey(),
    goalId: uuid('goal_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    changedBy: varchar('changed_by', { length: 255 }).notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
    field: varchar('field', { length: 8 }).notNull(),
    oldValue: varchar('old_value', { length: 8 }),
    newValue: varchar('new_value', { length: 8 }),
  },
  (t) => [
    index('property_rating_goal_changes_goal_idx').on(
      t.organizationId,
      t.propertyId,
      t.goalId,
      t.changedAt,
    ),
    foreignKey({
      name: 'property_rating_goal_changes_goal_fk',
      columns: [t.organizationId, t.propertyId, t.goalId],
      foreignColumns: [
        propertyRatingGoals.organizationId,
        propertyRatingGoals.propertyId,
        propertyRatingGoals.id,
      ],
    }).onDelete('restrict'),
    check(
      'property_rating_goal_changes_value_check',
      sql`${t.oldValue} IS DISTINCT FROM ${t.newValue} AND (
        (${t.field} = 'target' AND ${t.oldValue} IS NOT NULL AND ${t.newValue} IS NOT NULL
          AND ${t.oldValue} ~ '^([1-4][0-9]|50)$' AND ${t.newValue} ~ '^([1-4][0-9]|50)$')
        OR (${t.field} = 'pace'
          AND (${t.oldValue} IS NULL OR ${t.oldValue} ~ '^([1-9][0-9]?|1[0-9][0-9]|200)$')
          AND (${t.newValue} IS NULL OR ${t.newValue} ~ '^([1-9][0-9]?|1[0-9][0-9]|200)$'))
        OR (${t.field} = 'mode' AND ${t.oldValue} IS NOT NULL AND ${t.newValue} IS NOT NULL
          AND ${t.oldValue} IN ('climb', 'keep') AND ${t.newValue} IN ('climb', 'keep'))
      )`,
    ),
  ],
)
