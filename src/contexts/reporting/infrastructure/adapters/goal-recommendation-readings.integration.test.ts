import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId, propertyId as toPropertyId } from '#/shared/domain/ids'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { seedCountReadings, type SeededMetric } from '../testing/goal-running-month-seed'
import { findMetricVersionById, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type { RecommendationPortal } from '../../domain/goal-recommendation-types'
import type { GoalRecommendationCountsQuery } from '../../application/ports/goal-recommendation-facts.port'
import { readPortalGoalRecommendation } from '../../application/use-cases/goal-recommendation-read'
import { createMetricRepository } from '../repositories/metric.repository'
import { readGoalRecommendationCounts } from './goal-recommendation-readings'

const SOFIA = 'Europe/Sofia'
// Oct 23, 2026, midday in Sofia (UTC+3 until the 25th).
const NOW = new Date('2026-10-23T09:00:00.000Z')
/** In October, inside the 28 days ending yesterday. */
const OCT_12 = '2026-10-12T09:00:00Z'
const OCTOBER = {
  periodStart: new Date('2026-09-30T21:00:00.000Z'),
  periodEnd: new Date('2026-10-31T22:00:00.000Z'),
}
const ORG = `org-goal-recommendation-${randomUUID()}`
const OTHER_ORG = `org-goal-recommendation-other-${randomUUID()}`

let fixture: HeldTransaction | undefined
let client: HeldTransaction['client']
let db: Database

async function seedProperty(organization = ORG): Promise<string> {
  const id = randomUUID()
  await client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1::uuid, $2, 'Seaview Hotel', $1::text, $3)`,
    [id, organization, SOFIA],
  )
  return id
}

async function seedPortal(
  property: string,
  name: string,
  state: 'published' | 'archived' = 'published',
  organization = ORG,
): Promise<string> {
  const id = randomUUID()
  await client.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id,
                          name, slug, publication_state, created_at, updated_at)
     VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text, $4, $1::text, $5, now(), now())`,
    [id, organization, property, name, state],
  )
  return id
}

type Readings = Readonly<{
  property: string
  count: number
  eventAt: string
  portalId?: string
  metric?: SeededMetric
  dataQuality?: string
  organization?: string
}>

const readings = (input: Readings) =>
  seedCountReadings(client, {
    organizationId: input.organization ?? ORG,
    propertyId: input.property,
    metric: input.metric ?? 'portal_rating_count',
    count: input.count,
    eventAt: input.eventAt,
    portalId: input.portalId,
    dataQuality: input.dataQuality,
  })

async function correct(
  sourceEventId: string,
  kind: 'retract' | 'adjust' | 'replace',
  amount: { delta?: number; replacement?: number } = {},
) {
  await client.query(
    `INSERT INTO metric_corrections (
       reading_id, source_event_id, kind, reason, actor_type, actor_id,
       exact_delta, replacement_value, event_at, recorded_at
     )
     SELECT id, $2, $3, 'verified correction', 'system', 'goal-recommendation-test',
       $4, $5, $6, $6
     FROM metric_readings WHERE source_event_id = $1`,
    [
      sourceEventId,
      `correction-${randomUUID()}`,
      kind,
      amount.delta ?? null,
      amount.replacement ?? null,
      OCT_12,
    ],
  )
}

/** The read for one Property: the basis and October so far, as the use case asks it. */
function countsOf(property: string, patch: Partial<GoalRecommendationCountsQuery> = {}) {
  return readGoalRecommendationCounts(db, {
    organizationId: ORG,
    propertyId: property,
    timezone: SOFIA,
    from: new Date('2026-09-24T21:00:00.000Z'),
    to: NOW,
    scanLookback: [],
    ...patch,
  })
}

/** A Portal Portal would list: published and live since Oct 9. */
function listed(portalId: string, name: string): RecommendationPortal {
  const since = new Date('2026-10-09T07:00:00.000Z')
  return {
    portalId,
    name,
    publicationState: 'published',
    liveSince: since,
    liveIntervals: [{ from: since, to: null }],
    codeIssuedAt: since,
    codeReady: true,
  }
}

/** The whole read over the real statement, with Portal's facts given. */
function recommendationOf(property: string, portals: readonly RecommendationPortal[]) {
  return readPortalGoalRecommendation(
    {
      policy: { authorize: async () => undefined },
      subjects: { getTimezone: async () => SOFIA },
      facts: {
        listPortalReadiness: async () => ({ portals, truncated: false }),
        readDailyCounts: (query) => readGoalRecommendationCounts(db, query),
      },
      now: () => NOW,
    },
    { propertyId: property },
    { organizationId: ORG, userId: 'manager-1', role: 'PropertyManager' },
  )
}

const ratingsOn = (
  days: Awaited<ReturnType<typeof countsOf>>['days'],
  portalId: string | null,
) =>
  days
    .filter((row) => row.portalId === portalId && row.measure === 'portal_rating_count')
    .map((row) => [row.localDay, row.count])

