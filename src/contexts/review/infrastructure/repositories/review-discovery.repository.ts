// Review context — Drizzle new-review discovery repository.
//
// Candidate predicate (mirrored by the in-memory fake in
// shared/testing/fake-review-discovery-repository.ts):
//   - property not soft-deleted and lifecycle-active;
//   - google_binding_state = 'active' — the migration-0031 CHECK constraint
//     guarantees google_connection_id / gbp_account_id / gbp_location_id are
//     all present in exactly that state, so no extra null predicates are
//     needed for correctness (they remain for the type narrowing below);
//   - the Google connection is active with usable credential material;
//   - the property's discovery poll is due (never polled, or next_incremental_at
//     elapsed).
//
// Per-property due times live in review_sync_state (migration 0007) — the
// table's `next_incremental_at` column and its
// `review_sync_state_due_incremental_idx` partial index exist for exactly
// this scheduling role, and the health snapshot already reports
// `sync.dueForIncrementalCount` from it.

import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { reviewSyncState } from '#/shared/db/schema/review-sync.schema'
import type {
  ReviewDiscoveryCandidate,
  ReviewDiscoveryRepository,
} from '../../application/ports/review-discovery.repository'
import { trace } from '#/shared/observability/trace'

/** review_sync_state is keyed (property_id, source); Google is the only source. */
const DISCOVERY_SOURCE = 'google'

type CandidateRow = Readonly<{
  propertyId: string
  organizationId: string
  connectionId: string | null
  accountId: string | null
  locationId: string | null
}>

/**
 * Drop rows whose Google binding is incomplete instead of asserting a shape
 * the column types do not carry. The binding CHECK constraint makes this
 * unreachable in practice; a row that got here anyway has no usable
 * `locations/...` resource name and must not be enqueued.
 */
const toCandidate = (row: CandidateRow): ReviewDiscoveryCandidate[] =>
  row.connectionId === null || row.accountId === null || row.locationId === null
    ? []
    : [
        {
          propertyId: row.propertyId,
          organizationId: row.organizationId,
          connectionId: row.connectionId,
          locationName: `accounts/${row.accountId}/locations/${row.locationId}`,
        },
      ]

export const createReviewDiscoveryRepository = (
  db: Database,
): ReviewDiscoveryRepository => ({
  findDuePropertiesBatch: async (due, cursor, limit) =>
    trace('review.discovery.findDuePropertiesBatch', async () => {
      const rows = await db
        .select({
          propertyId: properties.id,
          organizationId: properties.organizationId,
          connectionId: properties.googleConnectionId,
          accountId: properties.gbpAccountId,
          locationId: properties.gbpLocationId,
        })
        .from(properties)
        .innerJoin(
          googleConnections,
          eq(googleConnections.id, properties.googleConnectionId),
        )
        .leftJoin(
          reviewSyncState,
          and(
            eq(reviewSyncState.propertyId, sql`${properties.id}::text`),
            eq(reviewSyncState.source, DISCOVERY_SOURCE),
          ),
        )
        .where(
          and(
            isNull(properties.deletedAt),
            eq(properties.lifecycleState, 'active'),
            eq(properties.googleBindingState, 'active'),
            eq(googleConnections.status, 'active'),
            eq(googleConnections.credentialUseState, 'active'),
            or(
              isNull(reviewSyncState.nextIncrementalAt),
              lte(reviewSyncState.nextIncrementalAt, due),
            ),
            ...(cursor === null ? [] : [gt(properties.id, cursor)]),
          ),
        )
        .orderBy(asc(properties.id))
        .limit(limit)

      return rows.flatMap(toCandidate)
    }),

  markDiscoveryScheduled: async (propertyId, now, nextDueAt) =>
    trace('review.discovery.markScheduled', async () => {
      await db
        .insert(reviewSyncState)
        .values({
          propertyId,
          source: DISCOVERY_SOURCE,
          nextIncrementalAt: nextDueAt,
          lastSuccessAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [reviewSyncState.propertyId, reviewSyncState.source],
          set: {
            nextIncrementalAt: nextDueAt,
            lastSuccessAt: now,
            errorClass: null,
            errorRetryAt: null,
            updatedAt: now,
          },
        })
    }),

  markDiscoveryDeferred: async (propertyId, now, nextDueAt, errorClass) =>
    trace('review.discovery.markDeferred', async () => {
      await db
        .insert(reviewSyncState)
        .values({
          propertyId,
          source: DISCOVERY_SOURCE,
          nextIncrementalAt: nextDueAt,
          errorClass,
          errorRetryAt: nextDueAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [reviewSyncState.propertyId, reviewSyncState.source],
          set: {
            nextIncrementalAt: nextDueAt,
            errorClass,
            errorRetryAt: nextDueAt,
            updatedAt: now,
          },
        })
    }),
})
