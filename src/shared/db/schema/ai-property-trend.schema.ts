// Property Trend schedule, scheduler head and outcome tables. They lived in
// `ai.schema.ts` until that module reached its file-length ceiling; nothing
// about them changed in the move.

import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { aiOperations } from './ai.schema'
import { propertyTenantForeignKey, timestamptz } from './ai-schema-helpers'

export const aiPropertyTrendSchedulerHeads = pgTable(
  'ai_property_trend_scheduler_heads',
  {
    schedulerKey: varchar('scheduler_key', { length: 64 }).primaryKey(),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    cursorOrganizationId: varchar('cursor_organization_id', { length: 255 }),
    cursorPropertyId: uuid('cursor_property_id'),
    leaseOwner: uuid('lease_owner'),
    claimedAt: timestamptz('claimed_at'),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    check(
      'ai_property_trend_scheduler_heads_valid',
      sql`${t.schedulerKey} = 'property-trend-v1' AND ${t.generation} BETWEEN 0 AND '9007199254740991'::bigint
        AND ((${t.cursorOrganizationId} IS NULL AND ${t.cursorPropertyId} IS NULL) OR (${t.cursorOrganizationId} IS NOT NULL AND ${t.cursorPropertyId} IS NOT NULL))
        AND ((${t.leaseOwner} IS NULL AND ${t.claimedAt} IS NULL AND ${t.leaseExpiresAt} IS NULL) OR (${t.leaseOwner} IS NOT NULL AND ${t.claimedAt} IS NOT NULL AND ${t.leaseExpiresAt} > ${t.claimedAt}))`,
    ),
  ],
)

