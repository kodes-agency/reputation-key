// A guest corrects a rating, delivered into Metric against PostgreSQL.
//
// One rating fact becomes three readings (the Portal's private rating, and the
// two Goal measures rating count and rating average). A correction replaces
// all three, so it must retract all three: the Goal measures read the
// retraction of their OWN earlier reading, and a reading nothing retracted
// stays effective next to its replacement.
//
// The last block reads the same readings the way the Results tab and the
// Monthly portal goal each do, and holds the two to one rating count.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  metricReadingId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
} from '#/shared/domain/ids'
import type { PortalGroupPublicApi } from '#/contexts/portal/application/public-api'
import type { GoalMetricAggregateQuery } from '../application/ports/metric.repository'
import { recordMetrics } from '../application/use-cases/record-metric'
import { retractMetrics } from '../application/use-cases/retract-metric'
import { METRIC_VERSION_IDS } from '../domain/metric-registry'
import { createAtomicMetricCommandStore } from './metric-command-store'
import {
  onRatingRetractedDurably,
  onRatingSubmittedDurably,
} from './record-portal-metric'
import { createGoalMetricSourceStatus } from './repositories/goal-metric-source-status'
import { createMetricRegistryRepository } from './repositories/metric-registry.repository'
import { createMetricRepository } from './repositories/metric.repository'
import { createPortalAnalyticsRepository } from './repositories/portal-analytics.repository'
import { createPropertyLocalDateResolver } from './repositories/property-local-date'

const db = getDb()
const ORG = organizationId('org-rating-correction')
const PROPERTY = propertyId('72000000-0000-4000-8000-000000000001')
const PORTAL = portalId('72000000-0000-4000-8000-000000000002')
const ORIGINAL_EVENT = '72000000-0000-4000-8000-000000000011'
const CORRECTION_EVENT = '72000000-0000-4000-8000-000000000012'
const RETRACTION_EVENT = '72000000-0000-4000-8000-000000000013'
const ORIGINAL_AT = new Date('2026-09-15T12:00:00.000Z')
const CORRECTION_AT = new Date('2026-09-15T12:20:00.000Z')
const RETRACTION_AT = new Date('2026-09-15T12:40:00.000Z')
const PERIOD_START = new Date('2026-09-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-10-01T00:00:00.000Z')
const ORIGINAL_STARS = 5
const CORRECTED_STARS = 3

const VERSIONS = [
  METRIC_VERSION_IDS.portalRatingAnalytics,
  METRIC_VERSION_IDS.portalRatingCountGoal,
  METRIC_VERSION_IDS.portalRatingAverageGoal,
] as const

const noGroups: PortalGroupPublicApi = {
  findGroupForPortal: async () => null,
  getGroupPortalIds: async () => [],
  findGroupIdsByPortalIds: async () => [],
  portalGroupBelongsToProperty: async () => false,
  getGroupInfo: async () => null,
}

function goalQuery(
  definitionVersionId: string,
  expectedMetricKey: GoalMetricAggregateQuery['expectedMetricKey'],
): GoalMetricAggregateQuery {
  return {
    organizationId: ORG,
    propertyId: PROPERTY,
    definitionVersionId,
    expectedMetricKey,
    allowedSourcePolicies: ['first_party_guest_gateway_metric'],
    subject: { kind: 'portal', portalId: PORTAL },
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
  }
}

const COUNT_QUERY = goalQuery(
  METRIC_VERSION_IDS.portalRatingCountGoal,
  'portal.rating_count',
)
const AVERAGE_QUERY = goalQuery(
  METRIC_VERSION_IDS.portalRatingAverageGoal,
  'portal.rating_average',
)

