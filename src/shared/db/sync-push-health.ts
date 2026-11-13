import { reviewSourceContents } from './schema/review-source-content.schema'
// Push health and reconciliation age (ADR 0055), computed on read.
// Lives in shared/db beside the other operational reads that name Drizzle tables.
//
// Polling reconciles a Property within the configured window and
// Google's push is the fast path for a new Review. Nothing else noticed a push
// outage: it looked like a quiet week. This read answers two questions from
// tables that already exist:
//
//   - Did Google's push reach us for the Reviews we found? The first-sighting
//     ledger (`review_first_sightings`, written by the Review writer) says how
//     and when each live Review was first seen and when its push was accepted;
//     the pure rules in push-health.ts judge each one. Receipts count the
//     pushes Pub/Sub accepted.
//   - Is every Property still being reconciled? The newest completed snapshot
//     fact of its current source epoch, against the Property's own window plus
//     two hours. Above a day the configured window holds only while a head
//     check covers the Property's newest page; without that cover it is a day,
//     as the discovery sweep applies it.
//   - Is every Property's newest page covered? Only when the window is wider
//     than a day: Properties no persisting head check covered for a day.
//   - Does Google still count fewer reviews than a Property shows, 72 hours
//     after a head check first saw it? Read with the reconciliation age, from
//     the same discovery state row.
//
// It is its own health signal (`syncPush`), so a slow query here degrades only
// this section and cannot blind the `sync` signals the sweep alerts hold on.
// Identifier-free (ADR 0030): counts and one age, never a location, account or
// Review. Only Properties the discovery sweep still polls are judged
// (propertyIsSyncable), so a retired Property cannot hold an alert on for good.

