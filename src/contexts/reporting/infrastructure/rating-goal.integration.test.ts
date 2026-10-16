// The Property Google rating goal end to end on PostgreSQL: Google's numbers
// from the Current on Google snapshot, the review cache through Review's own
// read, the goal tables, and the evaluation consumer, all wired as the build
// wires them. A goal is set from the setup read, reached on the read that
// finds Google showing the target, and ended by the consumer when the Google
// location changes under it. Its notices are written once, as outbox facts,
// by whichever evaluation first stores the change: a read, the consumer or
// the daily sweep.
//
// One held transaction per test, always rolled back.

import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createGoogleRatingReads } from '#/contexts/review/infrastructure/google-rating-reads'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import type {
  GoalActor,
  GoalExecutionPolicy,
} from '../application/use-cases/goal-programs'
import {
  createArchivedPropertyRatingGoalEnder,
  createRatingGoalEvaluator,
  createRatingGoalRequestApi,
} from '../application/use-cases/rating-goals'
import { sweepRatingGoals } from '../application/use-cases/rating-goal-sweep'
import { registerRatingGoalEvaluationConsumer } from './rating-goal-outbox-consumers'
import { registerRatingGoalPropertyLifecycleConsumer } from './rating-goal-property-lifecycle-consumers'
import { createCurrentGoogleReputationSnapshotRepository } from './repositories/current-google-reputation-snapshot.repository'
import {
  createPropertyRatingGoalRepository,
  createRatingGoalPropertyFactsReader,
} from './repositories/property-rating-goal.repository'

const ORG = 'org-rating-goal-e2e-000000001'
const USER = 'user-rating-goal-e2e-000000001'
const PROPERTY = '5a000000-0000-4000-8000-000000000001'
const CONNECTION = '5a000000-0000-4000-8000-000000000002'
const NOW = new Date('2026-10-14T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const actor: GoalActor = { organizationId: ORG, userId: USER, role: 'AccountAdmin' }
const allow: GoalExecutionPolicy = { authorize: async () => undefined }

let held: HeldTransaction

async function seedBoundProperty(): Promise<void> {
  await held.client.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())`,
    [ORG],
  )
  await held.client.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Rating goal manager', 'rating-goal-e2e@example.com', true, now(), now())`,
    [USER],
  )
  await held.client.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       visibility, status, credential_use_state, lifecycle_version,
       access_version, credential_generation
     ) VALUES (
       $1, $2, 'rating-goal-e2e-subject', 'encrypted-access', 'encrypted-refresh',
       now() + interval '1 hour', ARRAY['test'], $3, 'organization', 'active', 'active',
       1, 1, 1
     )`,
    [CONNECTION, ORG, USER],
  )
  await held.client.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, google_connection_id,
       gbp_account_id, gbp_location_id, profile_version, google_binding_state,
       profile_source, profile_confirmed_at, profile_confirmed_by, lifecycle_state,
       source_epoch
     ) VALUES (
       $1::uuid, $2, 'Rating goal hotel', $1::text, 'Europe/Sofia', $3,
       'rating-goal-account', 'rating-goal-location', 2, 'active', 'tenant_confirmed',
       now(), $4, 'active', 2
     )`,
    [PROPERTY, ORG, CONNECTION, USER],
  )
}

/**
 * Fifteen current Google reviews: four 3★ from more than 90 days ago, then nine
 * 5★ and two 4★ in the last 60 days. Exact 65 / 15 = 4.333 (Google shows 4.3),
 * a recent mix of 53 / 11 = 4.818.
 */
async function seedReviews(): Promise<void> {
  const reviews = [
    ...[100, 110, 120, 130].map((daysAgo) => ({ rating: 3, daysAgo })),
    ...[2, 7, 12, 17, 22, 27, 32, 37, 42].map((daysAgo) => ({ rating: 5, daysAgo })),
    ...[47, 52].map((daysAgo) => ({ rating: 4, daysAgo })),
  ]
  for (const [index, review] of reviews.entries()) {
    await insertReview(review, `rating-goal-e2e-${index}`)
  }
}