beforeAll(async () => {
  // Readings and corrections are written inside the held transaction and
  // rolled back after the suite; the read's statement-timeout transaction is a
  // SAVEPOINT inside it.
  fixture = await holdTransaction()
  client = fixture.client
  db = fixture.db
  for (const id of [ORG, OTHER_ORG]) {
    await client.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Goal recommendation', $2, now())`,
      [id, `goal-recommendation-${randomUUID()}`],
    )
  }
})

beforeEach(async () => {
  await client.query('SAVEPOINT goal_recommendation_case')
})

afterEach(async () => {
  await client.query('ROLLBACK TO SAVEPOINT goal_recommendation_case')
})

afterAll(async () => {
  await fixture?.rollBack()
})

describe('the readings behind the recommended number', () => {
  it('a retracted rating does not count, a replaced one counts once', async () => {
    const property = await seedProperty()
    const reception = await seedPortal(property, 'Reception')
    const [retracted, replaced] = await readings({
      property,
      portalId: reception,
      count: 3,
      eventAt: OCT_12,
    })
    await correct(retracted!, 'retract')
    await correct(replaced!, 'replace', { replacement: 1 })

    const { days, unreadable } = await countsOf(property)

    expect(ratingsOn(days, reception)).toEqual([['2026-10-12', 2]])
    expect(unreadable).toEqual([])
  })

  it('a reading from another Property or Organization never counts', async () => {
    const property = await seedProperty()
    const neighbour = await seedProperty()
    const stranger = await seedProperty(OTHER_ORG)
    await readings({ property, count: 1, eventAt: OCT_12 })
    await readings({ property: neighbour, count: 4, eventAt: OCT_12 })
    await readings({
      property: stranger,
      organization: OTHER_ORG,
      count: 6,
      eventAt: OCT_12,
    })

    const { days } = await countsOf(property)

    expect(days).toEqual([
      {
        portalId: null,
        measure: 'portal_rating_count',
        localDay: '2026-10-12',
        count: 1,
      },
    ])
  })

  it('reads only between from and to, and both measures apart', async () => {
    const property = await seedProperty()
    await readings({ property, count: 1, eventAt: '2026-09-24T20:59:59Z' })
    await readings({ property, count: 2, eventAt: '2026-09-24T21:00:00Z' })
    await readings({ property, count: 5, eventAt: OCT_12, metric: 'qualified_scans' })
    await readings({ property, count: 7, eventAt: NOW.toISOString() })

    const { days } = await countsOf(property)

    expect(days).toEqual(
      expect.arrayContaining([
        {
          portalId: null,
          measure: 'portal_rating_count',
          localDay: '2026-09-25',
          count: 2,
        },
        { portalId: null, measure: 'qualified_scans', localDay: '2026-10-12', count: 5 },
      ]),
    )
    expect(days).toHaveLength(2)
  })

  it('an approximate reading makes its portal unreadable, a retracted approximate one does not', async () => {
    const property = await seedProperty()
    const reception = await seedPortal(property, 'Reception')
    const spa = await seedPortal(property, 'Spa')
    await readings({
      property,
      portalId: reception,
      count: 1,
      eventAt: OCT_12,
      dataQuality: 'approximate',
    })
    const [withdrawn] = await readings({
      property,
      portalId: spa,
      count: 1,
      eventAt: OCT_12,
      dataQuality: 'approximate',
    })
    await correct(withdrawn!, 'retract')

    const { unreadable } = await countsOf(property)

    expect(unreadable).toEqual([
      { portalId: reception, measure: 'portal_rating_count', localDay: '2026-10-12' },
    ])
  })

  it('days follow the Property calendar', async () => {
    const property = await seedProperty()
    // 00:30 on Oct 1 in Sofia is still Sep 30 in UTC.
    await readings({ property, count: 1, eventAt: '2026-09-30T21:30:00Z' })
    // 03:30 on Oct 25 happens twice in Sofia, once in summer time, once after.
    await readings({ property, count: 1, eventAt: '2026-10-25T00:30:00Z' })
    await readings({ property, count: 1, eventAt: '2026-10-25T01:30:00Z' })

    const { days } = await countsOf(property, {
      to: new Date('2026-11-05T10:00:00.000Z'),
    })

    expect(ratingsOn(days, null)).toEqual(
      expect.arrayContaining([
        ['2026-10-01', 1],
        ['2026-10-25', 2],
      ]),
    )
    expect(days).toHaveLength(2)
  })

  it('last scan ignores a retracted scan, and one before its lookback', async () => {
    const property = await seedProperty()
    const reception = await seedPortal(property, 'Reception')
    const spa = await seedPortal(property, 'Spa')
    const scans = (portalId: string, eventAt: string) =>
      readings({ property, portalId, count: 1, eventAt, metric: 'qualified_scans' })
    await scans(reception, '2026-10-10T09:00:00Z')
    const [latest] = await scans(reception, '2026-10-20T09:00:00Z')
    await correct(latest!, 'retract')
    // A rating is not a scan.
    await readings({
      property,
      portalId: reception,
      count: 1,
      eventAt: '2026-10-21T09:00:00Z',
    })
    await scans(spa, '2026-10-01T09:00:00Z')

    const { lastScanAt } = await countsOf(property, {
      scanLookback: [
        { portalId: reception, from: new Date('2026-10-01T00:00:00.000Z') },
        { portalId: spa, from: new Date('2026-10-06T00:00:00.000Z') },
      ],
    })

    expect(lastScanAt).toEqual(
      new Map([[reception, new Date('2026-10-10T09:00:00.000Z')]]),
    )
  })

  it('looks back past the basis to the code date for a portal that has gone quiet', async () => {
    const property = await seedProperty()
    const bar = await seedPortal(property, 'Bar')
    const lobby = await seedPortal(property, 'Lobby')
    const scans = (portalId: string, eventAt: string) =>
      readings({ property, portalId, count: 1, eventAt, metric: 'qualified_scans' })
    await scans(bar, '2026-08-15T09:00:00Z')
    const [withdrawn] = await scans(bar, '2026-09-01T09:00:00Z')
    await correct(withdrawn!, 'retract')
    await scans(lobby, '2026-09-10T09:00:00Z')
    await scans(lobby, '2026-10-05T09:00:00Z')

    const { lastScanAt } = await countsOf(property, {
      scanLookback: [
        { portalId: bar, from: new Date('2026-06-01T00:00:00.000Z') },
        { portalId: lobby, from: new Date('2026-06-01T00:00:00.000Z') },
      ],
    })

    expect(lastScanAt).toEqual(
      new Map([
        [bar, new Date('2026-08-15T09:00:00.000Z')],
        [lobby, new Date('2026-10-05T09:00:00.000Z')],
      ]),
    )
  })
})

