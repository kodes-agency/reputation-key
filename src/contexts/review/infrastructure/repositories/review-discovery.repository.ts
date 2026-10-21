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
//     elapsed);
//   - the property has NO in-flight GBP import (an import already enqueues a
//     sync when it completes, so a sweep poll during one is wasted provider
//     quota AND races the import's own snapshot for the same source epoch).
//
// Per-property due times live in review_sync_state (migration 0007) — the
// table's `next_incremental_at` column and its
// `review_sync_state_due_incremental_idx` partial index exist for exactly
// this scheduling role, and the health snapshot already reports
// `sync.dueForIncrementalCount` from it.
//
// It also carries each property's last COMPLETED reconciliation: the latest
// review_google_reputation_snapshot_facts.evaluated_at of the property's CURRENT
// source epoch among the facts that prove a completed listing (`listing_complete`;
// a head fact does not) (one probe of the scope index per candidate), and whether a coded
// failure is still recorded. The sweep skips a look whose reconciliation is
// recent (domain/discovery-reconciliation.ts).
//
// The batch also carries each property's ACTIVITY evidence (migration 0071's
// `last_new_review_at`, the existing `last_notification_at`, and the
// property's own `created_at` floor) so the sweep can price each property's
// next poll on the backoff ladder without a second round-trip.

import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { propertyIsSyncable } from '#/shared/db/syncable-property'
import { reviewSyncState } from '#/shared/db/schema/review-sync.schema'
import { reviewGoogleReputationSnapshotFacts } from '#/shared/db/schema/review-reputation.schema'
import {
  gbpImportRequestItems,
  gbpImportRequests,
} from '#/shared/db/schema/google-import-v2.schema'
import type {
  ReviewDiscoveryCandidate,
  ReviewDiscoveryRepository,
} from '../../application/ports/review-discovery.repository'
import { trace } from '#/shared/observability/trace'

/** review_sync_state is keyed (property_id, source); Google is the only source. */
const DISCOVERY_SOURCE = 'google'

/** Import parent/item statuses that mean "this import has not settled yet". */
const IN_FLIGHT_PARENT_STATUSES = ['queued', 'processing'] as const
const IN_FLIGHT_ITEM_STATUSES = ['pending', 'processing'] as const

const NOTHING_PULLED = { pulledForward: 0, skippedRecent: 0, skippedBackoff: 0 } as const

type CandidateRow = Readonly<{
  propertyId: string
  organizationId: string
  connectionId: string | null
  accountId: string | null
  locationId: string | null
  observedSince: Date | null
  lastNewReviewAt: Date | null
  lastNotificationAt: Date | null
  lastReconciledAt: Date | null
  errorClass: string | null
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
          activity: {
            lastNewReviewAt: row.lastNewReviewAt,
            lastNotificationAt: row.lastNotificationAt,
            observedSince: row.observedSince,
          },
          lastReconciledAt: row.lastReconciledAt,
          hasOutstandingFailure: row.errorClass !== null,
        },
      ]

