// The e2e seed's Google side on PostgreSQL (scripts/local/seed-google-reviews.ts).
//
// The Properties list and the Overview's Rating tile show Google's own number
// from the Current on Google snapshot, and a dash when Google never sent one.
// The seed puts its reviews straight into the cache, so it has to write the
// numbers a Google import would: these read them back through the Properties
// list's own read, through Review's history and the outbox, and through the
// two worker consumers that relay the seed's fact once the stack is up.
//
// One held transaction per test, always rolled back.

import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getFleetOverview } from '#/contexts/reporting/application/use-cases/get-fleet-overview'
import { createRatingGoalEvaluator } from '#/contexts/reporting/application/use-cases/rating-goals'
import { createFleetOverviewProjectionAdapter } from '#/contexts/reporting/infrastructure/adapters/fleet-overview-projection.adapter'
import { handleCurrentGoogleReputationSnapshot } from '#/contexts/reporting/infrastructure/current-google-reputation-outbox-consumers'
import { handleRatingGoalEvaluation } from '#/contexts/reporting/infrastructure/rating-goal-outbox-consumers'
import { createCurrentGoogleReputationSnapshotRepository } from '#/contexts/reporting/infrastructure/repositories/current-google-reputation-snapshot.repository'
import {
  createPropertyRatingGoalRepository,
  createRatingGoalPropertyFactsReader,
} from '#/contexts/reporting/infrastructure/repositories/property-rating-goal.repository'
import { createGoogleRatingReads } from '#/contexts/review/infrastructure/google-rating-reads'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import {
  ensureGoogleNumbers,
  ensureReviews,
} from '../../../scripts/local/seed-google-reviews'

const ORG_A = organizationId(`org-e2e-seed-google-${randomUUID()}`)
const ORG_B = organizationId(`org-e2e-seed-google-locked-${randomUUID()}`)
const DAY = 24 * 60 * 60 * 1000
/** The seed's reviews are dated from the wall clock, so the seed's `now` is too. */
const NOW = new Date()

let held: HeldTransaction

type Scope = Readonly<{ organizationId: string; propertyId: string }>

async function insertOrganization(id: string): Promise<void> {
  await held.client.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())`,
    [id],
  )
}

/** A Property as the seed leaves one: active, never linked to Google. */
async function insertProperty(organization: string, sourceEpoch = 0): Promise<string> {
  const id = randomUUID()
  await held.client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
     VALUES ($1::uuid, $2, $1::text, $1::text, 'America/New_York', $3)`,
    [id, organization, sourceEpoch],
  )
  return id
}

