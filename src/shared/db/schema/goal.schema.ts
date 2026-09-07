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
  boolean,
  text,
  timestamp,
  index,
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