export const createReviewDiscoveryRepository = (
  db: Database,
): ReviewDiscoveryRepository => ({
  findDuePropertiesBatch: async (due, cursor, limit) =>
    trace('review.discovery.findDuePropertiesBatch', async () => {
      // Unsettled GBP import for this property. BOTH the parent request and
      // the item must still be in flight: a cancelled or failed parent can
      // leave items behind, and stale rows must never park a property
      // forever. `destination_property_id` covers a create whose property row
      // already exists; `existing_property_id` covers a relink. A create
      // whose destination row is not written yet has no property to poll.
      const inFlightImport = db
        .select({ one: sql`1` })
        .from(gbpImportRequestItems)
        .innerJoin(
          gbpImportRequests,
          and(
            eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
            eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
          ),
        )
        .where(
          and(
            inArray(gbpImportRequests.status, IN_FLIGHT_PARENT_STATUSES),
            inArray(gbpImportRequestItems.status, IN_FLIGHT_ITEM_STATUSES),
            or(
              eq(gbpImportRequestItems.destinationPropertyId, properties.id),
              eq(gbpImportRequestItems.existingPropertyId, properties.id),
            ),
          ),
        )

      // The newest completed reconciliation of the property's CURRENT epoch. A
      // relink bumps the epoch, so the old epoch's facts never count. Only a fact
      // that proves a completed listing counts.
      const lastReconciled = db
        .select({ evaluatedAt: reviewGoogleReputationSnapshotFacts.evaluatedAt })
        .from(reviewGoogleReputationSnapshotFacts)
        .where(
          and(
            eq(
              reviewGoogleReputationSnapshotFacts.organizationId,
              properties.organizationId,
            ),
            eq(reviewGoogleReputationSnapshotFacts.propertyId, properties.id),
            eq(reviewGoogleReputationSnapshotFacts.sourceEpoch, properties.sourceEpoch),
            // A head fact (Google's numbers from one read of its newest page)
            // proves no listing, so it is no completed reconciliation.
            eq(reviewGoogleReputationSnapshotFacts.listingComplete, true),
          ),
        )
        .orderBy(desc(reviewGoogleReputationSnapshotFacts.evaluatedAt))
        .limit(1)
        .as('last_reconciled')

      const rows = await db
        .select({
          propertyId: properties.id,
          organizationId: properties.organizationId,
          connectionId: properties.googleConnectionId,
          accountId: properties.gbpAccountId,
          locationId: properties.gbpLocationId,
          observedSince: properties.createdAt,
          lastNewReviewAt: reviewSyncState.lastNewReviewAt,
          lastNotificationAt: reviewSyncState.lastNotificationAt,
          lastReconciledAt: lastReconciled.evaluatedAt,
          errorClass: reviewSyncState.errorClass,
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
        .leftJoinLateral(lastReconciled, sql`true`)
        .where(
          and(
            propertyIsSyncable,
            or(
              isNull(reviewSyncState.nextIncrementalAt),
              lte(reviewSyncState.nextIncrementalAt, due),
            ),
            notExists(inFlightImport),
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
            updatedAt: now,
          },
        })
    }),

  markDiscoverySkipped: async (propertyId, now, nextDueAt) =>
    trace('review.discovery.markSkipped', async () => {
      // Only the due time: nothing was synced, so `last_success_at` and the
      // failure columns stay exactly as they were.
      await db
        .insert(reviewSyncState)
        .values({
          propertyId,
          source: DISCOVERY_SOURCE,
          nextIncrementalAt: nextDueAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [reviewSyncState.propertyId, reviewSyncState.source],
          set: { nextIncrementalAt: nextDueAt, updatedAt: now },
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
          lastTerminalErrorAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [reviewSyncState.propertyId, reviewSyncState.source],
          // The retry date and the next look are one value: the sweep selects
          // on `next_incremental_at`, so it can never reach a failure before
          // its backoff. `last_terminal_error_at` dates the failure, so the
          // next one can tell how long this one waited.
          set: {
            nextIncrementalAt: nextDueAt,
            errorClass,
            errorRetryAt: nextDueAt,
            lastTerminalErrorAt: now,
            updatedAt: now,
          },
        })
    }),

  findFailureState: async (propertyId) =>
    trace('review.discovery.findFailureState', async () => {
      const [row] = await db
        .select({
          errorClass: reviewSyncState.errorClass,
          failedAt: reviewSyncState.lastTerminalErrorAt,
          retryAt: reviewSyncState.errorRetryAt,
        })
        .from(reviewSyncState)
        .where(
          and(
            eq(reviewSyncState.propertyId, propertyId),
            eq(reviewSyncState.source, DISCOVERY_SOURCE),
          ),
        )
      return row ?? null
    }),

  pullLooksForward: async (propertyIds, now, reconciledSince) =>
    trace('review.discovery.pullLooksForward', async () => {
      if (propertyIds.length === 0) return NOTHING_PULLED
      // A Property with a completed reconciliation of its CURRENT epoch since
      // `reconciledSince` is left alone (the skipped count); the rest may move.
      // Only a fact that proves a completed listing counts: a head fact is
      // Google's numbers from one read of its newest page, not a listing of
      // every review.
      const recentFact = db
        .select({ one: sql`1` })
        .from(reviewGoogleReputationSnapshotFacts)
        .where(
          and(
            eq(
              reviewGoogleReputationSnapshotFacts.organizationId,
              properties.organizationId,
            ),
            eq(reviewGoogleReputationSnapshotFacts.propertyId, properties.id),
            eq(reviewGoogleReputationSnapshotFacts.sourceEpoch, properties.sourceEpoch),
            eq(reviewGoogleReputationSnapshotFacts.listingComplete, true),
            gte(reviewGoogleReputationSnapshotFacts.evaluatedAt, reconciledSince),
          ),
        )
      const requested = [...new Set(propertyIds)]
      const recent = await db
        .select({ propertyId: properties.id })
        .from(properties)
        .where(and(inArray(properties.id, requested), exists(recentFact)))
      const recentIds = new Set(recent.map((row) => row.propertyId))
      const stale = requested.filter((id) => !recentIds.has(id))

      if (stale.length === 0) {
        return { pulledForward: 0, skippedRecent: recentIds.size, skippedBackoff: 0 }
      }

      // One statement decides and writes: a failure keeps its backoff, so the
      // update skips a Property whose `error_retry_at` is still ahead. Reading
      // that first and updating after would let a deferral that commits in
      // between be pulled forward anyway. A look already due, or a Property with
      // no row (never polled), needs no move. Only the due time (and
      // `updated_at`) change: nothing was synced, so the success stamp and any
      // failure state stay as they were.
      const moved = await db
        .update(reviewSyncState)
        .set({ nextIncrementalAt: now, updatedAt: now })
        .where(
          and(
            inArray(reviewSyncState.propertyId, stale),
            eq(reviewSyncState.source, DISCOVERY_SOURCE),
            gt(reviewSyncState.nextIncrementalAt, now),
            or(
              isNull(reviewSyncState.errorRetryAt),
              lte(reviewSyncState.errorRetryAt, now),
            ),
          ),
        )
        .returning({ propertyId: reviewSyncState.propertyId })
      const movedIds = new Set(moved.map((row) => row.propertyId))

      // Of the rest, those still inside a failure backoff (counts only).
      const unmoved = stale.filter((id) => !movedIds.has(id))
      const backedOff =
        unmoved.length === 0
          ? []
          : await db
              .select({ propertyId: reviewSyncState.propertyId })
              .from(reviewSyncState)
              .where(
                and(
                  inArray(reviewSyncState.propertyId, unmoved),
                  eq(reviewSyncState.source, DISCOVERY_SOURCE),
                  gt(reviewSyncState.errorRetryAt, now),
                ),
              )
      return {
        pulledForward: movedIds.size,
        skippedRecent: recentIds.size,
        skippedBackoff: backedOff.length,
      }
    }),

  markSyncSucceeded: async (propertyId) =>
    trace('review.discovery.markSyncSucceeded', async () => {
      await db
        .update(reviewSyncState)
        .set({
          errorClass: null,
          errorRetryAt: null,
          updatedAt: sql`transaction_timestamp()`,
        })
        .where(
          and(
            eq(reviewSyncState.propertyId, propertyId),
            eq(reviewSyncState.source, DISCOVERY_SOURCE),
          ),
        )
    }),
})