async function insertReview(
  scope: Scope,
  review: Readonly<{ rating: number; sourceEpoch?: number; expired?: boolean }>,
): Promise<void> {
  const contentExpiresAt = new Date(NOW.getTime() + (review.expired ? -1 : 20) * DAY)
  await held.client.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, external_location_id,
       reviewer_name, rating, text, reviewed_at, expires_at, content_expires_at,
       first_fetched_at, last_fetched_at, source_epoch, source_revision,
       analysis_sequence, ai_source_byte_length, ai_source_digest
     ) VALUES (
       $1::uuid, $2, $3, 'google', $1::text, 'e2e-seed-location', 'Guest', $4, 'Stay', $5,
       $6, $6, $5, $5, $7, 0, 0, 1, $8
     )`,
    [
      randomUUID(),
      scope.organizationId,
      scope.propertyId,
      review.rating,
      new Date(NOW.getTime() - 3 * DAY),
      contentExpiresAt,
      review.sourceEpoch ?? 0,
      '0'.repeat(64),
    ],
  )
}

async function insertReviews(
  scope: Scope,
  ratings: readonly number[],
  sourceEpoch = 0,
): Promise<void> {
  for (const rating of ratings) await insertReview(scope, { rating, sourceEpoch })
}

const repeat = (rating: number, times: number): number[] =>
  Array.from({ length: times }, () => rating)

/** Google's numbers as the Properties list reads them, by Property. */
async function listedGoogleNumbers(
  organization: string,
  ids: readonly string[],
): Promise<Map<string, unknown>> {
  const read = getFleetOverview({
    projection: createFleetOverviewProjectionAdapter(held.db),
    resolveAccessiblePropertyIds: async () => ids.map((id) => propertyId(id)),
    clock: () => NOW,
    inboxTargets: {
      getGoogleReviewTargetCountsByProperty: async (input) =>
        new Map(input.propertyIds.map((id) => [id, { activeCount: 0, overdueCount: 0 }])),
    },
  })
  const fleet = await read({
    organizationId: organizationId(organization),
    scope: { userId: userId('e2e-seed-google-reader'), organizationWide: false },
    portalReadEnabled: true,
    goalReadEnabled: true,
    timeRange: 'all',
  })
  return new Map(fleet.entries.map((entry) => [entry.propertyId, entry.google]))
}

async function snapshotRow(id: string) {
  const rows = await held.client.query(
    `SELECT review_count, average_rating, source_epoch, source_run_id, source_event_id,
            evaluated_at
     FROM metric_current_google_reputation_snapshots WHERE property_id = $1`,
    [id],
  )
  return rows.rows[0] as Record<string, unknown> | undefined
}

/** Review's history facts for a Property, oldest first. */
async function historyFacts(id: string) {
  const rows = await held.client.query(
    `SELECT run_id, event_id, review_count, average_rating, evaluated_at
     FROM review_google_reputation_snapshot_facts
     WHERE property_id = $1 ORDER BY evaluated_at`,
    [id],
  )
  return rows.rows as Array<Record<string, unknown>>
}

/** The seed's fact as the relay hands it to a consumer. */
async function relayedFact(eventId: string) {
  const rows = await held.client.query(
    `SELECT id, event_type AS "eventType", event_version AS "eventVersion", payload,
            organization_id AS "organizationId", property_id AS "propertyId",
            source_context AS "sourceContext",
            source_aggregate_id AS "sourceAggregateId", created_at AS "recordedAt"
     FROM outbox_events WHERE id = $1`,
    [eventId],
  )
  return buildConsumerEvent(rows.rows[0])
}

beforeAll(() => {
  registerAllEventSchemas()
})

beforeEach(async () => {
  held = await holdTransaction()
  await insertOrganization(ORG_A)
  await insertOrganization(ORG_B)
})

afterEach(async () => {
  await held.rollBack()
})

describe("the e2e seed's Google numbers on PostgreSQL", () => {
  it('gives every seeded Property with Google reviews the number Google shows, as the Properties list reads it', async () => {
    // Arrange: the landscape's Properties, two organizations, as the seed has them.
    const p1Id = await insertProperty(ORG_A)
    const p2Id = await insertProperty(ORG_A)
    const p3Id = await insertProperty(ORG_B)
    const boundedIds: string[] = []
    for (let index = 0; index < 7; index += 1) {
      boundedIds.push(await insertProperty(ORG_A))
    }
    await ensureReviews(held.db, {
      orgAId: ORG_A,
      lockedOrgId: ORG_B,
      p1Id,
      p2Id,
      p3Id,
      boundedIds,
    })

    // Act
    const seeded = await ensureGoogleNumbers(
      held.db,
      [p1Id, p2Id, p3Id, ...boundedIds],
      NOW,
    )

    // Assert: stars cycle 1 to 5, so P1's 40, P2's 20 and P3's 20 average 3.0,
    // and the bounded Properties' two or three reviews land on other tenths.
    expect(seeded).toHaveLength(10)
    const orgA = await listedGoogleNumbers(ORG_A, [p1Id, p2Id, ...boundedIds])
    // Never linked to Google, so the numbers are Google's last, with their date.
    const asOf = { asOf: NOW.toISOString(), current: false }
    expect(orgA.get(p1Id)).toEqual({ shows: 3, reviewCount: 40, ...asOf })
    expect(orgA.get(p2Id)).toEqual({ shows: 3, reviewCount: 20, ...asOf })
    expect(boundedIds.map((id) => orgA.get(id))).toEqual(
      [
        [3, 3],
        [2.3, 3],
        [3.3, 3],
        [2.7, 3],
        [3.7, 3],
        [3, 3],
        [3, 2],
      ].map(([shows, reviewCount]) => ({ shows, reviewCount, ...asOf })),
    )
    const orgB = await listedGoogleNumbers(ORG_B, [p3Id])
    expect(orgB.get(p3Id)).toEqual({ shows: 3, reviewCount: 20, ...asOf })
    // Stored as the float32 Google sends, not as RepKey's 2.333 average.
    expect((await snapshotRow(boundedIds[1]!))?.average_rating).toBe(2.299999952316284)
  })

  it("counts only the reviews Google still counts and rounds half up, as Google's one decimal does", async () => {
    // Arrange: 25 current reviews averaging 3.92, plus one from the binding
    // before and one whose cached copy expired; 20 averaging exactly 4.45; none.
    const relinked = await insertProperty(ORG_A, 1)
    const relinkedScope = { organizationId: ORG_A, propertyId: relinked }
    await insertReviews(relinkedScope, [...repeat(4, 23), 3, 3], 1)
    await insertReview(relinkedScope, { rating: 1, sourceEpoch: 0 })
    await insertReview(relinkedScope, { rating: 1, sourceEpoch: 1, expired: true })
    const halfway = await insertProperty(ORG_A)
    await insertReviews({ organizationId: ORG_A, propertyId: halfway }, [
      ...repeat(5, 9),
      ...repeat(4, 11),
    ])
    const empty = await insertProperty(ORG_A)

    // Act
    const seeded = await ensureGoogleNumbers(held.db, [relinked, halfway, empty], NOW)

    // Assert: counting the other two would make 27 reviews averaging 3.70.
    expect(seeded).toEqual([
      { propertyId: relinked, reviewCount: 25, averageRating: 3.9000000953674316 },
      { propertyId: halfway, reviewCount: 20, averageRating: 4.5 },
    ])
    expect(await snapshotRow(relinked)).toMatchObject({
      review_count: 25,
      average_rating: 3.9000000953674316,
      source_epoch: 1,
    })
    expect(await snapshotRow(empty)).toBeUndefined()
  })

  it('records what a completed import records, and a reseed verifies again instead of replaying', async () => {
    // Arrange
    const property = await insertProperty(ORG_A)
    const scope = { organizationId: ORG_A, propertyId: property }
    await insertReviews(scope, repeat(5, 12))
    const later = new Date(NOW.getTime() + 60_000)

    // Act
    await ensureGoogleNumbers(held.db, [property], NOW)
    await insertReview(scope, { rating: 1 })
    await ensureGoogleNumbers(held.db, [property], later)

    // Assert: Review's history keeps both verifications; the snapshot is the newer.
    const facts = await historyFacts(property)
    expect(facts.map((fact) => [fact.review_count, fact.average_rating])).toEqual([
      [12, 5],
      [13, 4.699999809265137],
    ])
    const newest = facts[1]!
    expect(await snapshotRow(property)).toEqual({
      review_count: 13,
      average_rating: 4.699999809265137,
      source_epoch: 0,
      source_run_id: newest.run_id,
      source_event_id: newest.event_id,
      evaluated_at: later,
    })
    const events = await held.client.query(
      `SELECT e.id, e.source_aggregate_id, r.consumer_name, r.status
       FROM outbox_events e
       JOIN event_consumer_receipts r ON r.event_id = e.id
       WHERE e.property_id = $1 AND e.event_type = 'review.google_reputation_snapshot.verified'
       ORDER BY e.created_at`,
      [property],
    )
    expect(events.rows).toEqual(
      facts.map((fact) => ({
        id: fact.event_id,
        source_aggregate_id: fact.run_id,
        consumer_name: 'metric.current-google-reputation',
        status: 'applied',
      })),
    )
  })

  it('leaves the worker nothing to change when it relays the seed’s fact', async () => {
    // Arrange
    const property = await insertProperty(ORG_A)
    await insertReviews({ organizationId: ORG_A, propertyId: property }, repeat(4, 10))
    await ensureGoogleNumbers(held.db, [property], NOW)
    const [fact] = await historyFacts(property)
    const event = await relayedFact(String(fact!.event_id))
    const before = await snapshotRow(property)
    const google = createCurrentGoogleReputationSnapshotRepository(held.db)
    const evaluate = createRatingGoalEvaluator({
      repository: createPropertyRatingGoalRepository(held.db),
      properties: createRatingGoalPropertyFactsReader(held.db),
      google,
      reviews: createGoogleRatingReads({ db: held.db, clock: () => NOW }),
      now: () => NOW,
    })

    // Act
    const snapshot = await handleCurrentGoogleReputationSnapshot(google, event)
    const goal = await handleRatingGoalEvaluation({ evaluate, db: held.db }, event)

    // Assert
    expect(snapshot).toEqual({ status: 'duplicate' })
    expect(goal).toEqual({ status: 'applied' })
    expect(await snapshotRow(property)).toEqual(before)
  })
})
