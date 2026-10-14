import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { sql } from 'drizzle-orm'
import {
  seedCountReadings,
  seedGoalMonth,
  type SeedGoalMonthInput,
  type SeededSubject,
} from '../testing/goal-running-month-seed'
import type { GoalMetricSubject } from '../../application/ports/metric.repository'
import { findMetricVersionById, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import { createMetricRepository } from '../repositories/metric.repository'
import { readRunningCountMonths } from './goal-running-months'

// Day 9 of August 2026 on a UTC calendar.
const NOW = new Date('2026-08-09T12:00:00.000Z')
const IN_AUGUST = '2026-08-05T10:00:00Z'
const ORG = `org-running-months-${randomUUID()}`
const OTHER_ORG = `org-running-months-other-${randomUUID()}`

let fixture: HeldTransaction | undefined
let client: HeldTransaction['client']
let db: Database

/** A Property of its own, so a case reads only what it seeded. */
async function seedProperty(organization = ORG): Promise<string> {
  const id = randomUUID()
  await client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1::uuid, $2, 'Running months Property', $1::text, 'UTC')`,
    [id, organization],
  )
  return id
}

async function seedPortal(property: string, organization = ORG): Promise<string> {
  const id = randomUUID()
  await client.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id,
                          name, slug, publication_state, created_at, updated_at)
     VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text, 'Front desk', $1::text, 'published', now(), now())`,
    [id, organization, property],
  )
  return id
}

async function seedGroup(property: string): Promise<string> {
  const id = randomUUID()
  await client.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name)
     VALUES ($1, $2, $3, $4)`,
    [id, ORG, property, `Group ${id}`],
  )
  return id
}

const monthsOf = (property: string) =>
  readRunningCountMonths(db, {
    organizationId: organizationId(ORG),
    properties: sql`results.property_id = ${property}`,
    now: NOW,
  })

/** A goal on a Property of its own with `scans` counted so far. */
async function goalWithScans(
  scans: number,
  patch: Partial<SeedGoalMonthInput> = {},
): Promise<string> {
  const property = await seedProperty()
  await seedGoalMonth(client, {
    organizationId: ORG,
    propertyId: property,
    target: 120,
    ...patch,
  })
  await seedCountReadings(client, {
    organizationId: ORG,
    propertyId: property,
    count: scans,
    eventAt: IN_AUGUST,
  })
  return property
}

beforeAll(async () => {
  // Goal results are intentionally undeletable: everything is written inside the
  // held transaction and rolled back after the suite.
  fixture = await holdTransaction()
  client = fixture.client
  db = fixture.db
  for (const id of [ORG, OTHER_ORG]) {
    await client.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Running months', $2, now())`,
      [id, `running-months-${randomUUID()}`],
    )
  }
})

// Each case works inside a savepoint it rolls back, so one case's rows never
// reach the next and a failed statement does not poison the rest of the suite.
beforeEach(async () => {
  await client.query('SAVEPOINT running_months_case')
})

afterEach(async () => {
  await client.query('ROLLBACK TO SAVEPOINT running_months_case')
})