async function insertReview(
  review: Readonly<{ rating: number; daysAgo: number }>,
  externalId: string,
): Promise<void> {
  await held.client.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, external_location_id,
       reviewer_name, rating, text, reviewed_at, expires_at, content_expires_at,
       first_fetched_at, last_fetched_at, source_epoch, source_revision,
       analysis_sequence, ai_source_byte_length, ai_source_digest
     ) VALUES (
       $1, $2, $3, 'google', $4, 'rating-goal-location', 'Guest', $5, 'Stay', $6,
       $7, $7, $6, $6, 2, 0, 0, 1, $8
     )`,
    [
      randomUUID(),
      ORG,
      PROPERTY,
      externalId,
      review.rating,
      new Date(NOW.getTime() - review.daysAgo * DAY),
      new Date(NOW.getTime() + 20 * DAY),
      '0'.repeat(64),
    ],
  )
}

/** Eight 1★ reviews in the last eight days: with the two 5★ since, ten at 1.8. */
async function seedRecentOneStarReviews(): Promise<void> {
  for (const daysAgo of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await insertReview({ rating: 1, daysAgo }, `rating-goal-e2e-low-${daysAgo}`)
  }
}

/** Google's numbers as the snapshot consumer stores them, one hour old. */
async function seedSnapshot(averageRating: number, sourceEpoch = 2): Promise<void> {
  await held.client.query(
    `INSERT INTO metric_current_google_reputation_snapshots (
       property_id, organization_id, source_epoch, source_run_id, source_event_id,
       review_count, average_rating, evaluated_at
     ) VALUES ($1, $2, $3, $4, $5, 15, $6, $7)
     ON CONFLICT (property_id) DO UPDATE SET
       average_rating = EXCLUDED.average_rating, source_epoch = EXCLUDED.source_epoch`,
    [
      PROPERTY,
      ORG,
      sourceEpoch,
      randomUUID(),
      randomUUID(),
      averageRating,
      new Date(NOW.getTime() - 60 * 60 * 1000),
    ],
  )
}

function engine() {
  const deps = {
    repository: createPropertyRatingGoalRepository(held.db),
    properties: createRatingGoalPropertyFactsReader(held.db),
    google: createCurrentGoogleReputationSnapshotRepository(held.db),
    reviews: createGoogleRatingReads({ db: held.db, clock: () => NOW }),
    id: randomUUID,
    now: () => NOW,
  }
  return {
    api: createRatingGoalRequestApi(deps),
    evaluate: createRatingGoalEvaluator(deps),
    endForArchivedProperty: createArchivedPropertyRatingGoalEnder(deps),
    sweep: () => sweepRatingGoals(deps, async () => true),
  }
}

/** The notice facts the evaluations of this test wrote, oldest first. */
async function noticeFacts() {
  const rows = await held.client.query(
    `SELECT payload, property_id FROM outbox_events
     WHERE organization_id = $1 AND event_type = 'goal.rating_goal.transitioned'
     ORDER BY created_at, id`,
    [ORG],
  )
  return rows.rows as Array<{ payload: Record<string, unknown>; property_id: string }>
}

/** A fact as the relay hands it to a consumer, with its outbox row stored. */
async function relayedFact(
  eventType: string,
  sourceContext: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<ConsumerEvent> {
  const eventId = randomUUID()
  const sourceAggregateId = randomUUID()
  await held.client.query(
    `INSERT INTO outbox_events (id, event_type, event_version, payload, organization_id,
       property_id, source_context, source_aggregate_id)
     VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
    [
      eventId,
      eventType,
      JSON.stringify(payload),
      ORG,
      PROPERTY,
      sourceContext,
      sourceAggregateId,
    ],
  )
  return {
    eventId,
    eventType,
    eventVersion: 1,
    payload,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceContext,
    sourceAggregateId,
    occurredAt: NOW.toISOString(),
  }
}