export const aiPropertyTrendSchedules = pgTable(
  'ai_property_trend_schedules',
  {
    id: uuid('id').primaryKey(),
    outboxEventId: uuid('outbox_event_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    dueLocalDate: date('due_local_date', { mode: 'string' }).notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    reviewAnalysisEpoch: integer('review_analysis_epoch').notNull(),
    propertyTrendsEpoch: integer('property_trends_epoch').notNull(),
    propertyProfileVersion: integer('property_profile_version').notNull(),
    terminalAnalysisSequence: bigint('terminal_analysis_sequence', {
      mode: 'number',
    }).notNull(),
    aggregateRevision: bigint('aggregate_revision', { mode: 'number' }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    calendarProfileVersion: varchar('calendar_profile_version', {
      length: 100,
    }).notNull(),
    reportProfileVersion: varchar('report_profile_version', {
      length: 100,
    }).notNull(),
    schedulerGeneration: bigint('scheduler_generation', { mode: 'number' }).notNull(),
    scheduledAt: timestamptz('scheduled_at').notNull(),
  },
  (t) => [
    uniqueIndex('ai_property_trend_schedules_outbox_unique').on(t.outboxEventId),
    uniqueIndex('ai_property_trend_schedules_generation_unique').on(
      t.organizationId,
      t.propertyId,
      t.dueLocalDate,
      t.sourceEpoch,
      t.reviewAnalysisEpoch,
      t.propertyTrendsEpoch,
      t.propertyProfileVersion,
      t.terminalAnalysisSequence,
      t.aggregateRevision,
    ),
    propertyTenantForeignKey(t, 'ai_property_trend_schedules_tenant_fk'),
    check(
      'ai_property_trend_schedules_versions_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.reviewAnalysisEpoch} >= 1 AND ${t.propertyTrendsEpoch} >= 1
        AND ${t.propertyProfileVersion} >= 1 AND ${t.terminalAnalysisSequence} BETWEEN 0 AND '9007199254740991'::bigint
        AND ${t.aggregateRevision} BETWEEN 0 AND '9007199254740991'::bigint
        AND ${t.schedulerGeneration} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.timezone} ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'`,
    ),
    index('ai_property_trend_schedules_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.dueLocalDate.desc(),
    ),
  ],
)

export const aiPropertyTrendOutcomes = pgTable(
  'ai_property_trend_outcomes',
  {
    scheduleId: uuid('schedule_id')
      .primaryKey()
      .references(() => aiPropertyTrendSchedules.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    disposition: varchar('disposition', { length: 32 }).notNull(),
    operationId: uuid('operation_id').references(() => aiOperations.id, {
      onDelete: 'restrict',
    }),
    selectedSignalIds: jsonb('selected_signal_ids').$type<readonly string[]>(),
    signalKey: varchar('signal_key', { length: 64 }),
    direction: varchar('direction', { length: 20 }),
    confidenceBasisPoints: integer('confidence_basis_points'),
    supportingReviewCount: integer('supporting_review_count'),
    headline: varchar('headline', { length: 80 }),
    sentences: jsonb('sentences').$type<readonly string[]>(),
    summary: text('summary'),
    renderProfileVersion: varchar('render_profile_version', { length: 100 }),
    renderProfileDigest: varchar('render_profile_digest', { length: 64 }),
    definitionVersion: varchar('definition_version', { length: 100 }),
    definitionDigest: varchar('definition_digest', { length: 64 }),
    evidence: jsonb('evidence').$type<Readonly<Record<string, unknown>>>(),
    providerSelectionRecordedAt: timestamptz('provider_selection_recorded_at'),
    recordedAt: timestamptz('recorded_at').notNull(),
    expiresAt: timestamptz('expires_at'),
  },
  (t) => [
    uniqueIndex('ai_property_trend_outcomes_operation_unique')
      .on(t.operationId)
      .where(sql`${t.operationId} IS NOT NULL`),
    propertyTenantForeignKey(t, 'ai_property_trend_outcomes_tenant_fk'),
    check(
      'ai_property_trend_outcomes_valid',
      sql`(
        ${t.disposition} = 'ready'
        AND (${t.operationId} IS NOT NULL OR ${t.providerSelectionRecordedAt} IS NULL)
        AND jsonb_typeof(${t.selectedSignalIds}) = 'array'
        AND jsonb_array_length(${t.selectedSignalIds}) BETWEEN 1 AND 4
        AND ${t.signalKey} ~ '^[a-z][a-z0-9_.]{2,63}$'
        AND ${t.direction} IN ('improving', 'stable', 'declining')
        AND ${t.confidenceBasisPoints} BETWEEN 0 AND 10000
        AND ${t.supportingReviewCount} >= 0
        AND ${t.headline} IN ('Review signals improved', 'Review signals need attention', 'Notable review changes')
        AND jsonb_typeof(${t.sentences}) = 'array'
        AND jsonb_array_length(${t.sentences}) BETWEEN 1 AND 4
        AND length(${t.summary}) BETWEEN 1 AND 1000
        AND ${t.renderProfileVersion} = 'trend-render-v1'
        AND ${t.renderProfileDigest} ~ '^[0-9a-f]{64}$'
        AND (
          (${t.definitionVersion} IS NULL AND ${t.definitionDigest} IS NULL AND ${t.evidence} IS NULL)
          OR (${t.definitionVersion} = 'property-trend-definition-v1'
            AND ${t.definitionDigest} ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof(${t.evidence}) = 'object')
        )
        AND (
          (${t.operationId} IS NOT NULL
            AND ${t.providerSelectionRecordedAt} IS NOT NULL
            AND ${t.recordedAt} = ${t.providerSelectionRecordedAt})
          OR (${t.operationId} IS NULL AND ${t.providerSelectionRecordedAt} IS NULL)
        )
        AND ${t.expiresAt} > ${t.recordedAt}
      ) OR (
        ${t.disposition} IN ('updating', 'insufficient_data', 'no_material_change')
        AND ${t.operationId} IS NULL
        AND ${t.selectedSignalIds} IS NULL
        AND ${t.signalKey} IS NULL
        AND ${t.direction} IS NULL
        AND ${t.confidenceBasisPoints} IS NULL
        AND ${t.supportingReviewCount} IS NULL
        AND ${t.headline} IS NULL
        AND ${t.sentences} IS NULL
        AND ${t.summary} IS NULL
        AND ${t.renderProfileVersion} IS NULL
        AND ${t.renderProfileDigest} IS NULL
        AND (
          (${t.definitionVersion} IS NULL AND ${t.definitionDigest} IS NULL AND ${t.evidence} IS NULL AND ${t.expiresAt} IS NULL)
          OR (${t.definitionVersion} = 'property-trend-definition-v1'
            AND ${t.definitionDigest} ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof(${t.evidence}) = 'object'
            AND ${t.expiresAt} > ${t.recordedAt})
        )
        AND ${t.providerSelectionRecordedAt} IS NULL
      )`,
    ),
    index('ai_property_trend_outcomes_property_idx').on(
      t.organizationId,
      t.propertyId,
      t.recordedAt.desc(),
    ),
    index('ai_property_trend_outcomes_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
  ],
)
