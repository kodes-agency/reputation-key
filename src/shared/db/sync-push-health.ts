// Push health and reconciliation age (ADR 0055), computed on read.
// Lives in shared/db beside the other operational reads that name Drizzle tables.
//
// Since the skip rule, polling reconciles a Property about every six hours and
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
//     fact of its current source epoch, against the six-hour guarantee.
//
// It is its own health signal (`syncPush`), so a slow query here degrades only
// this section and cannot blind the `sync` signals the sweep alerts hold on.
// Identifier-free (ADR 0030): counts and one age, never a location, account or
// Review. Only Properties the discovery sweep still polls are judged
// (propertyIsSyncable), so a retired Property cannot hold an alert on for good.

import { and, desc, eq, gt, isNull, notInArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { reviewGoogleReputationSnapshotFacts } from '#/shared/db/schema/review-reputation.schema'
import {
  reviewFirstSightings,
  reviewSyncState,
} from '#/shared/db/schema/review-sync.schema'
import { propertyIsSyncable, propertySyncableSince } from '#/shared/db/syncable-property'
import {
  PUSH_ALERT_WINDOW_MS,
  PUSH_COVERED_VIA,
  PUSH_HEALTH_WINDOW_MS,
  RECONCILIATION_OVERDUE_AFTER_MS,
  summarizeLedger,
  type LedgerSighting,
} from '#/shared/domain/push-health'

export type SyncPushHealth = Readonly<{
  push: Readonly<{
    /** Reviews first seen in the last day by a push, or by the snapshot a push handed off to. */
    newByPush24h: number
    /** Reviews first seen in the last day by polling or an on-demand read. */
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
    /** Syncable Properties whose newest completed reconciliation is over the limit. */
    overdueCount: number
    /** Age of the oldest overdue one; null when none is overdue. */
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

export const ZERO_SYNC_PUSH_HEALTH: SyncPushHealth = {
  push: EMPTY_PUSH,
  reconciliation: { overdueCount: 0, oldestAgeMs: null },
}

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
  const rows = await db
    .select({
      organizationId: reviewFirstSightings.organizationId,
      propertyId: reviewFirstSightings.propertyId,
      connectionId: properties.googleConnectionId,
      accountId: properties.gbpAccountId,
      firstSeenVia: reviewFirstSightings.firstSeenVia,
      firstSeenAt: reviewFirstSightings.firstSeenAt,
      pushAcceptedAt: reviewFirstSightings.pushAcceptedAt,
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
        notInArray(reviewFirstSightings.firstSeenVia, [...PUSH_COVERED_VIA]),
      ),
    )
    .orderBy(desc(reviewFirstSightings.firstSeenAt))
    .limit(LEDGER_ROW_CAP)
  return rows.map((row) => ({
    firstSeenVia: row.firstSeenVia as LedgerSighting['firstSeenVia'],
    firstSeenAt: row.firstSeenAt,
    pushAcceptedAt: row.pushAcceptedAt,
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
    newByPoll24h: counts.byPoll,
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
 * the newest snapshot fact of its CURRENT source epoch (a relink bumps the
 * epoch, so an older epoch's fact never counts), or the day it qualified when
 * it has none, whichever is later (a restored Property is late from the day it
 * was restored, not from the fact it kept). A Property parked with a coded
 * failure is left to that failure's own alert.
 */
async function readReconciliationAge(
  db: Database,
): Promise<SyncPushHealth['reconciliation']> {
  const facts = reviewGoogleReputationSnapshotFacts
  const newestFact = sql`(
    SELECT ${facts.evaluatedAt} FROM ${facts}
    WHERE ${facts.organizationId} = ${properties.organizationId}
      AND ${facts.propertyId} = ${properties.id}
      AND ${facts.sourceEpoch} = ${properties.sourceEpoch}
    ORDER BY ${facts.evaluatedAt} DESC
    LIMIT 1
  )`
  const ageMs = sql`EXTRACT(EPOCH FROM (NOW() - GREATEST(${newestFact}, ${propertySyncableSince}))) * 1000`
  const overdue = sql`${ageMs} > ${RECONCILIATION_OVERDUE_AFTER_MS}`
  const [row] = await db
    .select({
      overdue: sql<number>`count(*) FILTER (WHERE ${overdue})::int`,
      oldestAgeMs: sql<number | null>`max(${ageMs}) FILTER (WHERE ${overdue})`,
    })
    .from(properties)
    .innerJoin(googleConnections, eq(googleConnections.id, properties.googleConnectionId))
    .leftJoin(
      reviewSyncState,
      and(
        sql`${reviewSyncState.propertyId} = ${properties.id}::varchar`,
        eq(reviewSyncState.source, 'google'),
      ),
    )
    .where(and(propertyIsSyncable, isNull(reviewSyncState.errorClass)))
  return {
    overdueCount: row?.overdue ?? 0,
    oldestAgeMs: row?.oldestAgeMs == null ? null : Math.round(Number(row.oldestAgeMs)),
  }
}

/**
 * The `syncPush` health signal. `gbpPushEnabled` is the readiness fact the
 * composition root supplies (GBP_PUBSUB_TOPIC): with no topic there is no push
 * to measure, so the push counts stay zero and only the reconciliation age,
 * which does not depend on push, is read.
 */
export async function readSyncPushHealth(
  db: Database,
  gbpPushEnabled: boolean,
): Promise<SyncPushHealth> {
  const push = gbpPushEnabled ? await readPushHealth(db) : EMPTY_PUSH
  return { push, reconciliation: await readReconciliationAge(db) }
}