async function receiptsFor(eventId: string) {
  const receipts = await held.client.query(
    `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
    [eventId],
  )
  return receipts.rows
}

beforeAll(() => {
  registerAllEventSchemas()
})

beforeEach(async () => {
  held = await holdTransaction()
  await seedBoundProperty()
  await seedReviews()
})

afterEach(async () => {
  await held.rollBack()
})

describe('a Property Google rating goal on PostgreSQL', () => {
  it('is set from the setup read and reached when Google shows the target', async () => {
    // Google rounds 4.333 to 4.3, stored as the float32 it sends.
    await seedSnapshot(Math.fround(4.3))
    const { api } = engine()
    const input = { propertyId: PROPERTY }

    const setup = await api.setup(allow, input, actor)
    expect(setup).toMatchObject({
      eligibility: { eligible: true },
      google: { shows: 4.3, reviewCount: 15, current: true },
      exactAverage: 4.333,
      exactAverageSource: 'cache',
      offersClimb: true,
    })
    // The page works the plan out from these: the cache's exact 65 / 15.
    expect(setup.setupInputs).toMatchObject({
      reviewCount: 15,
      displayedTenths: 43,
      exact: { num: 13, den: 3 },
      exactSource: 'cache',
      reviewsLast90Days: 11,
    })

    const set = await api.set(
      allow,
      {
        propertyId: PROPERTY,
        mode: 'climb',
        targetTenths: 44,
        qualityTenths: 48,
        paceTenthsPerWeek: 20,
      },
      actor,
    )
    await expect(api.card(allow, input, actor)).resolves.toMatchObject({
      goalId: set.goalId,
      state: 'active',
      status: 'getting_started',
      target: 4.4,
    })

    await seedSnapshot(Math.fround(4.4))
    await expect(api.card(allow, input, actor)).resolves.toMatchObject({
      state: 'reached',
      status: 'reached',
    })
    await expect(api.card(allow, input, actor)).resolves.toBeNull()
    await expect(api.history(allow, input, actor)).resolves.toEqual([
      expect.objectContaining({
        goalId: set.goalId,
        state: 'reached',
        reachedAt: NOW.toISOString(),
      }),
    ])
  })

  it('is ended by the evaluation consumer once the Google location changes', async () => {
    await seedSnapshot(Math.fround(4.3))
    const { api, evaluate } = engine()
    const set = await api.set(
      allow,
      {
        propertyId: PROPERTY,
        mode: 'climb',
        targetTenths: 44,
        qualityTenths: 48,
        paceTenthsPerWeek: 20,
      },
      actor,
    )
    await held.client.query('UPDATE properties SET source_epoch = 3 WHERE id = $1', [
      PROPERTY,
    ])
    const eventId = randomUUID()
    const evaluatedAt = NOW.toISOString()
    const payload = {
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: 3,
      runId: randomUUID(),
      reviewCount: 15,
      averageRating: 4.3,
      evaluatedAt,
      occurredAt: evaluatedAt,
      sourceAggregateVersion: evaluatedAt,
    }
    await held.client.query(
      `INSERT INTO outbox_events (id, event_type, event_version, payload, organization_id,
         property_id, source_context, source_aggregate_id)
       VALUES ($1, 'review.google_reputation_snapshot.verified', 1, $2, $3, $4, 'review', $5)`,
      [eventId, JSON.stringify(payload), ORG, PROPERTY, payload.runId],
    )
    const registry = createConsumerRegistry()
    registerRatingGoalEvaluationConsumer(registry, { evaluate, db: held.db })
    const [consumer] = registry.listFor('review.google_reputation_snapshot.verified')

    await expect(
      consumer!.handler({
        eventId,
        eventType: 'review.google_reputation_snapshot.verified',
        eventVersion: 1,
        payload,
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'review',
        sourceAggregateId: payload.runId,
        occurredAt: evaluatedAt,
        sourceAggregateVersion: evaluatedAt,
      } as never),
    ).resolves.toEqual({ status: 'applied' })

    await expect(api.history(allow, { propertyId: PROPERTY }, actor)).resolves.toEqual([
      expect.objectContaining({
        goalId: set.goalId,
        state: 'ended',
        endedReason: 'google_location_changed',
      }),
    ])
    const receipts = await held.client.query(
      `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
      [eventId],
    )
    expect(receipts.rows).toEqual([
      { consumer_name: 'goal.google-rating-evaluation', status: 'applied' },
    ])
  })

  it('is ended by the archive consumer even when nobody looks while the Property is archived', async () => {
    await seedSnapshot(Math.fround(4.3))
    const { api, endForArchivedProperty } = engine()
    const set = await api.set(
      allow,
      {
        propertyId: PROPERTY,
        mode: 'climb',
        targetTenths: 44,
        qualityTenths: 48,
        paceTenthsPerWeek: 20,
      },
      actor,
    )
    await held.client.query(
      `UPDATE properties SET lifecycle_state = 'archived', source_epoch = 3 WHERE id = $1`,
      [PROPERTY],
    )
    const fact = await relayedFact('property.archived', 'property', {
      propertyId: PROPERTY,
      organizationId: ORG,
      userId: USER,
      previousState: 'active',
      sourceEpoch: 3,
      recoveryDeadline: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      occurredAt: NOW.toISOString(),
    })
    const registry = createConsumerRegistry()
    registerRatingGoalPropertyLifecycleConsumer(registry, {
      endForArchivedProperty,
      db: held.db,
    })
    const [consumer] = registry.listFor('property.archived')

    await expect(consumer!.handler(fact)).resolves.toEqual({ status: 'applied' })
    // Restore moves the epoch again; the goal still reads as ended by the archive.
    await held.client.query(
      `UPDATE properties SET lifecycle_state = 'active', source_epoch = 4 WHERE id = $1`,
      [PROPERTY],
    )

    await expect(api.history(allow, { propertyId: PROPERTY }, actor)).resolves.toEqual([
      expect.objectContaining({
        goalId: set.goalId,
        state: 'ended',
        endedReason: 'property_archived',
      }),
    ])
    await expect(receiptsFor(fact.eventId)).resolves.toEqual([
      { consumer_name: 'goal.on-property-archived', status: 'applied' },
    ])
  })

  it('refuses a goal while the Property has fewer than ten Google reviews', async () => {
    await held.client.query(
      `INSERT INTO metric_current_google_reputation_snapshots (
         property_id, organization_id, source_epoch, source_run_id, source_event_id,
         review_count, average_rating, evaluated_at
       ) VALUES ($1, $2, 2, $3, $4, 6, 4.4, $5)`,
      [PROPERTY, ORG, randomUUID(), randomUUID(), new Date(NOW.getTime() - 3600_000)],
    )
    const { api } = engine()

    await expect(
      api.setup(allow, { propertyId: PROPERTY }, actor),
    ).resolves.toMatchObject({
      eligibility: { eligible: false, reason: 'few_reviews', reviewCount: 6 },
    })
    await expect(
      api.set(
        allow,
        {
          propertyId: PROPERTY,
          mode: 'climb',
          targetTenths: 45,
          qualityTenths: 48,
          paceTenthsPerWeek: 20,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'not_eligible' })
  })
})