import { and, desc, eq, gt, notInArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { reviews } from '#/shared/db/schema/review.schema'
import { reviewGoogleReputationSnapshotFacts } from '#/shared/db/schema/review-reputation.schema'
import {
  reviewFirstSightings,
  reviewSyncState,
} from '#/shared/db/schema/review-sync.schema'
import { propertyIsSyncable, propertySyncableSince } from '#/shared/db/syncable-property'
import {
  COUNT_DROP_CHECKED_FRESH_MS,
  COUNT_DROP_PERSISTENT_AFTER_MS,
  DISCOVERY_LOOK_MAX_GAP_MS,
  HEAD_COVERAGE_ALERT_AFTER_MS,
  HEAD_COVERAGE_FRESH_MS,
  PUSH_ALERT_WINDOW_MS,
  PUSH_COVERED_VIA,
  PUSH_HEALTH_WINDOW_MS,
  RECONCILIATION_OVERDUE_AFTER_MS,
  RECONCILIATION_OVERDUE_SLACK_MS,
  reconciliationOverdueAfterMs,
  summarizeLedger,
  UNCOVERED_RECONCILE_WITHIN_MS,
  type LedgerSighting,
} from '#/shared/domain/push-health'

export type SyncPushHealth = Readonly<{
  push: Readonly<{
    /** Reviews first seen in the last day by a push, or by the snapshot a push handed off to. */
    newByPush24h: number
    /**
     * Reviews first seen in the last day by polling or an on-demand read, less
     * the ones Google published late: those are not new arrivals.
     */
    newByPoll24h: number
    /** Polled Reviews under the missed window with no push yet. */
    pending: number
    /** Polled Reviews first seen in the last day with no push accepted within the window. */
    missed24h: number
    /** Polled Reviews first seen in the last day whose push arrived after polling saw them. */
    late24h: number
    /** Pushes Pub/Sub accepted for a known Property in the last day. */
    acceptedPushes24h: number
    /** Locations with a live first sighting this week and no missed push. */
    locationsHealthy: number
    /** Locations that missed a push this week. */
    locationsSuspect: number
    /** Google accounts that missed two or more pushes this week across their locations. */
    accountsDark: number
  }>
  reconciliation: Readonly<{
    /**
     * Configured reconciliation window plus slack: the limit of a Property a
     * head check covers. Above a day an uncovered Property's limit is a day
     * plus slack.
     */
    overdueAfterMs: number
    /** Syncable Properties whose newest completed reconciliation is over their limit. */
    overdueCount: number
    /** Age of the oldest overdue one; null when none is overdue. */
    oldestAgeMs: number | null
  }>
  headCoverage: Readonly<{
    /** The window is wider than a day, so skipping depends on head cover. */
    active: boolean
    /** Syncable Properties no persisting head check covered in the last day. */
    uncoveredCount: number
    /** How long the longest-uncovered one has gone; null when none is. */
    oldestUncoveredAgeMs: number | null
  }>
  countDrop: Readonly<{
    /**
     * Syncable Properties whose head checks first saw Google's total below the
     * stored live count 72 hours ago or more, and one of which still saw it in
     * the last seven hours.
     */
    persistentCount: number
    /** How long the oldest such drop has lasted; null when none has. */
    oldestAgeMs: number | null
  }>
}>

/**
 * Most polled first sightings one read judges. Push covers nearly every Review
 * in a healthy week, so this bounds only a week with push dark; past it the
 * misses are a lower bound, which is enough to alert on.
 */
const LEDGER_ROW_CAP = 5000

const EMPTY_PUSH: SyncPushHealth['push'] = {
  newByPush24h: 0,
  newByPoll24h: 0,
  pending: 0,
  missed24h: 0,
  late24h: 0,
  acceptedPushes24h: 0,
  locationsHealthy: 0,
  locationsSuspect: 0,
  accountsDark: 0,
}

const INACTIVE_HEAD_COVERAGE: SyncPushHealth['headCoverage'] = {
  active: false,
  uncoveredCount: 0,
  oldestUncoveredAgeMs: null,
}

export const ZERO_SYNC_PUSH_HEALTH: SyncPushHealth = {
  push: EMPTY_PUSH,
  reconciliation: {
    overdueAfterMs: RECONCILIATION_OVERDUE_AFTER_MS,
    overdueCount: 0,
    oldestAgeMs: null,
  },
  headCoverage: INACTIVE_HEAD_COVERAGE,
  countDrop: { persistentCount: 0, oldestAgeMs: null },
}

/** Each Property's discovery state row: it carries the head cover and the count drop. */
const syncStateOfProperty = and(
  eq(reviewSyncState.propertyId, sql`${properties.id}::text`),
  eq(reviewSyncState.source, 'google'),
)

const secondsAgo = (ms: number) => sql`NOW() - (${ms / 1000} * INTERVAL '1 second')`

const pushCovered = sql`${reviewFirstSightings.firstSeenVia} IN (${sql.join(
  PUSH_COVERED_VIA.map((via) => sql`${via}`),
  sql`, `,
)})`

async function readLedgerCounts(db: Database) {
  const [row] = await db
    .select({
      byPush: sql<number>`count(*) FILTER (
        WHERE ${reviewFirstSightings.firstSeenAt} > ${secondsAgo(PUSH_ALERT_WINDOW_MS)}
          AND ${pushCovered}
      )::int`,
      byPoll: sql<number>`count(*) FILTER (
        WHERE ${reviewFirstSightings.firstSeenAt} > ${secondsAgo(PUSH_ALERT_WINDOW_MS)}
          AND NOT (${pushCovered})
      )::int`,
      locations: sql<number>`count(DISTINCT ${reviewFirstSightings.propertyId})::int`,
      nowMs: sql<number>`(EXTRACT(EPOCH FROM NOW()) * 1000)::float8`,
    })
    .from(reviewFirstSightings)
    .innerJoin(
      properties,
      and(
        eq(properties.organizationId, reviewFirstSightings.organizationId),
        eq(properties.id, reviewFirstSightings.propertyId),
      ),
    )
    .innerJoin(googleConnections, eq(googleConnections.id, properties.googleConnectionId))
    .where(
      and(
        propertyIsSyncable,
        gt(reviewFirstSightings.firstSeenAt, secondsAgo(PUSH_HEALTH_WINDOW_MS)),
      ),
    )
  return {
    byPush: row?.byPush ?? 0,
    byPoll: row?.byPoll ?? 0,
    locations: row?.locations ?? 0,
    now: new Date(Number(row?.nowMs ?? Date.now())),
  }
}

async function readPolledSightings(db: Database): Promise<LedgerSighting[]> {
  const facts = reviewGoogleReputationSnapshotFacts
  // The discovering run completes after the sighting; only an earlier listing
  // can prove Google had not published this Review when it was written.
  const previousListingAt = sql<string | null>`(
    SELECT ${facts.evaluatedAt} FROM ${facts}
    WHERE ${facts.organizationId} = ${reviewFirstSightings.organizationId}
      AND ${facts.propertyId} = ${reviewFirstSightings.propertyId}
      AND ${facts.sourceEpoch} = ${reviewFirstSightings.sourceEpoch}
      AND ${facts.listingComplete}
      AND ${facts.evaluatedAt} < ${reviewFirstSightings.firstSeenAt}
    ORDER BY ${facts.evaluatedAt} DESC
    LIMIT 1
  )`
  const rows = await db
    .select({
      organizationId: reviewFirstSightings.organizationId,
      propertyId: reviewFirstSightings.propertyId,
      connectionId: properties.googleConnectionId,
      accountId: properties.gbpAccountId,
      firstSeenVia: reviewFirstSightings.firstSeenVia,
      firstSeenAt: reviewFirstSightings.firstSeenAt,
      pushAcceptedAt: reviewFirstSightings.pushAcceptedAt,
      sourceCreatedAt: reviewSourceContents.sourceCreatedAt,
      previousListingAt,
    })
    .from(reviewFirstSightings)
    .innerJoin(
      properties,
      and(
        eq(properties.organizationId, reviewFirstSightings.organizationId),
        eq(properties.id, reviewFirstSightings.propertyId),
      ),
    )
    .innerJoin(googleConnections, eq(googleConnections.id, properties.googleConnectionId))
    // Left: a Review can be gone while its ledger row stays, and that row is still judged.
    .leftJoin(
      reviews,
      and(
        eq(reviews.organizationId, reviewFirstSightings.organizationId),
        eq(reviews.id, reviewFirstSightings.reviewId),
      ),
    )

    .leftJoin(
      reviewSourceContents,
      and(
        eq(reviewSourceContents.reviewId, reviews.id),
        eq(reviewSourceContents.organizationId, reviews.organizationId),
        eq(reviewSourceContents.propertyId, reviews.propertyId),
      ),
    )
    .where(
      and(
        propertyIsSyncable,
        gt(reviewFirstSightings.firstSeenAt, secondsAgo(PUSH_HEALTH_WINDOW_MS)),
        notInArray(reviewFirstSightings.firstSeenVia, [...PUSH_COVERED_VIA]),
      ),
    )
    .orderBy(desc(reviewFirstSightings.firstSeenAt))
    .limit(LEDGER_ROW_CAP)
  return rows.map((row) => ({
    firstSeenVia: row.firstSeenVia as LedgerSighting['firstSeenVia'],
    firstSeenAt: row.firstSeenAt,
    pushAcceptedAt: row.pushAcceptedAt,
    sourceCreatedAt: row.sourceCreatedAt,
    previousListingAt:
      row.previousListingAt === null ? null : new Date(row.previousListingAt),
    locationKey: `${row.organizationId}/${row.propertyId}`,
    accountKey: `${row.organizationId}/${row.connectionId}/${row.accountId}`,
  }))
}

async function readAcceptedPushes(db: Database): Promise<number> {
  const [row] = await db
    .select({ accepted: sql<number>`count(*)::int` })
    .from(idempotencyReceipts)
    .where(
      and(
        eq(idempotencyReceipts.scope, 'gbp_webhook'),
        gt(idempotencyReceipts.recordedAt, secondsAgo(PUSH_ALERT_WINDOW_MS)),
        sql`${idempotencyReceipts.payload}->>'outcome' IN ('accepted_targeted', 'accepted_reconciliation')`,
      ),
    )
  return row?.accepted ?? 0
}

async function readPushHealth(db: Database): Promise<SyncPushHealth['push']> {
  const counts = await readLedgerCounts(db)
  const summary = summarizeLedger(await readPolledSightings(db), counts.now)
  return {
    newByPush24h: counts.byPush,
    newByPoll24h: Math.max(0, counts.byPoll - summary.latePublished24h),
    pending: summary.pending,
    missed24h: summary.missed24h,
    late24h: summary.late24h,
    acceptedPushes24h: await readAcceptedPushes(db),
    locationsHealthy: Math.max(0, counts.locations - summary.locationsSuspect),
    locationsSuspect: summary.locationsSuspect,
    accountsDark: summary.accountsDark,
  }
}

/**
 * How long each syncable Property has gone without a completed reconciliation:
 * the newest snapshot fact of its CURRENT source epoch that proves a completed
 * listing (a relink bumps the epoch, so an older epoch's fact never counts; a
 * head fact, Google's numbers from one read of its newest page, is no
 * reconciliation), or the day it qualified when
 * it has none, whichever is later (a restored Property is late from the day it
 * was restored, not from the fact it kept). Failed Properties still count;
 * propertyIsSyncable excludes connections awaiting reauthorization, including
 * provider revocation, which has its own signal.
 *
 * Each Property is judged against its own window, as the discovery sweep
 * applies it. Up to a day that is the configured window. Above a day it is the
 * configured window only while a head check covers the Property; otherwise a
 * day after the listing, or, when the cover lapsed later than that, the lapse
 * plus the longest gap between two looks (the look that notices the lapse is
 * the one that lists in full).
 *
 * The same pass counts the Properties whose drop in Google's total has lasted
 * 72 hours (`count_drop_seen_at`) and that a head check still saw recently
 * (`count_drop_checked_at`): head checks stop asking for full reads then. An
 * old sighting nothing has confirmed since raises nothing.
 */
async function readReconciliationAge(
  db: Database,
  reconcileWithinHours: number,
): Promise<Pick<SyncPushHealth, 'reconciliation' | 'countDrop'>> {
  const facts = reviewGoogleReputationSnapshotFacts
  const newestFact = sql`(
    SELECT ${facts.evaluatedAt} FROM ${facts}
    WHERE ${facts.organizationId} = ${properties.organizationId}
      AND ${facts.propertyId} = ${properties.id}
      AND ${facts.sourceEpoch} = ${properties.sourceEpoch}
      AND ${facts.listingComplete}
    ORDER BY ${facts.evaluatedAt} DESC
    LIMIT 1
  )`
  const reconciledAt = sql`GREATEST(${newestFact}, ${propertySyncableSince})`
  const ageMs = sql`EXTRACT(EPOCH FROM (NOW() - ${reconciledAt})) * 1000`
  const coveredLimitMs = reconciliationOverdueAfterMs(reconcileWithinHours)
  const uncoveredLimitMs = UNCOVERED_RECONCILE_WITHIN_MS + RECONCILIATION_OVERDUE_SLACK_MS
  const coverLapseNoticedMs =
    HEAD_COVERAGE_FRESH_MS + DISCOVERY_LOOK_MAX_GAP_MS + RECONCILIATION_OVERDUE_SLACK_MS
  // Up to a day every Property has the configured limit, exactly as before.
  const limitMs =
    coveredLimitMs <= uncoveredLimitMs
      ? sql`${coveredLimitMs}`
      : sql`LEAST(${coveredLimitMs}::float8, GREATEST(
          ${uncoveredLimitMs}::float8,
          EXTRACT(EPOCH FROM (${reviewSyncState.headCoveredAt} - ${reconciledAt})) * 1000
            + ${coverLapseNoticedMs}::float8
        ))`
  const overdue = sql`${ageMs} > ${limitMs}`
  const dropAgeMs = sql`EXTRACT(EPOCH FROM (NOW() - ${reviewSyncState.countDropSeenAt})) * 1000`
  const dropPersistent = sql`(
    ${dropAgeMs} >= ${COUNT_DROP_PERSISTENT_AFTER_MS}::float8
    AND EXTRACT(EPOCH FROM (NOW() - ${reviewSyncState.countDropCheckedAt})) * 1000
      <= ${COUNT_DROP_CHECKED_FRESH_MS}::float8
  )`
  const [row] = await db
    .select({
      overdue: sql<number>`count(*) FILTER (WHERE ${overdue})::int`,
      oldestAgeMs: sql<number | null>`max(${ageMs}) FILTER (WHERE ${overdue})`,
      countDrops: sql<number>`count(*) FILTER (WHERE ${dropPersistent})::int`,
      oldestDropAgeMs: sql<
        number | null
      >`max(${dropAgeMs}) FILTER (WHERE ${dropPersistent})`,
    })
    .from(properties)
    .innerJoin(googleConnections, eq(googleConnections.id, properties.googleConnectionId))
    .leftJoin(reviewSyncState, syncStateOfProperty)
    .where(propertyIsSyncable)
  return {
    reconciliation: {
      overdueAfterMs: coveredLimitMs,
      overdueCount: row?.overdue ?? 0,
      oldestAgeMs: row?.oldestAgeMs == null ? null : Math.round(Number(row.oldestAgeMs)),
    },
    countDrop: {
      persistentCount: row?.countDrops ?? 0,
      oldestAgeMs:
        row?.oldestDropAgeMs == null ? null : Math.round(Number(row.oldestDropAgeMs)),
    },
  }
}

/**
 * Syncable Properties that no persisting head check covered for a day, counted
 * from the later of the last cover and the day the Property qualified. Read only
 * when the window is wider than a day: at a day or less cover changes nothing.
 * Such a Property is still listed in full every day; the count says the weekly
 * rhythm is not holding for it.
 */
async function readHeadCoverage(
  db: Database,
  reconcileWithinHours: number,
): Promise<SyncPushHealth['headCoverage']> {
  if (reconcileWithinHours * 60 * 60 * 1000 <= UNCOVERED_RECONCILE_WITHIN_MS) {
    return INACTIVE_HEAD_COVERAGE
  }
  const ageMs = sql`EXTRACT(EPOCH FROM (NOW() - GREATEST(${reviewSyncState.headCoveredAt}, ${propertySyncableSince}))) * 1000`
  const uncovered = sql`${ageMs} > ${HEAD_COVERAGE_ALERT_AFTER_MS}::float8`
  const [row] = await db
    .select({
      uncovered: sql<number>`count(*) FILTER (WHERE ${uncovered})::int`,
      oldestAgeMs: sql<number | null>`max(${ageMs}) FILTER (WHERE ${uncovered})`,
    })
    .from(properties)
    .innerJoin(googleConnections, eq(googleConnections.id, properties.googleConnectionId))
    .leftJoin(reviewSyncState, syncStateOfProperty)
    .where(propertyIsSyncable)
  return {
    active: true,
    uncoveredCount: row?.uncovered ?? 0,
    oldestUncoveredAgeMs:
      row?.oldestAgeMs == null ? null : Math.round(Number(row.oldestAgeMs)),
  }
}

/**
 * The `syncPush` health signal. `gbpPushEnabled` is the readiness fact the
 * composition root supplies (GBP_PUBSUB_TOPIC): with no topic there is no push
 * to measure, so the push counts stay zero and only the reconciliation age and
 * the head cover, which do not depend on push, are read.
 */
export async function readSyncPushHealth(
  db: Database,
  gbpPushEnabled: boolean,
  reconcileWithinHours = 6,
): Promise<SyncPushHealth> {
  const push = gbpPushEnabled ? await readPushHealth(db) : EMPTY_PUSH
  const { reconciliation, countDrop } = await readReconciliationAge(
    db,
    reconcileWithinHours,
  )
  return {
    push,
    reconciliation,
    headCoverage: await readHeadCoverage(db, reconcileWithinHours),
    countDrop,
  }
}
