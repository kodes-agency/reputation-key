// Badge context — Drizzle schema for badge definitions, org enablements, and awards.
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  text,
  jsonb,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'
import { portals } from './portal.schema'
import { portalGroups } from './portal-group.schema'
import { metricDefinitionVersions } from './metric.schema'
import { recognitionBoardSnapshots } from './leaderboard.schema'

export const badgeDefinitions = pgTable(
  'badge_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    icon: varchar('icon', { length: 50 }).notNull().default('award'),
    targetScope: varchar('target_scope', { length: 20 }).notNull(),
    criteriaVersion: integer('criteria_version').notNull().default(1),
    criteriaJson: jsonb('criteria_json').notNull().$type<Record<string, unknown>>(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('badge_definitions_key_unique').on(t.key),
    index('badge_definitions_target_scope_idx').on(t.targetScope),
  ],
)

export const organizationBadgeEnablements = pgTable(
  'organization_badge_enablements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    badgeDefinitionId: uuid('badge_definition_id')
      .notNull()
      .references(() => badgeDefinitions.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('org_badge_enablements_org_definition_unique').on(
      t.organizationId,
      t.badgeDefinitionId,
    ),
    index('org_badge_enablements_org_idx').on(t.organizationId),
  ],
)

export const badgeAwards = pgTable(
  'badge_awards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    badgeDefinitionId: uuid('badge_definition_id')
      .notNull()
      .references(() => badgeDefinitions.id, { onDelete: 'cascade' }),
    criteriaVersion: integer('criteria_version').notNull(),
    targetType: varchar('target_type', { length: 20 }).notNull(),
    targetId: uuid('target_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'set null' }),
    portalGroupId: uuid('portal_group_id').references(() => portalGroups.id, {
      onDelete: 'set null',
    }),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull(),
    uniqueKey: varchar('unique_key', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('badge_awards_unique_key_unique').on(t.uniqueKey),
    index('badge_awards_org_property_idx').on(t.organizationId, t.propertyId),
    index('badge_awards_target_idx').on(t.targetType, t.targetId),
    index('badge_awards_portal_idx').on(t.portalId),
    index('badge_awards_group_idx').on(t.portalGroupId),
  ],
)

/** Immutable definition versions used by governed group recognition. */
export const badgeDefinitionVersions = pgTable(
  'badge_definition_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    badgeDefinitionId: uuid('badge_definition_id')
      .notNull()
      .references(() => badgeDefinitions.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    icon: varchar('icon', { length: 50 }).notNull(),
    criteria: text('criteria').notNull(),
    rule: text('rule').notNull(),
    metricDefinitionVersionId: uuid('metric_definition_version_id')
      .notNull()
      .references(() => metricDefinitionVersions.id, { onDelete: 'restrict' }),
    aggregation: varchar('aggregation', { length: 20 }).notNull(),
    threshold: numeric('threshold', {
      precision: 30,
      scale: 10,
      mode: 'number',
    }).notNull(),
    minimumExposure: integer('minimum_exposure').notNull(),
    minimumSample: integer('minimum_sample').notNull(),
    freshnessSeconds: integer('freshness_seconds').notNull(),
    minimumCompleteness: numeric('minimum_completeness', {
      precision: 6,
      scale: 5,
      mode: 'number',
    }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    employmentDecisionEligible: boolean('employment_decision_eligible')
      .notNull()
      .default(false),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('badge_definition_versions_number_unique').on(
      t.badgeDefinitionId,
      t.version,
    ),
    check(
      'badge_definition_versions_aggregation_check',
      sql`${t.aggregation} IN ('sum', 'latest', 'ratio')`,
    ),
    check(
      'badge_definition_versions_thresholds_check',
      sql`${t.minimumExposure} >= 1 AND ${t.minimumSample} >= 1 AND ${t.freshnessSeconds} > 0 AND ${t.minimumCompleteness} >= 0 AND ${t.minimumCompleteness} <= 1 AND ${t.threshold} >= 0`,
    ),
    check(
      'badge_definition_versions_employment_check',
      sql`${t.employmentDecisionEligible} = false`,
    ),
  ],
)

/**
 * Append-only group award facts. Corrections append a status fact below;
 * awards never cascade-delete with mutable definitions.
 */
export const governedBadgeAwards = pgTable(
  'recognition_awards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalGroupId: uuid('portal_group_id').notNull(),
    definitionVersionId: uuid('definition_version_id')
      .notNull()
      .references(() => badgeDefinitionVersions.id, { onDelete: 'restrict' }),
    metricDefinitionVersionId: uuid('metric_definition_version_id')
      .notNull()
      .references(() => metricDefinitionVersions.id, { onDelete: 'restrict' }),
    sourceSnapshotId: uuid('source_snapshot_id').notNull(),
    sourceFactId: varchar('source_fact_id', { length: 255 }).notNull(),
    sourceWatermark: timestamp('source_watermark', { withTimezone: true }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    timezone: varchar('timezone', { length: 100 }).notNull(),
    sampleCount: integer('sample_count').notNull(),
    exposureCount: integer('exposure_count').notNull(),
    completeness: numeric('completeness', {
      precision: 6,
      scale: 5,
      mode: 'number',
    }).notNull(),
    eligibilityReason: varchar('eligibility_reason', { length: 60 }).notNull(),
    definitionSnapshot: jsonb('definition_snapshot')
      .$type<{
        name: string
        icon: string
        criteria: string
        rule: string
        metricVersion: string
      }>()
      .notNull(),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull(),
    employmentDecisionEligible: boolean('employment_decision_eligible')
      .notNull()
      .default(false),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('recognition_awards_source_fact_unique').on(
      t.organizationId,
      t.propertyId,
      t.sourceFactId,
    ),
    uniqueIndex('recognition_awards_scope_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    index('recognition_awards_group_period_idx').on(
      t.organizationId,
      t.propertyId,
      t.portalGroupId,
      t.periodEnd,
    ),
    foreignKey({
      name: 'recognition_awards_portal_group_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalGroupId],
      foreignColumns: [
        portalGroups.organizationId,
        portalGroups.propertyId,
        portalGroups.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'recognition_awards_source_snapshot_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.sourceSnapshotId],
      foreignColumns: [
        recognitionBoardSnapshots.organizationId,
        recognitionBoardSnapshots.propertyId,
        recognitionBoardSnapshots.id,
      ],
    }).onDelete('restrict'),
    check('recognition_awards_period_check', sql`${t.periodEnd} > ${t.periodStart}`),
    check(
      'recognition_awards_evidence_check',
      sql`${t.sampleCount} >= 1 AND ${t.exposureCount} >= 1 AND ${t.completeness} >= 0 AND ${t.completeness} <= 1`,
    ),
    check(
      'recognition_awards_employment_check',
      sql`${t.employmentDecisionEligible} = false`,
    ),
  ],
)

export const governedBadgeAwardStatusFacts = pgTable(
  'recognition_award_status_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    awardId: uuid('award_id').notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    correctionReference: varchar('correction_reference', { length: 255 }),
    replacementAwardId: uuid('replacement_award_id'),
    replacementOrganizationId: varchar('replacement_organization_id', { length: 255 }),
    replacementPropertyId: uuid('replacement_property_id'),
    reason: text('reason').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('recognition_award_status_correction_unique')
      .on(t.awardId, t.correctionReference)
      .where(sql`${t.correctionReference} IS NOT NULL`),
    index('recognition_award_status_award_idx').on(t.awardId, t.occurredAt),
    foreignKey({
      name: 'recognition_award_status_award_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.awardId],
      foreignColumns: [
        governedBadgeAwards.organizationId,
        governedBadgeAwards.propertyId,
        governedBadgeAwards.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'recognition_award_status_replacement_tenant_fk',
      columns: [
        t.replacementOrganizationId,
        t.replacementPropertyId,
        t.replacementAwardId,
      ],
      foreignColumns: [
        governedBadgeAwards.organizationId,
        governedBadgeAwards.propertyId,
        governedBadgeAwards.id,
      ],
    }).onDelete('restrict'),
    check(
      'recognition_award_status_replacement_check',
      sql`(${t.status} = 'invalidated' AND ${t.replacementAwardId} IS NULL AND ${t.replacementOrganizationId} IS NULL AND ${t.replacementPropertyId} IS NULL) OR (${t.status} = 'superseded' AND ${t.replacementAwardId} IS NOT NULL AND ${t.replacementAwardId} <> ${t.awardId} AND ${t.replacementOrganizationId} = ${t.organizationId} AND ${t.replacementPropertyId} = ${t.propertyId})`,
    ),
    check(
      'recognition_award_status_check',
      sql`${t.status} IN ('invalidated', 'superseded')`,
    ),
  ],
)
