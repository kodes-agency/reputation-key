// Inbox context — the Response Target policy tables: the Organization's duration per
// target family and the private-feedback Property override. Neither points at
// `inbox_items`, and every cycle snapshots what it resolved in
// `inbox_handling_cycle_response_targets` (./inbox.schema.ts). Moved out of
// inbox.schema.ts unchanged, so that file stays within its length ratchet.

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'

/**
 * What every Response Target policy row records about its last write: the
 * version an editor's expected-version check is answered from, and who wrote
 * it. Both policy tables are edited through the same optimistic-concurrency
 * step, so a table that stamped itself differently could not be edited by it.
 */
const policyStampColumns = () => ({
  policyVersion: bigint('policy_version', { mode: 'number' }).notNull(),
  updatedBy: varchar('updated_by', { length: 255 }).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})

/**
 * Current Organization policy for each Inbox-owned Response Target family.
 * Earlier cycles never consult this row again: every cycle snapshots the
 * resolved duration/source/version in `inbox_handling_cycle_response_targets`.
 */
export const inboxResponseTargetOrganizationPolicies = pgTable(
  'inbox_response_target_organization_policies',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    targetKind: varchar('target_kind', { length: 48 }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    /**
     * The shorter Google Review target for the Organization's own low-rated
     * reviews: a rating at or below the threshold is measured against the
     * low-rating duration instead. Both null — the default, and every row
     * written before these columns — means one clock for every review.
     */
    lowRatingThreshold: integer('low_rating_threshold'),
    lowRatingDurationMinutes: integer('low_rating_duration_minutes'),
    ...policyStampColumns(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_response_target_organization_policies_pk',
      columns: [t.organizationId, t.targetKind],
    }),
    check(
      'inbox_response_target_organization_policies_values_valid',
      sql`${t.targetKind} IN ('google_review_response', 'private_feedback_handling')
        AND ${t.durationMinutes} BETWEEN 1 AND 43200
        AND ${t.policyVersion} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
    // All or nothing, Google reviews only, and always SHORTER than the
    // ordinary target: the point is an earlier prompt, and a longer one would
    // quietly give a one-star review more time than a five-star one.
    check(
      'inbox_response_target_organization_policies_low_rating_valid',
      sql`(${t.lowRatingThreshold} IS NULL) = (${t.lowRatingDurationMinutes} IS NULL)
        AND (
          ${t.lowRatingThreshold} IS NULL
          OR (
            ${t.targetKind} = 'google_review_response'
            AND ${t.lowRatingThreshold} BETWEEN 1 AND 5
            AND ${t.lowRatingDurationMinutes} BETWEEN 1 AND ${t.durationMinutes}
          )
        )`,
    ),
  ],
)

/**
 * Private-feedback-only Property override. There is deliberately no Portal
 * key or Portal override table: the supported resolution chain ends here.
 */
export const inboxPrivateFeedbackTargetPropertyOverrides = pgTable(
  'inbox_private_feedback_target_property_overrides',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    enabled: boolean('enabled').notNull(),
    durationMinutes: integer('duration_minutes'),
    ...policyStampColumns(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_private_feedback_target_property_overrides_pk',
      columns: [t.organizationId, t.propertyId],
    }),
    foreignKey({
      name: 'inbox_private_feedback_target_property_overrides_property_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
    check(
      'inbox_private_feedback_target_property_overrides_values_valid',
      sql`((${t.enabled} AND ${t.durationMinutes} BETWEEN 1 AND 43200)
          OR (NOT ${t.enabled} AND ${t.durationMinutes} IS NULL))
        AND ${t.policyVersion} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
  ],
)
