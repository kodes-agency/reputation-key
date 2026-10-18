import { describe, expect, it, vi } from 'vitest'
import type {
  RecommendationDayCount,
  RecommendationPortal,
} from '../../domain/goal-recommendation-types'
import type {
  GoalProgramBundle,
  GoalProgramVersion,
} from '../ports/goal-program.repository'
import type {
  GoalRecommendationCounts,
  GoalRecommendationFactsPort,
} from '../ports/goal-recommendation-facts.port'
import { GoalProgramError, type GoalActor } from './goal-program-shared'
import type { GovernedGoalMetricResult } from './query-goal-metric'
import {
  readMonthlyPortalGoalCard,
  type MonthlyPortalGoalCardDeps,
} from './monthly-portal-goal-card'

const PROPERTY_ID = 'property-1'
const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'elena',
  role: 'PropertyManager',
}
// Seaview, on Sofia time (UTC+3 until Oct 25).
const OCT_17 = new Date('2026-10-17T09:00:00.000Z')
const OCT_23 = new Date('2026-10-23T09:00:00.000Z')
const AT_NOON = 'T09:00:00.000Z'

/** A published Portal, live and with its code made on `since` (local noon). */
function portal(
  name: string,
  since: string,
  patch: Partial<RecommendationPortal> = {},
): RecommendationPortal {
  const at = new Date(`${since}${AT_NOON}`)
  return {
    portalId: `portal-${name.toLowerCase()}`,
    name,
    publicationState: 'published',
    liveSince: at,
    liveIntervals: [{ from: at, to: null }],
    codeIssuedAt: at,
    codeReady: true,
    ...patch,
  }
}

const draft = (name: string): RecommendationPortal => ({
  portalId: `portal-${name.toLowerCase()}`,
  name,
  publicationState: 'draft',
  liveSince: null,
  liveIntervals: [],
  codeIssuedAt: null,
  codeReady: false,
})

/** `count` readings of `measure` at a Portal on each of `days`. */
const readings = (
  portalId: string | null,
  measure: RecommendationDayCount['measure'],
  days: readonly string[],
  count = 1,
): RecommendationDayCount[] =>
  days.map((localDay) => ({ portalId, measure, localDay, count }))

/** November on Sofia time. */
const NOV_1 = new Date('2026-10-31T22:00:00.000Z')
const DEC_1 = new Date('2026-11-30T22:00:00.000Z')

type GoalShape = Readonly<{
  status?: GoalProgramBundle['program']['status']
  /** When its first month begins. */
  from?: Date
  /** The month that is open, while it runs: its first and last instants. */
  open?: Readonly<{ start: Date; end: Date; target?: number }>
}>

/** A Property count goal with the Property as its one subject, 40 a month. */
function propertyGoal(
  id: string,
  metric: GoalProgramVersion['metric'],
  shape: GoalShape = {},
) {
  const from = shape.from ?? NOV_1
  const version: GoalProgramVersion = {
    id: `${id}-v1`,
    programId: id,
    organizationId: 'org-1',
    propertyId: PROPERTY_ID,
    version: 1,
    metricDefinitionId: 'definition-1',
    metricDefinitionVersionId: 'definition-version-1',
    metric,
    metricMinimumSample: 0,
    targetValue: 40,
    propertyTimezone: 'Europe/Sofia',
    effectiveFrom: from,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'elena',
    createdAt: OCT_23,
  }
  const assignmentId = `${id}-a1`
  return {
    program: {
      id,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      name: 'Monthly portal goal',
      description: null,
      status: shape.status ?? 'scheduled',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'elena',
      createdAt: OCT_23,
      updatedAt: OCT_23,
    },
    version,
    versions: [version],
    assignments: [
      {
        id: assignmentId,
        programId: id,
        programVersionId: version.id,
        organizationId: 'org-1',
        propertyId: PROPERTY_ID,
        metric,
        subject: { kind: 'property', propertyId: PROPERTY_ID },
        effectiveFrom: from,
        effectiveTo: null,
        createdBy: 'elena',
        createdAt: OCT_23,
      },
    ],
    results: shape.open
      ? [
          {
            id: `${id}-m1`,
            assignmentId,
            programId: id,
            programVersionId: version.id,
            organizationId: 'org-1',
            propertyId: PROPERTY_ID,
            periodStart: shape.open.start,
            periodEnd: shape.open.end,
            propertyTimezone: 'Europe/Sofia',
            status: 'open',
            targetValue: shape.open.target ?? null,
            evaluation: {
              state: 'updating',
              value: null,
              sampleCount: 0,
              achieved: null,
              reason: 'period_open',
            },
            sourceCompleteThrough: null,
            evaluationWatermark: null,
            closedAt: null,
            createdAt: shape.open.start,
            updatedAt: shape.open.start,
          },
        ]
      : [],
  } satisfies GoalProgramBundle
}