describe('the month a Property goal counts', () => {
  it('a reading with no portal counts in the month and in elsewhere', async () => {
    const property = await seedProperty()
    const reception = await seedPortal(property, 'Reception')
    await readings({ property, portalId: reception, count: 4, eventAt: OCT_12 })
    await readings({ property, count: 3, eventAt: OCT_12 })

    const recommendation = await recommendationOf(property, [
      listed(reception, 'Reception'),
    ])

    expect(recommendation.monthToDate.portal_rating_count).toBe(7)
    expect(recommendation.elsewhere.portal_rating_count).toBe(3)
    expect(recommendation.portals[0]?.monthToDate.portal_rating_count).toBe(4)
  })

  it("an archived portal's readings count in the month and in elsewhere", async () => {
    const property = await seedProperty()
    const reception = await seedPortal(property, 'Reception')
    const terrace = await seedPortal(property, 'Terrace', 'archived')
    await readings({ property, portalId: reception, count: 4, eventAt: OCT_12 })
    await readings({ property, portalId: terrace, count: 2, eventAt: OCT_12 })

    const recommendation = await recommendationOf(property, [
      listed(reception, 'Reception'),
    ])

    expect(recommendation.monthToDate.portal_rating_count).toBe(6)
    expect(recommendation.elsewhere.portal_rating_count).toBe(2)
    expect(recommendation.portals.map((portal) => portal.name)).toEqual(['Reception'])
    expect(recommendation.basis?.counts.portal_rating_count).toBe(4)
  })

  it("the month's sum equals queryGoalAggregate for the Property on the same readings, a null-portal and an archived-portal reading included", async () => {
    const property = await seedProperty()
    const reception = await seedPortal(property, 'Reception')
    const terrace = await seedPortal(property, 'Terrace', 'archived')
    const corrected = await readings({
      property,
      portalId: reception,
      count: 5,
      eventAt: OCT_12,
    })
    await readings({ property, count: 3, eventAt: '2026-10-02T09:00:00Z' })
    await readings({
      property,
      portalId: terrace,
      count: 2,
      eventAt: '2026-10-20T09:00:00Z',
    })
    // September is in the basis but not in the month.
    await readings({
      property,
      portalId: reception,
      count: 4,
      eventAt: '2026-09-28T09:00:00Z',
    })
    await correct(corrected[0]!, 'retract')
    await correct(corrected[1]!, 'adjust', { delta: 2 })
    await correct(corrected[2]!, 'replace', { replacement: 0 })
    const governed = findMetricVersionById(METRIC_VERSION_IDS.portalRatingCountGoal)
    if (!governed) throw new Error('The rating count goal is not in the registry.')

    const [recommendation, page] = await Promise.all([
      recommendationOf(property, [listed(reception, 'Reception')]),
      createMetricRepository(db, () => NOW).queryGoalAggregate({
        organizationId: organizationId(ORG),
        propertyId: toPropertyId(property),
        definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
        expectedMetricKey: governed.definition.key,
        allowedSourcePolicies: governed.version.sourcePolicyAllowlist,
        subject: { kind: 'property', propertyId: toPropertyId(property) },
        periodStart: OCTOBER.periodStart,
        periodEnd: OCTOBER.periodEnd,
      }),
    ])

    // 5 - 1 + 2 - 1 = 5 at Reception, 3 with no Portal, 2 at the archived Terrace.
    expect(page.sum).toBe(10)
    expect(recommendation.monthToDate.portal_rating_count).toBe(page.sum)
    expect(recommendation.elsewhere.portal_rating_count).toBe(5)
  })
})