describe('the notices of a Property Google rating goal on PostgreSQL', () => {
  it('writes one reached fact from the read that finds the target, and none for the consumer after it', async () => {
    await seedSnapshot(Math.fround(4.3))
    const { api, evaluate } = engine()
    const set = await api.set(
      allow,
      {
        propertyId: PROPERTY,
        mode: 'climb',
        targetTenths: 44,
        qualityTenths: 48,
        paceTenthsPerWeek: 20,
      },
      actor,
    )
    await seedSnapshot(Math.fround(4.4))

    await api.card(allow, { propertyId: PROPERTY }, actor)
    await evaluate(ORG, PROPERTY)

    const facts = await noticeFacts()
    expect(facts).toEqual([
      {
        property_id: PROPERTY,
        payload: expect.objectContaining({
          organizationId: ORG,
          propertyId: PROPERTY,
          goalId: set.goalId,
          transition: 'reached',
          mode: 'climb',
          targetTenths: 44,
          shownTenths: 44,
          previousTenths: null,
        }),
      },
    ])
  })

  it('tells a tenth gained once, however many evaluations see it', async () => {
    await seedSnapshot(Math.fround(4.3))
    const { api, evaluate } = engine()
    await api.set(
      allow,
      {
        propertyId: PROPERTY,
        mode: 'climb',
        targetTenths: 46,
        qualityTenths: 48,
        paceTenthsPerWeek: 20,
      },
      actor,
    )
    await seedSnapshot(Math.fround(4.4))

    await evaluate(ORG, PROPERTY)
    await evaluate(ORG, PROPERTY)
    await api.detail(allow, { propertyId: PROPERTY }, actor)

    expect((await noticeFacts()).map((fact) => fact.payload)).toEqual([
      expect.objectContaining({
        transition: 'google_rating_changed',
        shownTenths: 44,
        previousTenths: 43,
        targetTenths: 46,
      }),
    ])
  })

  it('finds Below pace in the daily sweep, once, and tells nobody again the next day', async () => {
    await seedSnapshot(Math.fround(4.3))
    const { api, sweep } = engine()
    const set = await api.set(
      allow,
      {
        propertyId: PROPERTY,
        mode: 'climb',
        targetTenths: 44,
        qualityTenths: 48,
        paceTenthsPerWeek: 200,
      },
      actor,
    )
    // Thirty days on: six reviews in the last 28 days is 1.5 a week, far
    // under 90% of 20.
    await held.client.query(
      `UPDATE property_rating_goals SET created_at = $2 WHERE id = $1`,
      [set.goalId, new Date(NOW.getTime() - 30 * DAY)],
    )

    await expect(sweep()).resolves.toMatchObject({ evaluated: 1, notices: 1 })
    await expect(sweep()).resolves.toMatchObject({ evaluated: 1, notices: 0 })

    expect((await noticeFacts()).map((fact) => fact.payload)).toEqual([
      expect.objectContaining({
        goalId: set.goalId,
        transition: 'entered_below_pace',
        pacePerWeek: 20,
        paceTenthsPerWeek: 200,
        recentPaceTenths: 15,
        paceWindow: 'last_4_weeks',
      }),
    ])
    const stored = await held.client.query(
      `SELECT last_evaluated_status, last_known_status, below_pace_noticed_at,
              cant_reach_noticed_at
       FROM property_rating_goals WHERE id = $1`,
      [set.goalId],
    )
    expect(stored.rows).toEqual([
      {
        last_evaluated_status: 'below_pace',
        last_known_status: 'below_pace',
        below_pace_noticed_at: NOW,
        cant_reach_noticed_at: null,
      },
    ])
  })

  describe('New reviews too low in the daily sweep', () => {
    /**
     * A 4.4 goal set ten days ago; the ten reviews since (eight 1★, two 5★)
     * average 1.8, under 4.4's threshold of 4.35.
     */
    async function goalWhoseNewReviewsAreTooLow() {
      await seedSnapshot(Math.fround(4.3))
      const { api, sweep } = engine()
      const set = await api.set(
        allow,
        {
          propertyId: PROPERTY,
          mode: 'climb',
          targetTenths: 44,
          qualityTenths: 48,
          paceTenthsPerWeek: 20,
        },
        actor,
      )
      await held.client.query(
        `UPDATE property_rating_goals SET created_at = $2 WHERE id = $1`,
        [set.goalId, new Date(NOW.getTime() - 10 * DAY)],
      )
      await seedRecentOneStarReviews()
      return { goalId: set.goalId, sweep }
    }

    const storedMarks = async (goalId: string) =>
      (
        await held.client.query(
          `SELECT last_known_status, below_pace_noticed_at, cant_reach_noticed_at
           FROM property_rating_goals WHERE id = $1`,
          [goalId],
        )
      ).rows

    it('is told once, with the target alone, and not again the next day', async () => {
      const { goalId, sweep } = await goalWhoseNewReviewsAreTooLow()

      await expect(sweep()).resolves.toMatchObject({ evaluated: 1, notices: 1 })
      await expect(sweep()).resolves.toMatchObject({ evaluated: 1, notices: 0 })

      expect((await noticeFacts()).map((fact) => fact.payload)).toEqual([
        expect.objectContaining({
          goalId,
          transition: 'entered_reviews_too_low',
          targetTenths: 44,
          shownTenths: null,
          previousTenths: null,
          pacePerWeek: null,
          paceTenthsPerWeek: null,
          recentPaceTenths: null,
          paceWindow: null,
        }),
      ])
      await expect(storedMarks(goalId)).resolves.toEqual([
        {
          last_known_status: 'reviews_too_low',
          below_pace_noticed_at: null,
          cant_reach_noticed_at: NOW,
        },
      ])
    })

    it('is told again only 14 days after the last time', async () => {
      const { goalId, sweep } = await goalWhoseNewReviewsAreTooLow()
      await sweep()
      const backToOnPace = (toldDaysAgo: number) =>
        held.client.query(
          `UPDATE property_rating_goals
           SET last_known_status = 'on_pace', cant_reach_noticed_at = $2 WHERE id = $1`,
          [goalId, new Date(NOW.getTime() - toldDaysAgo * DAY)],
        )

      // New reviews recovered and fell again, 13 days after the managers were told.
      await backToOnPace(13)
      await expect(sweep()).resolves.toMatchObject({ evaluated: 1, notices: 0 })
      await expect(storedMarks(goalId)).resolves.toEqual([
        {
          last_known_status: 'reviews_too_low',
          below_pace_noticed_at: null,
          cant_reach_noticed_at: new Date(NOW.getTime() - 13 * DAY),
        },
      ])

      await backToOnPace(14)
      await expect(sweep()).resolves.toMatchObject({ evaluated: 1, notices: 1 })
      await expect(storedMarks(goalId)).resolves.toEqual([
        {
          last_known_status: 'reviews_too_low',
          below_pace_noticed_at: null,
          cant_reach_noticed_at: NOW,
        },
      ])
      expect(await noticeFacts()).toHaveLength(2)
    })
  })

  it('sends no notice for the status a goal is set in, even past the recent mix', async () => {
    await seedSnapshot(Math.fround(4.3))
    const { api, evaluate, sweep } = engine()
    // 4.9 starts at 4.85, above the 4.818 recent mix; the plan assumes 5.0.
    await api.set(
      allow,
      {
        propertyId: PROPERTY,
        mode: 'climb',
        targetTenths: 49,
        qualityTenths: 50,
        paceTenthsPerWeek: 20,
      },
      actor,
    )

    await evaluate(ORG, PROPERTY)
    await sweep()

    await expect(noticeFacts()).resolves.toEqual([])
  })
})