/** The governed read of a month so far, as the metric context answers it. */
const governed = (
  exactValue: number | null,
  state: GovernedGoalMetricResult['state'] = 'eligible',
): GovernedGoalMetricResult => ({
  definitionVersionId: 'definition-version-1',
  metricKey: null,
  state,
  exactValue,
  sampleCount: exactValue ?? 0,
  minimumSample: 0,
  sourceCompleteThrough: null,
  reason: null,
})

type AuthorizeRequest = Parameters<MonthlyPortalGoalCardDeps['policy']['authorize']>[0]

type World = Readonly<{
  now?: Date
  timezone?: string | null
  portals?: readonly RecommendationPortal[]
  counts?: Partial<GoalRecommendationCounts>
  programs?: readonly GoalProgramBundle[]
  /** What the governed read says of a running month so far. */
  figure?: GovernedGoalMetricResult
}>

/** The card's reads over an in-memory Property, recording what was asked in order. */
function fakeWorld(world: World = {}) {
  const calls: string[] = []
  const facts = {
    listPortalReadiness: vi.fn(async () => {
      calls.push('portals')
      return { portals: world.portals ?? [], truncated: false }
    }),
    readDailyCounts: vi.fn(async () => {
      calls.push('counts')
      return {
        days: world.counts?.days ?? [],
        unreadable: world.counts?.unreadable ?? [],
        lastScanAt: world.counts?.lastScanAt ?? new Map(),
      }
    }),
  } satisfies GoalRecommendationFactsPort
  const deps = {
    policy: {
      authorize: vi.fn(async (_request: AuthorizeRequest) => {
        calls.push('authorize')
      }),
    },
    reads: {
      list: vi.fn(async () => {
        calls.push('programs')
        return world.programs ?? []
      }),
    },
    metrics: {
      queryGoalMetric: vi.fn(async () => {
        calls.push('figure')
        return world.figure ?? governed(0)
      }),
    },
    recommendation: {
      subjects: {
        getTimezone: vi.fn(async () =>
          world.timezone === undefined ? 'Europe/Sofia' : world.timezone,
        ),
      },
      facts,
    },
    now: () => world.now ?? OCT_17,
  } satisfies MonthlyPortalGoalCardDeps
  return { deps, calls }
}

const read = (deps: MonthlyPortalGoalCardDeps) =>
  readMonthlyPortalGoalCard(deps, { propertyId: PROPERTY_ID }, actor)

/** Each local day from `first` for `count` days. */
function days(first: string, count: number): string[] {
  const start = new Date(`${first}T00:00:00.000Z`).getTime()
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  )
}

