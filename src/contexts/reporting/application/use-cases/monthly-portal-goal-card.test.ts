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

/** A Property count goal with the Property as its one subject. */
function propertyGoal(id: string, metric: GoalProgramVersion['metric']) {
  const from = new Date('2026-10-31T22:00:00.000Z')
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
  return {
    program: {
      id,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      name: 'Monthly portal goal',
      description: null,
      status: 'scheduled',
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
        id: `${id}-a1`,
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
    results: [],
  } satisfies GoalProgramBundle
}

type AuthorizeRequest = Parameters<MonthlyPortalGoalCardDeps['policy']['authorize']>[0]

type World = Readonly<{
  now?: Date
  timezone?: string | null
  portals?: readonly RecommendationPortal[]
  counts?: Partial<GoalRecommendationCounts>
  programs?: readonly GoalProgramBundle[]
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

  it('a number ready is drawn with the first weeks until the offer arrives', async () => {
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: [portal('Reception', '2026-10-03')],
      counts: {
        days: readings('portal-reception', 'qualified_scans', days('2026-10-05', 14)),
      },
    })

    await expect(read(deps)).resolves.toMatchObject({
      state: 'scans_only',
      today: '2026-10-23',
      month: '2026-10',
      soFar: { ratings: 0, scans: 14 },
    })
  })

  it('with a monthly goal, names it by Program', async () => {
    const { deps } = fakeWorld({
      programs: [propertyGoal('monthly', 'portal_rating_count')],
    })

    await expect(read(deps)).resolves.toEqual({
      state: 'goal',
      goal: { programId: 'monthly' },
    })
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