async function insertSource(
  eventId: string,
  eventType: 'guest.rating.submitted' | 'guest.rating.retracted',
  occurredAt: Date,
  extra: Readonly<Record<string, unknown>>,
  factId: string = ORIGINAL_EVENT,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO outbox_events (
      id, event_type, event_version, payload, organization_id, property_id,
      source_context, source_aggregate_id, created_at, published_at
    ) VALUES (
      ${eventId}::uuid, ${eventType}, 1,
      ${JSON.stringify({
        ratingId: factId,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        occurredAt: occurredAt.toISOString(),
        ...extra,
      })}::jsonb,
      ${ORG}, ${PROPERTY}, 'guest', ${factId}, ${occurredAt}, ${occurredAt}
    )
  `)
}

function metricDeps(db: Database, at: Date) {
  return {
    commandStore: createAtomicMetricCommandStore(db, randomUUID),
    registry: createMetricRegistryRepository(),
    clock: () => at,
    idGen: () => metricReadingId(randomUUID()),
    resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
  }
}

async function submitRating(
  eventId: string,
  value: number,
  occurredAt: Date,
  supersedesSourceEventId: string | null,
  factId: string = ORIGINAL_EVENT,
): Promise<void> {
  await insertSource(
    eventId,
    'guest.rating.submitted',
    occurredAt,
    {
      value,
      ...(supersedesSourceEventId ? { supersedesSourceEventId } : {}),
    },
    factId,
  )
  await onRatingSubmittedDurably({
    recordMetrics: recordMetrics(metricDeps(db, occurredAt)),
    findGroupForPortal: async () => null,
  })({
    _tag: 'guest.rating.submitted',
    eventId,
    correlationId: null,
    ratingId: ratingId(factId),
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    value,
    supersedesSourceEventId,
    occurredAt,
    staffAttribution: null,
  })
}

async function redeliverCorrection(): Promise<void> {
  await onRatingSubmittedDurably({
    recordMetrics: recordMetrics(metricDeps(db, CORRECTION_AT)),
    findGroupForPortal: async () => null,
  })({
    _tag: 'guest.rating.submitted',
    eventId: CORRECTION_EVENT,
    correlationId: null,
    ratingId: ratingId(ORIGINAL_EVENT),
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    value: CORRECTED_STARS,
    supersedesSourceEventId: ORIGINAL_EVENT,
    occurredAt: CORRECTION_AT,
    staffAttribution: null,
  })
}

/** A guest withdraws a rating: the reading `supersedesSourceEventId` is retracted. */
async function withdrawRating(
  eventId: string,
  supersedesSourceEventId: string,
  factId: string,
  occurredAt: Date,
): Promise<void> {
  await insertSource(
    eventId,
    'guest.rating.retracted',
    occurredAt,
    { supersedesSourceEventId },
    factId,
  )
  await onRatingRetractedDurably({
    retractMetrics: retractMetrics(metricDeps(db, occurredAt).commandStore),
  })({
    _tag: 'guest.rating.retracted',
    eventId,
    correlationId: null,
    ratingId: ratingId(factId),
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    supersedesSourceEventId,
    occurredAt,
    staffAttribution: null,
  })
}

const retractRating = () =>
  withdrawRating(RETRACTION_EVENT, CORRECTION_EVENT, ORIGINAL_EVENT, RETRACTION_AT)

/** The measures whose earlier reading of `sourceEventId` carries a retraction. */
async function retractedVersions(sourceEventId: string): Promise<readonly string[]> {
  const { rows } = await db.execute<{ definition_version_id: string }>(sql`
    SELECT reading.definition_version_id::text AS definition_version_id
    FROM metric_corrections AS correction
    JOIN metric_readings AS reading ON reading.id = correction.reading_id
    WHERE reading.organization_id = ${ORG}
      AND reading.source_event_id = ${sourceEventId}
      AND correction.kind = 'retract'
    ORDER BY reading.definition_version_id
  `)
  return rows.map((row) => row.definition_version_id)
}

async function clean(): Promise<void> {
  await db.execute(sql`
    DELETE FROM metric_corrections
    WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = ${ORG})
  `)
  await db.execute(
    sql`DELETE FROM portal_metric_lifetime_aggregates WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM metric_readings WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Rating Correction', ${ORG}, now())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'Rating Correction Property', 'rating-correction-property', 'UTC')
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (
      ${PORTAL}, ${ORG}, ${PROPERTY}, 'property', ${PROPERTY},
      'Rating Correction Portal', 'rating-correction-portal', 'published'
    ) ON CONFLICT (id) DO NOTHING
  `)
})

beforeEach(clean)

afterAll(async () => {
  await clean()
  await db.execute(sql`DELETE FROM portals WHERE id = ${PORTAL}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}`)
  await deleteTestOrganizations(db, [ORG])
  clearEventSchemas()
})

describe.sequential('Rating correction readings (integration)', () => {
  it('retracts the earlier reading of every measure the corrected rating was counted under', async () => {
    await submitRating(ORIGINAL_EVENT, ORIGINAL_STARS, ORIGINAL_AT, null)
    await submitRating(CORRECTION_EVENT, CORRECTED_STARS, CORRECTION_AT, ORIGINAL_EVENT)

    await expect(retractedVersions(ORIGINAL_EVENT)).resolves.toEqual([...VERSIONS])
  })

  it('counts the corrected rating once, for the count and for the average', async () => {
    await submitRating(ORIGINAL_EVENT, ORIGINAL_STARS, ORIGINAL_AT, null)
    await submitRating(CORRECTION_EVENT, CORRECTED_STARS, CORRECTION_AT, ORIGINAL_EVENT)
    const repository = createMetricRepository(db, () => CORRECTION_AT)

    await expect(repository.queryGoalAggregate(COUNT_QUERY)).resolves.toMatchObject({
      readingCount: 1,
      sum: 1,
    })
    await expect(repository.queryGoalAggregate(AVERAGE_QUERY)).resolves.toMatchObject({
      readingCount: 1,
      sum: CORRECTED_STARS,
    })
  })

  it('leaves a Goal on either measure readable after a correction, not quarantined', async () => {
    await submitRating(ORIGINAL_EVENT, ORIGINAL_STARS, ORIGINAL_AT, null)
    await submitRating(CORRECTION_EVENT, CORRECTED_STARS, CORRECTION_AT, ORIGINAL_EVENT)
    const status = createGoalMetricSourceStatus(db, noGroups)
    const events = ['guest.rating.submitted', 'guest.rating.retracted']

    await expect(status.inspect(COUNT_QUERY, events)).resolves.toMatchObject({
      state: 'complete',
      relevantFactCount: 2,
    })
    await expect(status.inspect(AVERAGE_QUERY, events)).resolves.toMatchObject({
      state: 'complete',
      relevantFactCount: 2,
    })
  })

  it('records a redelivered correction once and writes no second set of retractions', async () => {
    await submitRating(ORIGINAL_EVENT, ORIGINAL_STARS, ORIGINAL_AT, null)
    await submitRating(CORRECTION_EVENT, CORRECTED_STARS, CORRECTION_AT, ORIGINAL_EVENT)

    await redeliverCorrection()

    await expect(retractedVersions(ORIGINAL_EVENT)).resolves.toEqual([...VERSIONS])
  })

  it('reuses a retraction written under the fact id alone when the replacement is delivered again', async () => {
    await submitRating(ORIGINAL_EVENT, ORIGINAL_STARS, ORIGINAL_AT, null)
    // The state before every measure had its own key: the rating's first
    // reading already carries `<fact>:retract`, and the replacement it came
    // with is not there (a retention purge took it), so the fact is delivered
    // again and writes the replacement anew.
    await db.execute(sql`
      INSERT INTO metric_corrections (
        id, reading_id, source_event_id, kind, reason, actor_type, actor_id, event_at
      )
      SELECT ${randomUUID()}::uuid, reading.id, ${`${CORRECTION_EVENT}:retract`},
             'retract', 'source_reconciliation', 'system', 'portal-workflow',
             ${CORRECTION_AT}
      FROM metric_readings AS reading
      WHERE reading.organization_id = ${ORG}
        AND reading.source_event_id = ${ORIGINAL_EVENT}
        AND reading.definition_version_id = ${METRIC_VERSION_IDS.portalRatingAnalytics}::uuid
    `)

    await submitRating(CORRECTION_EVENT, CORRECTED_STARS, CORRECTION_AT, ORIGINAL_EVENT)

    await expect(retractedVersions(ORIGINAL_EVENT)).resolves.toEqual([...VERSIONS])
    const { rows } = await db.execute<{ corrections: number }>(sql`
      SELECT count(*)::int AS corrections FROM metric_corrections
      WHERE source_event_id LIKE ${`${CORRECTION_EVENT}:%`}
    `)
    expect(rows).toEqual([{ corrections: 3 }])
  })

  it('leaves nothing counted when the corrected rating is then withdrawn', async () => {
    await submitRating(ORIGINAL_EVENT, ORIGINAL_STARS, ORIGINAL_AT, null)
    await submitRating(CORRECTION_EVENT, CORRECTED_STARS, CORRECTION_AT, ORIGINAL_EVENT)
    await retractRating()
    const repository = createMetricRepository(db, () => RETRACTION_AT)

    await expect(repository.queryGoalAggregate(COUNT_QUERY)).resolves.toMatchObject({
      readingCount: 0,
    })
    await expect(repository.queryGoalAggregate(AVERAGE_QUERY)).resolves.toMatchObject({
      readingCount: 0,
    })
  })
})

// The Results tab reads the Portal's private rating (one measure, summed in the
// period); the Monthly portal goal reads its own count and average measures
// through `queryGoalAggregate`. One transaction writes all three, so they agree
// today. Nothing else would notice if a change to either reader, or to how a
// correction or a withdrawal is folded in, made them disagree.
describe.sequential('Results and Goal rating counts (integration)', () => {
  const FACTS = {
    kept: { original: '72000000-0000-4000-8000-000000000021' },
    corrected: {
      original: '72000000-0000-4000-8000-000000000022',
      correction: '72000000-0000-4000-8000-000000000023',
    },
    withdrawn: {
      original: '72000000-0000-4000-8000-000000000024',
      withdrawal: '72000000-0000-4000-8000-000000000025',
    },
    atWindowStart: { original: '72000000-0000-4000-8000-000000000026' },
    atWindowEnd: { original: '72000000-0000-4000-8000-000000000027' },
  } as const
  const KEPT_AT = new Date('2026-09-10T09:00:00.000Z')
  const CORRECTED_AT = new Date('2026-09-12T09:00:00.000Z')
  const CORRECTED_LATER_AT = new Date('2026-09-12T09:20:00.000Z')
  const WITHDRAWN_AT = new Date('2026-09-20T09:00:00.000Z')
  const WITHDRAWN_LATER_AT = new Date('2026-09-20T09:30:00.000Z')
  const READ_AT = new Date('2026-10-02T00:00:00.000Z')
  const WINDOW_LOCAL_START = '2026-09-01'

  type RatingTally = Readonly<{ count: number; stars: number }>

  /** A guest's first rating: the fact id is the id of the event that delivers it. */
  const rate = (fact: string, stars: number, at: Date) =>
    submitRating(fact, stars, at, null, fact)

  /** The rating count and star total as the Results tab reads them: three ways. */
  async function resultsTally(): Promise<RatingTally> {
    const results = createPortalAnalyticsRepository(db, () => READ_AT)
    const args = [ORG, PROPERTY, PORTAL, PERIOD_START, PERIOD_END] as const
    const [sums, weekly, distribution] = await Promise.all([
      results.getPortalKpiSums(...args),
      results.getPortalWeeklyReadings(...args, WINDOW_LOCAL_START),
      results.getPortalRatingDistribution(...args),
    ])
    const strip = sums.find((row) => row.metricKey === 'portal.rating')
    const weeks = weekly.filter((row) => row.metricKey === 'portal.rating')
    const tally = { count: strip?.count ?? 0, stars: strip?.total ?? 0 }
    // The weekly column and the star mix must add up to the strip's own count.
    expect({
      count: weeks.reduce((sum, row) => sum + row.count, 0),
      stars: weeks.reduce((sum, row) => sum + row.total, 0),
    }).toEqual(tally)
    expect(distribution.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(tally.count)
    return tally
  }

  /** The Goal's rating count measure and rating average measure, read as its page does. */
  async function goalTally(): Promise<RatingTally & Readonly<{ averageCount: number }>> {
    const goals = createMetricRepository(db, () => READ_AT)
    const [count, average] = await Promise.all([
      goals.queryGoalAggregate(COUNT_QUERY),
      goals.queryGoalAggregate(AVERAGE_QUERY),
    ])
    expect(count.readingCount).toBe(count.sum)
    return { count: count.sum, stars: average.sum, averageCount: average.readingCount }
  }

  async function expectOneCount(expected: RatingTally): Promise<void> {
    const results = await resultsTally()
    const goal = await goalTally()

    expect(results).toEqual(expected)
    expect({ count: goal.count, stars: goal.stars }).toEqual(expected)
    expect(goal.averageCount).toBe(expected.count)
  }

  it('agrees after a rating is submitted, corrected and withdrawn', async () => {
    await rate(FACTS.kept.original, 5, KEPT_AT)
    await expectOneCount({ count: 1, stars: 5 })

    await rate(FACTS.corrected.original, 4, CORRECTED_AT)
    await expectOneCount({ count: 2, stars: 9 })

    await submitRating(
      FACTS.corrected.correction,
      2,
      CORRECTED_LATER_AT,
      FACTS.corrected.original,
      FACTS.corrected.original,
    )
    await expectOneCount({ count: 2, stars: 7 })

    await rate(FACTS.withdrawn.original, 3, WITHDRAWN_AT)
    await expectOneCount({ count: 3, stars: 10 })

    await withdrawRating(
      FACTS.withdrawn.withdrawal,
      FACTS.withdrawn.original,
      FACTS.withdrawn.original,
      WITHDRAWN_LATER_AT,
    )
    await expectOneCount({ count: 2, stars: 7 })
  })

  it('agrees on the window edges: its first instant is in, its end instant is not', async () => {
    await rate(FACTS.atWindowStart.original, 1, PERIOD_START)
    await rate(FACTS.atWindowEnd.original, 5, PERIOD_END)

    await expectOneCount({ count: 1, stars: 1 })
  })
})