describe('readMonthlyPortalGoalCard', () => {
  it('no portals: the create gate', async () => {
    const { deps } = fakeWorld()

    await expect(read(deps)).resolves.toEqual({ state: 'no_portal' })
  })

  it('drafts only: names them', async () => {
    const { deps } = fakeWorld({ portals: [draft('Bar'), draft('Spa')] })

    await expect(read(deps)).resolves.toEqual({
      state: 'drafts_only',
      drafts: [
        { portalId: 'portal-bar', name: 'Bar' },
        { portalId: 'portal-spa', name: 'Spa' },
      ],
    })
  })

  it('live but none has 2 weeks: getting ready with the day it is ready', async () => {
    // Oct 17: Reception and Restaurant live since Oct 9 (8 live days), Spa since
    // Oct 15 with its code made Sep 30 and never scanned.
    const { deps } = fakeWorld({
      portals: [
        portal('Reception', '2026-10-09'),
        portal('Restaurant', '2026-10-09'),
        portal('Spa', '2026-10-15', {
          codeIssuedAt: new Date(`2026-09-30${AT_NOON}`),
        }),
      ],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-10-09', 5)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-10-10', 3)),
          ...readings('portal-reception', 'qualified_scans', days('2026-10-09', 8), 4),
          ...readings('portal-restaurant', 'qualified_scans', days('2026-10-09', 3), 5),
        ],
        lastScanAt: new Map([
          ['portal-reception', new Date(`2026-10-16${AT_NOON}`)],
          ['portal-restaurant', new Date(`2026-10-11${AT_NOON}`)],
        ]),
      },
    })

    await expect(read(deps)).resolves.toEqual({
      state: 'getting_ready',
      today: '2026-10-17',
      month: '2026-10',
      soFar: { ratings: 8, scans: 47 },
      readyOn: '2026-10-23',
      portals: [
        {
          portalId: 'portal-reception',
          name: 'Reception',
          live: true,
          codeMade: true,
          firstScan: true,
          noScanSinceCodeDays: null,
        },
        {
          portalId: 'portal-restaurant',
          name: 'Restaurant',
          live: true,
          codeMade: true,
          firstScan: true,
          noScanSinceCodeDays: null,
        },
        {
          portalId: 'portal-spa',
          name: 'Spa',
          live: true,
          codeMade: true,
          firstScan: false,
          noScanSinceCodeDays: 17,
        },
      ],
    })
  })

  it('a disabled portal takes no readiness row', async () => {
    const { deps } = fakeWorld({
      portals: [
        portal('Lobby', '2026-10-09', { publicationState: 'disabled', liveSince: null }),
        portal('Reception', '2026-10-09'),
      ],
    })

    const card = await read(deps)

    expect(card.state).toBe('getting_ready')
    expect(
      card.state === 'getting_ready' ? card.portals.map(({ name }) => name) : [],
    ).toEqual(['Reception'])
  })

  it('nothing counted names the weeks', async () => {
    // Live 20 days by Oct 23, with no rating and no scan.
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: [portal('Reception', '2026-10-03')],
    })

    await expect(read(deps)).resolves.toEqual({ state: 'nothing_counted', weeks: 2 })
  })

  it('a recommendation that cannot be read says so', async () => {
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: [portal('Reception', '2026-10-03')],
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-10-05', 14)),
        unreadable: [
          {
            portalId: 'portal-reception',
            measure: 'portal_rating_count',
            localDay: '2026-10-21',
          },
        ],
      },
    })

    await expect(read(deps)).resolves.toEqual({ state: 'recommendation_unreadable' })
  })

  it('offers next month after the 20th: about 34, 35 · 40 · 45, Spa joins Oct 29', async () => {
    // G1. Oct 23: Reception and Restaurant live since Oct 9 (14 live days to Oct
    // 22) with 11 and 5 private ratings; Spa live since Oct 15 (8 days).
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: [
        portal('Reception', '2026-10-09'),
        portal('Restaurant', '2026-10-09'),
        portal('Spa', '2026-10-15'),
      ],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-10-09', 11)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-10-12', 5)),
        ],
      },
    })

    await expect(read(deps)).resolves.toEqual({
      state: 'ready',
      offer: {
        month: '2026-11',
        current: false,
        days: 30,
        measure: 'portal_rating_count',
        choices: { usual: 35, aBitMore: 40, stretch: 45 },
        usualAbout: 34,
        basis: {
          weeks: 2,
          days: 14,
          lastDay: '2026-10-22',
          count: 16,
          portals: [
            { name: 'Reception', count: 11, liveDays: 14 },
            { name: 'Restaurant', count: 5, liveDays: 14 },
          ],
        },
        newPortals: [{ name: 'Spa', liveDays: 8, joinsOn: '2026-10-29' }],
        soFar: null,
        rest: null,
        timezone: 'Europe/Sofia',
      },
    })
  })

  it('offers the current month on the 20th with what already counts', async () => {
    // Oct 20: Reception live since Oct 6, so 14 live days to Oct 19, with one
    // private rating a day. October has 14 so far and 12 days left with today.
    const { deps } = fakeWorld({
      now: new Date('2026-10-20T09:00:00.000Z'),
      portals: [portal('Reception', '2026-10-06')],
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-10-06', 14)),
      },
    })

    await expect(read(deps)).resolves.toMatchObject({
      state: 'ready',
      offer: {
        month: '2026-10',
        current: true,
        days: 31,
        choices: { usual: 26, aBitMore: 28, stretch: 29 },
        usualAbout: 31,
        soFar: 14,
        rest: { daysLeft: 12, about: 12 },
        newPortals: [],
      },
    })
  })

  it('offers scans first when there are scans and no private ratings', async () => {
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: [portal('Reception', '2026-10-03')],
      counts: {
        days: readings('portal-reception', 'qualified_scans', days('2026-10-05', 14)),
      },
    })

    await expect(read(deps)).resolves.toMatchObject({
      state: 'scans_only',
      offer: {
        month: '2026-11',
        measure: 'qualified_scans',
        basis: { weeks: 2, count: 14 },
      },
    })
  })

  it('a scheduled goal says when it starts and what this month has so far', async () => {
    const { deps, calls } = fakeWorld({
      now: OCT_23,
      portals: [portal('Reception', '2026-10-09')],
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-10-09', 12)),
      },
      programs: [propertyGoal('monthly', 'portal_rating_count')],
    })

    await expect(read(deps)).resolves.toEqual({
      state: 'goal',
      today: '2026-10-23',
      goal: {
        programId: 'monthly',
        version: 1,
        measure: 'portal_rating_count',
        status: 'scheduled',
        target: 40,
        startsOn: '2026-11-01',
        month: null,
        currentMonthSoFar: 12,
        countingMonth: null,
      },
    })
    // Nothing is running, so no governed figure is read.
    expect(calls).not.toContain('figure')
  })

  it('a running goal reads the governed figure', async () => {
    // Nov 22: November's own target is 40, and the governed read says 23.
    const { deps } = fakeWorld({
      now: new Date('2026-11-22T10:00:00.000Z'),
      portals: [portal('Reception', '2026-10-09')],
      counts: {
        // The recommendation's own count of November differs: never shown.
        days: readings('portal-reception', 'portal_rating_count', days('2026-11-01', 30)),
      },
      programs: [
        propertyGoal('monthly', 'portal_rating_count', {
          status: 'active',
          open: { start: NOV_1, end: DEC_1 },
        }),
      ],
      figure: governed(23),
    })

    await expect(read(deps)).resolves.toEqual({
      state: 'goal',
      today: '2026-11-22',
      goal: {
        programId: 'monthly',
        version: 1,
        measure: 'portal_rating_count',
        status: 'active',
        target: 40,
        startsOn: null,
        month: { key: '2026-11', target: 40, value: 23, daysAfterToday: 8 },
        currentMonthSoFar: null,
        countingMonth: null,
      },
    })
    expect(deps.metrics.queryGoalMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { kind: 'property', propertyId: PROPERTY_ID },
        periodStart: NOV_1,
        periodEnd: DEC_1,
      }),
    )
  })

  it("a running month's own target, and a figure that cannot be read", async () => {
    const { deps } = fakeWorld({
      now: new Date('2026-11-30T10:00:00.000Z'),
      programs: [
        propertyGoal('monthly', 'qualified_scans', {
          status: 'active',
          open: { start: NOV_1, end: DEC_1, target: 45 },
        }),
      ],
      figure: governed(null, 'quarantined'),
    })

    await expect(read(deps)).resolves.toMatchObject({
      goal: {
        measure: 'qualified_scans',
        target: 40,
        month: { key: '2026-11', target: 45, value: null, daysAfterToday: 0 },
      },
    })
  })

  it('a paused or stopped goal reads no figure', async () => {
    const { deps, calls } = fakeWorld({
      now: new Date('2026-11-22T10:00:00.000Z'),
      programs: [
        propertyGoal('monthly', 'portal_rating_count', {
          status: 'paused',
          open: { start: NOV_1, end: DEC_1 },
        }),
      ],
    })

    await expect(read(deps)).resolves.toMatchObject({
      goal: {
        status: 'paused',
        startsOn: null,
        month: null,
        currentMonthSoFar: null,
        countingMonth: { key: '2026-11', target: 40 },
      },
    })
    expect(calls).not.toContain('figure')
  })

  it('a goal stopped in November names November on Dec 1, while it is read', async () => {
    const stopped = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      open: { start: NOV_1, end: DEC_1, target: 45 },
    })
    const { deps, calls } = fakeWorld({
      now: new Date('2026-12-01T10:00:00.000Z'),
      programs: [
        {
          ...stopped,
          assignments: stopped.assignments.map((assignment) => ({
            ...assignment,
            effectiveTo: DEC_1,
          })),
          results: stopped.results.map((result) => ({
            ...result,
            status: 'reconciling' as const,
          })),
        },
      ],
    })

    await expect(read(deps)).resolves.toMatchObject({
      state: 'goal',
      today: '2026-12-01',
      goal: {
        status: 'ended',
        month: null,
        countingMonth: { key: '2026-11', target: 45 },
      },
    })
    expect(calls).not.toContain('figure')
  })

  it('a goal.read-only actor is refused', async () => {
    const { deps, calls } = fakeWorld({ portals: [portal('Reception', '2026-10-09')] })
    deps.policy.authorize.mockImplementationOnce(async (request) => {
      calls.push('authorize')
      if (request.action === 'goal.create') throw new GoalProgramError('forbidden')
    })

    await expect(read(deps)).rejects.toMatchObject({ code: 'forbidden' })
    expect(deps.policy.authorize).toHaveBeenCalledWith({
      actor,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
    // Refused before anything was read.
    expect(calls).toEqual(['authorize'])
  })

  it('reads the Property calendar for so far', async () => {
    // 23:30 on Oct 31 in Sofia is Nov 1 in Tokyo: a reading at 21:30 UTC on
    // Oct 31 is October's in Sofia, and the month so far is October's.
    const lateOct31 = new Date('2026-10-31T21:30:00.000Z')
    const counts = {
      days: readings('portal-reception', 'portal_rating_count', ['2026-10-31'], 3),
    }
    const sofia = fakeWorld({
      now: lateOct31,
      portals: [portal('Reception', '2026-10-25')],
      counts,
    })
    const tokyo = fakeWorld({
      now: lateOct31,
      timezone: 'Asia/Tokyo',
      portals: [portal('Reception', '2026-10-25')],
      counts,
    })

    await expect(read(sofia.deps)).resolves.toMatchObject({
      today: '2026-10-31',
      month: '2026-10',
      soFar: { ratings: 3, scans: 0 },
    })
    await expect(read(tokyo.deps)).resolves.toMatchObject({
      today: '2026-11-01',
      month: '2026-11',
      soFar: { ratings: 0, scans: 0 },
    })
  })

  it('reads the clock once, the Programs and the recommendation together', async () => {
    const now = vi.fn(() => OCT_17)
    const { deps, calls } = fakeWorld({ portals: [portal('Reception', '2026-10-09')] })

    await read({ ...deps, now })

    expect(now).toHaveBeenCalledTimes(1)
    expect(calls[0]).toBe('authorize')
    expect(calls.slice(1, 3).sort()).toEqual(['portals', 'programs'])
    expect(deps.reads.list).toHaveBeenCalledWith(PROPERTY_ID, actor)
    expect(deps.recommendation.facts.listPortalReadiness).toHaveBeenCalledWith(
      'org-1',
      PROPERTY_ID,
      OCT_17,
    )
  })

  it('refuses a Property with no time zone', async () => {
    const { deps } = fakeWorld({ timezone: null })

    await expect(read(deps)).rejects.toMatchObject({ code: 'not_found' })
  })
})
