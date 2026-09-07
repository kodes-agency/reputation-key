// Metric context — Drizzle schema for governed readings and projections
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  real,
  numeric,
  bigint,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
  check,
  doublePrecision,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'
import { portals } from './portal.schema'
import { portalGroups } from './portal-group.schema'
import { portalResponsibilities, staffParticipations } from './people-access.schema'

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
    definitionVersionId: uuid('definition_version_id'),
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
    // Needed only until the governed source-fact retention boundary so the
    // anonymous lifetime aggregate can rebuild Google/secondary selections
    // without retaining a response, session, destination, or click id.
    portalDestinationKind: varchar('portal_destination_kind', { length: 24 }),
    attributedStaffParticipantId: uuid('attributed_staff_participant_id'),
    attributedStaffParticipationId: uuid('attributed_staff_participation_id'),
    attributionResponsibilityId: uuid('attribution_responsibility_id'),
    staffAttributionEffectiveFrom: timestamp('staff_attribution_effective_from', {
      withTimezone: true,
    }),
    staffAttributionEffectiveTo: timestamp('staff_attribution_effective_to', {
      withTimezone: true,
    }),
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
    foreignKey({
      name: 'metric_readings_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
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
    check(
      'metric_readings_staff_attribution_complete',
      sql`(${t.attributedStaffParticipantId} IS NULL AND ${t.attributedStaffParticipationId} IS NULL AND ${t.attributionResponsibilityId} IS NULL AND ${t.staffAttributionEffectiveFrom} IS NULL AND ${t.staffAttributionEffectiveTo} IS NULL) OR (${t.portalId} IS NOT NULL AND ${t.attributedStaffParticipantId} IS NOT NULL AND ${t.attributedStaffParticipationId} IS NOT NULL AND ${t.attributionResponsibilityId} IS NOT NULL AND ${t.staffAttributionEffectiveFrom} IS NOT NULL AND (${t.staffAttributionEffectiveTo} IS NULL OR ${t.staffAttributionEffectiveTo} > ${t.staffAttributionEffectiveFrom}))`,
    ),
    check(
      'metric_readings_portal_destination_kind_check',
      sql`${t.portalDestinationKind} IS NULL OR (${t.metricKey} = 'portal.review_link_click' AND ${t.portalDestinationKind} IN ('google_review', 'secondary_link'))`,
    ),
    foreignKey({
      name: 'metric_readings_staff_participant_scope_fk',
      columns: [
        t.organizationId,
        t.propertyId,
        t.attributedStaffParticipationId,
        t.attributedStaffParticipantId,
      ],
      foreignColumns: [
        staffParticipations.organizationId,
        staffParticipations.propertyId,
        staffParticipations.id,
        staffParticipations.staffParticipantId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'metric_readings_staff_responsibility_scope_fk',
      columns: [
        t.organizationId,
        t.propertyId,
        t.portalId,
        t.attributionResponsibilityId,
        t.attributedStaffParticipationId,
      ],
      foreignColumns: [
        portalResponsibilities.organizationId,
        portalResponsibilities.propertyId,
        portalResponsibilities.portalId,
        portalResponsibilities.id,
        portalResponsibilities.staffParticipationId,
      ],
    }).onDelete('restrict'),
  ],
)

/**
 * Anonymous, Property/Portal-owned lifetime analytics. `sealed_*` is the
 * content-free baseline for source facts already beyond the purge boundary;
 * rebuilds add the still-retained effective readings to that baseline. The
 * row intentionally has no source/response/session/contact id and no Guest
 * activity timestamp.
 */
export const portalMetricLifetimeAggregates = pgTable(
  'portal_metric_lifetime_aggregates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),

    qualifiedScanCount: bigint('qualified_scan_count', { mode: 'number' })
      .notNull()
      .default(0),
    privateRatingCount: bigint('private_rating_count', { mode: 'number' })
      .notNull()
      .default(0),
    privateRatingSum: bigint('private_rating_sum', { mode: 'number' })
      .notNull()
      .default(0),
    privateRating1Count: bigint('private_rating_1_count', { mode: 'number' })
      .notNull()
      .default(0),
    privateRating2Count: bigint('private_rating_2_count', { mode: 'number' })
      .notNull()
      .default(0),
    privateRating3Count: bigint('private_rating_3_count', { mode: 'number' })
      .notNull()
      .default(0),
    privateRating4Count: bigint('private_rating_4_count', { mode: 'number' })
      .notNull()
      .default(0),
    privateRating5Count: bigint('private_rating_5_count', { mode: 'number' })
      .notNull()
      .default(0),
    privateFeedbackCount: bigint('private_feedback_count', { mode: 'number' })
      .notNull()
      .default(0),
    googleReviewSelectionCount: bigint('google_review_selection_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    secondaryLinkSelectionCount: bigint('secondary_link_selection_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),

    sealedQualifiedScanCount: bigint('sealed_qualified_scan_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    sealedPrivateRatingCount: bigint('sealed_private_rating_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    sealedPrivateRatingSum: bigint('sealed_private_rating_sum', { mode: 'number' })
      .notNull()
      .default(0),
    sealedPrivateRating1Count: bigint('sealed_private_rating_1_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    sealedPrivateRating2Count: bigint('sealed_private_rating_2_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    sealedPrivateRating3Count: bigint('sealed_private_rating_3_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    sealedPrivateRating4Count: bigint('sealed_private_rating_4_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    sealedPrivateRating5Count: bigint('sealed_private_rating_5_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    sealedPrivateFeedbackCount: bigint('sealed_private_feedback_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    sealedGoogleReviewSelectionCount: bigint('sealed_google_review_selection_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    sealedSecondaryLinkSelectionCount: bigint('sealed_secondary_link_selection_count', {
      mode: 'number',
    })
      .notNull()
      .default(0),

    // A Property-local calendar boundary, not a Guest activity timestamp.
    sealedThroughLocalDate: varchar('sealed_through_local_date', { length: 10 }),
    projectionRevision: bigint('projection_revision', { mode: 'number' })
      .notNull()
      .default(0),
    lastRebuiltAt: timestamp('last_rebuilt_at', { withTimezone: true }),
    lastSealedAt: timestamp('last_sealed_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('portal_metric_lifetime_scope_unique').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
    ),
    index('portal_metric_lifetime_property_idx').on(t.organizationId, t.propertyId),
    foreignKey({
      name: 'portal_metric_lifetime_portal_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('cascade'),
    check(
      'portal_metric_lifetime_nonnegative_check',
      sql`${t.qualifiedScanCount} >= 0 AND ${t.privateRatingCount} >= 0 AND ${t.privateRatingSum} >= 0 AND ${t.privateRating1Count} >= 0 AND ${t.privateRating2Count} >= 0 AND ${t.privateRating3Count} >= 0 AND ${t.privateRating4Count} >= 0 AND ${t.privateRating5Count} >= 0 AND ${t.privateFeedbackCount} >= 0 AND ${t.googleReviewSelectionCount} >= 0 AND ${t.secondaryLinkSelectionCount} >= 0`,
    ),
    check(
      'portal_metric_lifetime_rating_check',
      sql`${t.privateRating1Count} + ${t.privateRating2Count} + ${t.privateRating3Count} + ${t.privateRating4Count} + ${t.privateRating5Count} = ${t.privateRatingCount} AND ${t.privateRatingSum} BETWEEN ${t.privateRatingCount} AND ${t.privateRatingCount} * 5`,
    ),
    check(
      'portal_metric_lifetime_sealed_nonnegative_check',
      sql`${t.sealedQualifiedScanCount} >= 0 AND ${t.sealedPrivateRatingCount} >= 0 AND ${t.sealedPrivateRatingSum} >= 0 AND ${t.sealedPrivateRating1Count} >= 0 AND ${t.sealedPrivateRating2Count} >= 0 AND ${t.sealedPrivateRating3Count} >= 0 AND ${t.sealedPrivateRating4Count} >= 0 AND ${t.sealedPrivateRating5Count} >= 0 AND ${t.sealedPrivateFeedbackCount} >= 0 AND ${t.sealedGoogleReviewSelectionCount} >= 0 AND ${t.sealedSecondaryLinkSelectionCount} >= 0`,
    ),
    check(
      'portal_metric_lifetime_sealed_rating_check',
      sql`${t.sealedPrivateRating1Count} + ${t.sealedPrivateRating2Count} + ${t.sealedPrivateRating3Count} + ${t.sealedPrivateRating4Count} + ${t.sealedPrivateRating5Count} = ${t.sealedPrivateRatingCount} AND ${t.sealedPrivateRatingSum} BETWEEN ${t.sealedPrivateRatingCount} AND ${t.sealedPrivateRatingCount} * 5`,
    ),
    check(
      'portal_metric_lifetime_sealed_boundary_check',
      sql`${t.sealedThroughLocalDate} IS NULL OR ${t.sealedThroughLocalDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
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
    attributedStaffParticipantId: uuid('attributed_staff_participant_id'),
    attributedStaffParticipationId: uuid('attributed_staff_participation_id'),
    attributionResponsibilityId: uuid('attribution_responsibility_id'),
    staffAttributionEffectiveFrom: timestamp('staff_attribution_effective_from', {
      withTimezone: true,
    }),
    staffAttributionEffectiveTo: timestamp('staff_attribution_effective_to', {
      withTimezone: true,
    }),
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
    check(
      'metric_corrections_staff_attribution_complete',
      sql`(${t.attributedStaffParticipantId} IS NULL AND ${t.attributedStaffParticipationId} IS NULL AND ${t.attributionResponsibilityId} IS NULL AND ${t.staffAttributionEffectiveFrom} IS NULL AND ${t.staffAttributionEffectiveTo} IS NULL) OR (${t.attributedStaffParticipantId} IS NOT NULL AND ${t.attributedStaffParticipationId} IS NOT NULL AND ${t.attributionResponsibilityId} IS NOT NULL AND ${t.staffAttributionEffectiveFrom} IS NOT NULL AND (${t.staffAttributionEffectiveTo} IS NULL OR ${t.staffAttributionEffectiveTo} > ${t.staffAttributionEffectiveFrom}))`,
    ),
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
    definitionVersionId: uuid('definition_version_id'),
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

/** One current, source-version-fenced Google reputation snapshot per Property.
 * This is a state projection of Review's verified provider fact, never a
 * bounded-period metric reading. */
export const metricCurrentGoogleReputationSnapshots = pgTable(
  'metric_current_google_reputation_snapshots',
  {
    propertyId: uuid('property_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    sourceRunId: uuid('source_run_id').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    reviewCount: integer('review_count').notNull(),
    averageRating: doublePrecision('average_rating'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('metric_current_google_reputation_source_run_unique').on(t.sourceRunId),
    uniqueIndex('metric_current_google_reputation_source_event_unique').on(
      t.sourceEventId,
    ),
    index('metric_current_google_reputation_scope_idx').on(
      t.organizationId,
      t.propertyId,
    ),
    foreignKey({
      name: 'metric_current_google_reputation_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
    check(
      'metric_current_google_reputation_source_epoch_valid',
      sql`${t.sourceEpoch} BETWEEN 0 AND 2147483647`,
    ),
    check(
      'metric_current_google_reputation_value_valid',
      sql`(${t.reviewCount} = 0 AND ${t.averageRating} IS NULL)
        OR (${t.reviewCount} BETWEEN 1 AND 10000
          AND ${t.averageRating} BETWEEN 0 AND 5)`,
    ),
  ],
)