afterAll(async () => {
  await fixture?.rollBack()
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
     SELECT id, $2, $3, 'verified correction', 'system', 'running-months-test',
       $4, $5, $6, $6
     FROM metric_readings WHERE source_event_id = $1`,
    [
      sourceEventId,
      `correction-${randomUUID()}`,
      kind,
      amount.delta ?? null,
      amount.replacement ?? null,
      IN_AUGUST,
    ],
  )
}

describe('the running months of count goals', () => {
  it('counts the readings of the running month against the target of its goal', async () => {
    const property = await goalWithScans(64)

    const [month] = await monthsOf(property)

    expect(month).toEqual({
      propertyId: property,
      programId: expect.any(String),
      metric: 'qualified_scans',
      period: {
        start: new Date('2026-08-01T00:00:00.000Z'),
        end: new Date('2026-09-01T00:00:00.000Z'),
      },
      timezone: 'UTC',
      target: 120,
      value: 64,
    })
  })

  it('counts a month with nothing yet as zero, not as missing', async () => {
    const property = await goalWithScans(0)

    expect((await monthsOf(property))[0]).toMatchObject({ value: 0 })
  })

  it("is judged against the month's own target when it has one", async () => {
    const property = await goalWithScans(50, { target: 100, monthTarget: 400 })

    expect((await monthsOf(property))[0]).toMatchObject({ target: 400, value: 50 })
  })

  it('reads the ratings of a rating count goal and not the scans beside them', async () => {
    const property = await seedProperty()
    await seedGoalMonth(client, {
      organizationId: ORG,
      propertyId: property,
      metric: 'portal_rating_count',
      target: 40,
    })
    await seedCountReadings(client, {
      organizationId: ORG,
      propertyId: property,
      metric: 'portal_rating_count',
      count: 7,
      eventAt: IN_AUGUST,
    })
    await seedCountReadings(client, {
      organizationId: ORG,
      propertyId: property,
      metric: 'qualified_scans',
      count: 30,
      eventAt: IN_AUGUST,
    })

    expect((await monthsOf(property))[0]).toMatchObject({
      metric: 'portal_rating_count',
      value: 7,
    })
  })

  it('leaves out readings from outside the month, from another Property or Organization', async () => {
    const property = await goalWithScans(5)
    const other = await seedProperty()
    const stranger = await seedProperty(OTHER_ORG)
    for (const [org, target, eventAt] of [
      [ORG, property, '2026-07-31T23:59:59Z'],
      [ORG, property, '2026-09-01T00:00:00Z'],
      [ORG, other, IN_AUGUST],
      [OTHER_ORG, stranger, IN_AUGUST],
    ] as const) {
      await seedCountReadings(client, {
        organizationId: org,
        propertyId: target,
        count: 3,
        eventAt,
      })
    }

    expect((await monthsOf(property))[0]).toMatchObject({ value: 5 })
  })

  it('counts a portal goal for that portal only', async () => {
    const property = await seedProperty()
    const lobby = await seedPortal(property)
    const bar = await seedPortal(property)
    await seedGoalMonth(client, {
      organizationId: ORG,
      propertyId: property,
      subject: { kind: 'portal', portalId: lobby },
      target: 120,
    })
    for (const [portalId, count] of [
      [lobby, 4],
      [bar, 9],
    ] as const) {
      await seedCountReadings(client, {
        organizationId: ORG,
        propertyId: property,
        portalId,
        count,
        eventAt: IN_AUGUST,
      })
    }

    expect((await monthsOf(property))[0]).toMatchObject({ value: 4 })
  })

  it('counts a portal group goal for the readings filed under that group', async () => {
    const property = await seedProperty()
    const portal = await seedPortal(property)
    const reception = await seedGroup(property)
    const lounge = await seedGroup(property)
    await seedGoalMonth(client, {
      organizationId: ORG,
      propertyId: property,
      subject: { kind: 'portal_group', groupId: reception },
      target: 120,
    })
    for (const [groupId, count] of [
      [reception, 6],
      [lounge, 2],
    ] as const) {
      await seedCountReadings(client, {
        organizationId: ORG,
        propertyId: property,
        portalId: portal,
        groupId,
        count,
        eventAt: IN_AUGUST,
      })
    }

    expect((await monthsOf(property))[0]).toMatchObject({ value: 6 })
  })

  it('gives a goal with several subjects one month for each', async () => {
    const property = await seedProperty()
    const lobby = await seedPortal(property)
    const bar = await seedPortal(property)
    const first = await seedGoalMonth(client, {
      organizationId: ORG,
      propertyId: property,
      subject: { kind: 'portal', portalId: lobby },
      target: 120,
    })
    await seedGoalMonth(client, {
      organizationId: ORG,
      propertyId: property,
      subject: { kind: 'portal', portalId: bar },
      target: 120,
      program: { programId: first.programId, versionId: first.versionId },
    })
    await seedCountReadings(client, {
      organizationId: ORG,
      propertyId: property,
      portalId: lobby,
      count: 4,
      eventAt: IN_AUGUST,
    })
    await seedCountReadings(client, {
      organizationId: ORG,
      propertyId: property,
      portalId: bar,
      count: 9,
      eventAt: IN_AUGUST,
    })

    const months = await monthsOf(property)

    expect(months.map((month) => month.value).sort()).toEqual([4, 9])
    expect(new Set(months.map((month) => month.programId)).size).toBe(1)
  })

  describe('corrections', () => {
    async function propertyWithReadings() {
      const property = await seedProperty()
      await seedGoalMonth(client, {
        organizationId: ORG,
        propertyId: property,
        target: 120,
      })
      const ids = await seedCountReadings(client, {
        organizationId: ORG,
        propertyId: property,
        count: 10,
        eventAt: IN_AUGUST,
      })
      return { property, ids }
    }

    it('drops a retracted reading', async () => {
      const { property, ids } = await propertyWithReadings()
      await correct(ids[0]!, 'retract')
      await correct(ids[1]!, 'retract')

      expect((await monthsOf(property))[0]).toMatchObject({ value: 8 })
    })

    it('counts an adjusted or replaced reading at its corrected value', async () => {
      const { property, ids } = await propertyWithReadings()
      await correct(ids[0]!, 'adjust', { delta: 4 })
      await correct(ids[1]!, 'replace', { replacement: 0 })

      // 10 readings of one: one made 5, one made 0, eight untouched.
      expect((await monthsOf(property))[0]).toMatchObject({ value: 13 })
    })
  })

  describe('a figure that cannot be trusted', () => {
    it.each([
      ['a source the measure does not allow', { sourcePolicy: 'first_party_workflow' }],
      ['an approximate reading', { dataQuality: 'approximate' }],
      ['a reading of another measure', { metricKey: 'portal.rating_count' }],
    ] as const)('is not given for %s', async (_name, patch) => {
      const property = await goalWithScans(3)
      await seedCountReadings(client, {
        organizationId: ORG,
        propertyId: property,
        count: 1,
        eventAt: IN_AUGUST,
        ...patch,
      })

      const [month] = await monthsOf(property)

      expect(month).toMatchObject({ target: 120, value: null })
    })

    it('is still given when the reading it distrusts was retracted', async () => {
      const property = await goalWithScans(3)
      const [reading] = await seedCountReadings(client, {
        organizationId: ORG,
        propertyId: property,
        count: 1,
        eventAt: IN_AUGUST,
        dataQuality: 'approximate',
      })
      await client.query(
        `INSERT INTO metric_corrections (
           reading_id, source_event_id, kind, reason, actor_type, actor_id,
           event_at, recorded_at
         )
         SELECT id, $2, 'retract', 'verified correction', 'system', 'running-months-test',
           $3, $3
         FROM metric_readings WHERE source_event_id = $1`,
        [reading, `correction-${randomUUID()}`, IN_AUGUST],
      )

      expect((await monthsOf(property))[0]).toMatchObject({ value: 3 })
    })
  })

  describe('months that are not running', () => {
    it.each([
      ['a paused goal', { programStatus: 'paused' }],
      ['an ended goal', { programStatus: 'ended' }],
      ['a scheduled goal', { programStatus: 'scheduled' }],
      ['a month that is reconciling', { monthStatus: 'reconciling' }],
      [
        'a month that has ended',
        { period: { start: '2026-07-01T00:00:00Z', end: '2026-08-01T00:00:00Z' } },
      ],
      [
        'a month that has not begun',
        { period: { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' } },
      ],
      ['a rating average', { metric: 'portal_rating_average', target: 4.5 }],
    ] as const)('are not read for %s', async (_name, patch) => {
      const property = await goalWithScans(3, patch)

      expect(await monthsOf(property)).toEqual([])
    })
  })

  describe('a goal the goal page would not read', () => {
    it('is not read for a Portal that was deleted', async () => {
      const property = await seedProperty()
      const lobby = await seedPortal(property)
      await seedGoalMonth(client, {
        organizationId: ORG,
        propertyId: property,
        subject: { kind: 'portal', portalId: lobby },
        target: 120,
      })
      expect(await monthsOf(property)).toHaveLength(1)

      await client.query('UPDATE portals SET deleted_at = now() WHERE id = $1', [lobby])

      expect(await monthsOf(property)).toEqual([])
    })

    it('is not read for a Portal Group that was deleted', async () => {
      const property = await seedProperty()
      const reception = await seedGroup(property)
      await seedGoalMonth(client, {
        organizationId: ORG,
        propertyId: property,
        subject: { kind: 'portal_group', groupId: reception },
        target: 120,
      })
      expect(await monthsOf(property)).toHaveLength(1)

      await client.query('UPDATE portal_groups SET deleted_at = now() WHERE id = $1', [
        reception,
      ])

      expect(await monthsOf(property)).toEqual([])
    })

    it('keeps the other subjects of a goal when one of its Portals was deleted', async () => {
      const property = await seedProperty()
      const lobby = await seedPortal(property)
      const bar = await seedPortal(property)
      const first = await seedGoalMonth(client, {
        organizationId: ORG,
        propertyId: property,
        subject: { kind: 'portal', portalId: lobby },
        target: 120,
      })
      await seedGoalMonth(client, {
        organizationId: ORG,
        propertyId: property,
        subject: { kind: 'portal', portalId: bar },
        target: 120,
        program: { programId: first.programId, versionId: first.versionId },
      })
      await client.query('UPDATE portals SET deleted_at = now() WHERE id = $1', [lobby])

      expect(await monthsOf(property)).toHaveLength(1)
    })

    it('is not read for a month the governed version was not yet in effect for', async () => {
      const property = await seedProperty()
      await seedGoalMonth(client, {
        organizationId: ORG,
        propertyId: property,
        target: 120,
        period: { start: '2026-07-01T00:00:00Z', end: '2026-08-01T00:00:00Z' },
      })
      const july = new Date('2026-07-20T12:00:00.000Z')

      const months = await readRunningCountMonths(db, {
        organizationId: organizationId(ORG),
        properties: sql`results.property_id = ${property}`,
        now: july,
      })

      expect(months).toEqual([])
    })
  })

  describe('the figure the goal page reads', () => {
    const AUGUST = {
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    }

    /** The governed aggregate of the goal's own page, for the same month. */
    async function pageAggregate(property: string, subject: GoalMetricSubject) {
      const governed = findMetricVersionById(METRIC_VERSION_IDS.qualifiedScanGoal)
      if (!governed) throw new Error('The qualified scan goal is not in the registry.')
      return createMetricRepository(db, () => NOW).queryGoalAggregate({
        organizationId: organizationId(ORG),
        propertyId: toPropertyId(property),
        definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
        expectedMetricKey: governed.definition.key,
        allowedSourcePolicies: governed.version.sourcePolicyAllowlist,
        subject,
        ...AUGUST,
      })
    }

    /** A Property with two Portals and two groups, readings across them, and corrections. */
    async function busyProperty() {
      const property = await seedProperty()
      const lobby = await seedPortal(property)
      const bar = await seedPortal(property)
      const reception = await seedGroup(property)
      const lounge = await seedGroup(property)
      const readings = async (
        count: number,
        where: { portalId?: string; groupId?: string },
        eventAt = IN_AUGUST,
      ) =>
        seedCountReadings(client, {
          organizationId: ORG,
          propertyId: property,
          count,
          eventAt,
          ...where,
        })
      const lobbyAtReception = await readings(5, { portalId: lobby, groupId: reception })
      const lobbyAtLounge = await readings(3, { portalId: lobby, groupId: lounge })
      const barAtReception = await readings(4, { portalId: bar, groupId: reception })
      await readings(2, { portalId: bar })
      // Outside the month, on both sides of it.
      await readings(2, { portalId: lobby, groupId: reception }, '2026-07-31T23:59:59Z')
      await readings(2, { portalId: lobby, groupId: reception }, '2026-09-01T00:00:00Z')
      await correct(lobbyAtReception[0]!, 'retract')
      await correct(lobbyAtReception[1]!, 'adjust', { delta: 4 })
      await correct(lobbyAtLounge[0]!, 'replace', { replacement: 0 })
      await correct(barAtReception[0]!, 'adjust', { delta: -1 })
      return { property, lobby, bar, reception, lounge }
    }

    type Ids = Awaited<ReturnType<typeof busyProperty>>
    type Subject = Readonly<{ page: GoalMetricSubject; seeded: SeededSubject }>
    const SUBJECTS: ReadonlyArray<readonly [string, (ids: Ids) => Subject]> = [
      [
        'a Property',
        (ids) => ({
          page: { kind: 'property', propertyId: toPropertyId(ids.property) },
          seeded: { kind: 'property' },
        }),
      ],
      [
        'a Portal',
        (ids) => ({
          page: { kind: 'portal', portalId: portalId(ids.lobby) },
          seeded: { kind: 'portal', portalId: ids.lobby },
        }),
      ],
      [
        'a Portal Group',
        (ids) => ({
          page: { kind: 'portal_group', portalGroupId: portalGroupId(ids.reception) },
          seeded: { kind: 'portal_group', groupId: ids.reception },
        }),
      ],
    ]

    it.each(SUBJECTS)(
      'counts what the goal page counts for %s',
      async (_name, subjectOf) => {
        const ids = await busyProperty()
        const subject = subjectOf(ids)
        await seedGoalMonth(client, {
          organizationId: ORG,
          propertyId: ids.property,
          subject: subject.seeded,
          target: 120,
        })

        const [month] = await monthsOf(ids.property)
        const aggregate = await pageAggregate(ids.property, subject.page)

        expect(aggregate.sum).toBeGreaterThan(0)
        expect(month?.value).toBe(aggregate.sum)
      },
    )

    it.each([
      ['a source the measure does not allow', { sourcePolicy: 'first_party_workflow' }],
      ['an approximate reading', { dataQuality: 'approximate' }],
      ['a reading of another measure', { metricKey: 'portal.rating_count' }],
    ] as const)('gives no figure where the goal page finds %s', async (_name, patch) => {
      const property = await goalWithScans(3)
      await seedCountReadings(client, {
        organizationId: ORG,
        propertyId: property,
        count: 1,
        eventAt: IN_AUGUST,
        ...patch,
      })

      const [month] = await monthsOf(property)
      const aggregate = await pageAggregate(property, {
        kind: 'property',
        propertyId: toPropertyId(property),
      })

      expect(month?.value).toBeNull()
      expect(
        aggregate.invalidSourceCount +
          aggregate.approximateCount +
          aggregate.invalidDefinitionCount,
      ).toBeGreaterThan(0)
    })
  })

  it('reads only the Properties in scope, and only its Organization', async () => {
    const inScope = await goalWithScans(3)
    const outOfScope = await goalWithScans(3)
    const stranger = await seedProperty(OTHER_ORG)
    await seedGoalMonth(client, {
      organizationId: OTHER_ORG,
      propertyId: stranger,
      target: 120,
    })

    const months = await readRunningCountMonths(db, {
      organizationId: organizationId(ORG),
      properties: sql`results.property_id IN (${inScope}::uuid, ${stranger}::uuid)`,
      now: NOW,
    })

    expect(months.map((month) => month.propertyId)).toEqual([inScope])
    expect(months.map((month) => month.propertyId)).not.toContain(outOfScope)
  })
})
