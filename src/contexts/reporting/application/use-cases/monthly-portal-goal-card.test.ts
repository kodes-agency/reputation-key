import { describe, expect, it, vi } from 'vitest'
import type {
  RecommendationDayCount,
  RecommendationPortal,
} from '../../domain/goal-recommendation-types'
import type { GoalMetricEvaluation } from '../../domain/goal-program'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
} from '../ports/goal-program.repository'
import type {
  GoalRecommendationCounts,
  GoalRecommendationFactsPort,
} from '../ports/goal-recommendation-facts.port'
import { GoalProgramError, type GoalActor } from './goal-program-shared'
import type { GovernedGoalMetricResult } from './query-goal-metric'
import type {
  PortalGoalCardView,
  PortalGoalOfCard,
} from '../dto/monthly-portal-goal.types'
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
const NOV_22 = new Date('2026-11-22T10:00:00.000Z')

/** One month of a goal: its first and last instants, and how far its result has got. */
type MonthShape = Readonly<{
  start: Date
  end: Date
  target?: number
  status?: GoalMonthlyResult['status']
  evaluation?: Partial<GoalMetricEvaluation>
}>

type GoalShape = Readonly<{
  status?: GoalProgramBundle['program']['status']
  /** When its first month begins. */
  from?: Date
  /** Where its window ends: an ended goal's runs to the end of the month it was stopped in. */
  until?: Date
  /** When it was ended, as migration 0062 records it. */
  endedAt?: Date
  /** The month that is open, while it runs: its first and last instants. */
  open?: Readonly<{ start: Date; end: Date; target?: number }>
  /** Its other months, earlier ones first. */
  months?: readonly MonthShape[]
}>

/** A month's result row: open and updating unless the shape says how far it has got. */
function monthResult(
  programId: string,
  programVersionId: string,
  assignmentId: string,
  month: MonthShape,
  index: number,
): GoalMonthlyResult {
  return {
    id: `${programId}-m${index + 1}`,
    assignmentId,
    programId,
    programVersionId,
    organizationId: 'org-1',
    propertyId: PROPERTY_ID,
    periodStart: month.start,
    periodEnd: month.end,
    propertyTimezone: 'Europe/Sofia',
    status: month.status ?? 'open',
    targetValue: month.target ?? null,
    evaluation: {
      state: 'updating',
      value: null,
      sampleCount: 0,
      achieved: null,
      reason: 'period_open',
      ...month.evaluation,
    },
    sourceCompleteThrough: null,
    evaluationWatermark: null,
    closedAt: month.status === 'closed' ? month.end : null,
    createdAt: month.start,
    updatedAt: month.start,
  }
}

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
    effectiveTo: shape.until ?? null,
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
      updatedAt: shape.endedAt ?? OCT_23,
      ...(shape.endedAt ? { endedAt: shape.endedAt } : {}),
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
        effectiveTo: shape.until ?? null,
        createdBy: 'elena',
        createdAt: OCT_23,
      },
    ],
    results: [...(shape.open ? [shape.open] : []), ...(shape.months ?? [])].map(
      (month, index) => monthResult(id, version.id, assignmentId, month, index),
    ),
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

/** Running in November, 40 a month unless November's own number says otherwise. */
const runningGoal = (november: Readonly<{ target?: number }> = {}) =>
  propertyGoal('monthly', 'portal_rating_count', {
    status: 'active',
    open: { start: NOV_1, end: DEC_1, ...november },
  })

/** Seaview's three Portals, live since October. */
const SEAVIEW_PORTALS = [
  portal('Reception', '2026-10-09'),
  portal('Restaurant', '2026-10-09'),
  portal('Spa', '2026-10-15'),
]

type AuthorizeRequest = Parameters<MonthlyPortalGoalCardDeps['policy']['authorize']>[0]

type World = Readonly<{
  now?: Date
  timezone?: string | null
  portals?: readonly RecommendationPortal[]
  counts?: Partial<GoalRecommendationCounts>
  programs?: readonly GoalProgramBundle[]
  /** What the governed read says of a running month so far. */
  figure?: GovernedGoalMetricResult
  /** What it says of each month, by the month's first instant (ISO): it wins over `figure`. */
  figures?: Readonly<Record<string, GovernedGoalMetricResult>>
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
      queryGoalMetric: vi.fn(async (query: Readonly<{ periodStart: Date }>) => {
        calls.push('figure')
        return (
          world.figures?.[query.periodStart.toISOString()] ?? world.figure ?? governed(0)
        )
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

/** The card as it is drawn; what its set sheet works from is asserted on its own. */
async function drawn(deps: MonthlyPortalGoalCardDeps) {
  const card = await read(deps)
  if (!('sheet' in card)) return card
  const { sheet: _sheet, ...rest } = card
  return rest
}

/** What the card's set sheet works from; none for an arm without a door to it. */
async function sheetOf(deps: MonthlyPortalGoalCardDeps) {
  const card = await read(deps)
  return 'sheet' in card ? card.sheet : null
}

/** The goal on a card that has one. */
function goalOf(card: PortalGoalCardView): PortalGoalOfCard {
  if (card.state !== 'goal') throw new Error(`expected a goal, got ${card.state}`)
  return card.goal
}

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

    await expect(drawn(deps)).resolves.toEqual({
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

    await expect(drawn(deps)).resolves.toEqual({ state: 'nothing_counted', weeks: 2 })
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

    await expect(drawn(deps)).resolves.toEqual({ state: 'recommendation_unreadable' })
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

    await expect(drawn(deps)).resolves.toEqual({
      state: 'ready',
      offer: {
        month: '2026-11',
        current: false,
        days: 30,
        measure: 'portal_rating_count',
        choices: { usual: 35, aBitMore: 40, stretch: 45 },
        usualAbout: 34,
        // 16 in 14 live days, for 30 days: 240 / 7, about 34.29.
        usualExact: { num: '240', den: '7' },
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

  it('the sheet opens on the offered month, with each measure offered for this month and the next', async () => {
    // G1 and G2 on Oct 23: 16 private ratings in October so far, 9 days left
    // with today; the whole of November is 240 / 7. October's own numbers are
    // measured against what its "your usual" stands for: the 16 so far and 72 / 7
    // for the 9 days left, 184 / 7 (not its 31 days' 248 / 7).
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

    const card = await read(deps)
    const sheet = await sheetOf(deps)

    expect(sheet).toMatchObject({
      month: '2026-11',
      readyOn: null,
      ownNumber: {
        current: { key: '2026-10', soFar: { ratings: 16, scans: 0 } },
        next: { key: '2026-11' },
      },
      offers: { qualified_scans: { current: null, next: null } },
    })
    // The month the card offers is the sheet's November, word for word.
    expect(card.state === 'ready' ? card.offer : null).toEqual(
      sheet?.offers.portal_rating_count.next,
    )
    expect(sheet?.offers.portal_rating_count.current).toEqual({
      month: '2026-10',
      current: true,
      days: 31,
      measure: 'portal_rating_count',
      // 16 so far, and 72 / 7 at the usual for the 9 days left.
      choices: { usual: 27, aBitMore: 28, stretch: 29 },
      usualAbout: 35,
      usualExact: { num: '184', den: '7' },
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
      soFar: 16,
      rest: { daysLeft: 9, about: 10 },
      timezone: 'Europe/Sofia',
    })
  })

  it('an own number in the first weeks: both months, this month so far, the day the number is ready', async () => {
    const { deps } = fakeWorld({
      portals: [portal('Reception', '2026-10-09'), portal('Restaurant', '2026-10-09')],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-10-09', 5)),
          ...readings('portal-restaurant', 'qualified_scans', days('2026-10-09', 3), 5),
        ],
      },
    })

    await expect(sheetOf(deps)).resolves.toEqual({
      month: '2026-10',
      ownNumber: {
        current: { key: '2026-10', soFar: { ratings: 5, scans: 15 } },
        next: { key: '2026-11' },
      },
      offers: {
        portal_rating_count: { current: null, next: null },
        qualified_scans: { current: null, next: null },
      },
      readyOn: '2026-10-23',
    })
  })

  it('nothing counted: the sheet offers no number for either measure', async () => {
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: [portal('Reception', '2026-10-03')],
    })

    await expect(sheetOf(deps)).resolves.toMatchObject({
      month: '2026-11',
      readyOn: null,
      offers: {
        portal_rating_count: { current: null, next: null },
        qualified_scans: { current: null, next: null },
      },
    })
  })

  it('private ratings that cannot be read keep the scans offered in the sheet', async () => {
    // G13: one rating the governed read would quarantine; 14 days of scans.
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: [portal('Reception', '2026-10-03')],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-10-05', 14)),
          ...readings('portal-reception', 'qualified_scans', days('2026-10-05', 14), 2),
        ],
        unreadable: [
          {
            portalId: 'portal-reception',
            measure: 'portal_rating_count',
            localDay: '2026-10-21',
          },
        ],
      },
    })

    const card = await read(deps)
    const sheet = await sheetOf(deps)

    expect(card.state).toBe('recommendation_unreadable')
    expect(sheet?.offers.portal_rating_count).toEqual({ current: null, next: null })
    expect(sheet?.offers.qualified_scans.next).toMatchObject({
      month: '2026-11',
      measure: 'qualified_scans',
      basis: { count: 28 },
    })
    expect(sheet?.offers.qualified_scans.current).toMatchObject({
      month: '2026-10',
      current: true,
      measure: 'qualified_scans',
    })
  })

  it('a goal has no sheet to set another', async () => {
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: [portal('Reception', '2026-10-09')],
      programs: [propertyGoal('monthly', 'portal_rating_count')],
    })

    await expect(sheetOf(deps)).resolves.toBeNull()
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
        rows: null,
        stopped: null,
        lastMonth: null,
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
      now: NOV_22,
      portals: [portal('Reception', '2026-10-09')],
      counts: {
        // The recommendation's own count of November differs: never shown.
        days: readings('portal-reception', 'portal_rating_count', days('2026-11-01', 30)),
      },
      programs: [runningGoal()],
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
        // G10: 23 of 40 on Nov 22 is behind (69,000 < 79,200), 9 days left with today.
        month: {
          key: '2026-11',
          target: 40,
          value: 23,
          elapsedDays: 22,
          totalDays: 30,
          daysAfterToday: 8,
          belowPace: true,
          quietDays: false,
        },
        // Reception's 30 is not the governed 23: no rows.
        rows: null,
        stopped: null,
        lastMonth: null,
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
        month: {
          key: '2026-11',
          target: 45,
          value: null,
          daysAfterToday: 0,
          // No figure, no judgement.
          belowPace: null,
        },
        rows: null,
      },
    })
  })

  it('rows plus Other portals equal the headline', async () => {
    // Nov 22: Reception 13, Restaurant 6 and Spa 2, and 2 readings with no
    // Portal: 23, as the governed read says.
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-11-01', 13)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-11-02', 6)),
          ...readings('portal-spa', 'portal_rating_count', days('2026-11-10', 2)),
          ...readings(null, 'portal_rating_count', ['2026-11-05'], 2),
        ],
      },
      programs: [runningGoal()],
      figure: governed(23),
    })

    const card = await read(deps)

    expect(goalOf(card).rows).toEqual({
      kind: 'rows',
      // Name order, never by count.
      portals: [
        { portalId: 'portal-reception', name: 'Reception', count: 13 },
        { portalId: 'portal-restaurant', name: 'Restaurant', count: 6 },
        { portalId: 'portal-spa', name: 'Spa', count: 2 },
      ],
      elsewhere: 2,
    })
  })

  it('no rows when they do not add up', async () => {
    // A reading the governed read has and the set read not yet: 24 against 23.
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-11-01', 13)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-11-02', 10)),
        ],
      },
      programs: [runningGoal()],
      figure: governed(24),
    })

    const goal = goalOf(await read(deps))

    expect(goal.month?.value).toBe(24)
    expect(goal.rows).toBeNull()
  })

  it('no rows when this month cannot be read from the readings', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-11-01', 23)),
        unreadable: [
          {
            portalId: 'portal-reception',
            measure: 'portal_rating_count',
            localDay: '2026-11-04',
          },
        ],
      },
      programs: [runningGoal()],
      figure: governed(23),
    })

    expect(goalOf(await read(deps)).rows).toBeNull()
  })

  it("a disabled portal's readings are in Other portals", async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: [
        portal('Lobby', '2026-10-09', { publicationState: 'disabled', liveSince: null }),
        portal('Reception', '2026-10-09'),
        portal('Restaurant', '2026-10-09'),
      ],
      counts: {
        days: [
          ...readings('portal-lobby', 'portal_rating_count', days('2026-11-01', 3)),
          ...readings('portal-reception', 'portal_rating_count', days('2026-11-01', 10)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-11-01', 5)),
        ],
      },
      programs: [runningGoal()],
      figure: governed(18),
    })

    expect(goalOf(await read(deps)).rows).toEqual({
      kind: 'rows',
      portals: [
        { portalId: 'portal-reception', name: 'Reception', count: 10 },
        { portalId: 'portal-restaurant', name: 'Restaurant', count: 5 },
      ],
      elsewhere: 3,
    })
  })

  it('one portal that brought in all of it is named; five or more are counted', async () => {
    const one = fakeWorld({
      now: NOV_22,
      portals: [portal('Reception', '2026-10-09')],
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-11-01', 7)),
      },
      programs: [runningGoal()],
      figure: governed(7),
    })
    const oneAndOthers = fakeWorld({
      now: NOV_22,
      portals: [portal('Reception', '2026-10-09')],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-11-01', 7)),
          ...readings(null, 'portal_rating_count', ['2026-11-03']),
        ],
      },
      programs: [runningGoal()],
      figure: governed(8),
    })
    const names = ['Bar', 'Lobby', 'Reception', 'Restaurant', 'Spa']
    const five = fakeWorld({
      now: NOV_22,
      portals: names.map((name) => portal(name, '2026-10-09')),
      counts: {
        days: names.flatMap((name) =>
          readings(`portal-${name.toLowerCase()}`, 'portal_rating_count', ['2026-11-04']),
        ),
      },
      programs: [runningGoal()],
      figure: governed(5),
    })

    expect(goalOf(await read(one.deps)).rows).toEqual({ kind: 'one', name: 'Reception' })
    // "All from Reception" would not be true: it is a row, with the rest.
    expect(goalOf(await read(oneAndOthers.deps)).rows).toEqual({
      kind: 'rows',
      portals: [{ portalId: 'portal-reception', name: 'Reception', count: 7 }],
      elsewhere: 1,
    })
    expect(goalOf(await read(five.deps)).rows).toEqual({ kind: 'many', count: 5 })
  })

  it('below pace only when goalPace says behind', async () => {
    const at = (value: number) =>
      fakeWorld({ now: NOV_22, programs: [runningGoal()], figure: governed(value) })

    // G10: 23 of 40 on Nov 22 expects 29.3, and 90% of it is 26.4.
    expect(goalOf(await read(at(23).deps)).month).toMatchObject({
      belowPace: true,
      quietDays: false,
    })
    expect(goalOf(await read(at(27).deps)).month).toMatchObject({ belowPace: false })
  })

  it('not judged under 5 expected', async () => {
    // G11: 10 a month in a 30-day month is judged from Nov 15; the first three
    // days of a month are never judged, and draw no tick.
    const on = (now: Date, value: number) =>
      fakeWorld({
        now,
        programs: [runningGoal({ target: 10 })],
        figure: governed(value),
      })

    expect(
      goalOf(await read(on(new Date('2026-11-14T10:00:00.000Z'), 0).deps)).month,
    ).toMatchObject({ elapsedDays: 14, belowPace: null, quietDays: false })
    expect(
      goalOf(await read(on(new Date('2026-11-15T10:00:00.000Z'), 4).deps)).month,
    ).toMatchObject({ elapsedDays: 15, belowPace: true })
    expect(
      goalOf(await read(on(new Date('2026-11-15T10:00:00.000Z'), 5).deps)).month,
    ).toMatchObject({ belowPace: false })
    expect(
      goalOf(await read(on(new Date('2026-11-03T10:00:00.000Z'), 0).deps)).month,
    ).toMatchObject({ elapsedDays: 3, belowPace: null, quietDays: true })
  })

  it('a paused goal reads no figure', async () => {
    const { deps, calls } = fakeWorld({
      now: NOV_22,
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
        rows: null,
        stopped: null,
        currentMonthSoFar: null,
        countingMonth: { key: '2026-11', target: 40 },
      },
    })
    expect(calls).not.toContain('figure')
  })

  it("a goal stopped on Nov 12 still reads November's figure until it closes", async () => {
    // Ending closes its window at the end of the month it was stopped in.
    const stopped = (endedAt?: Date) =>
      propertyGoal('monthly', 'portal_rating_count', {
        status: 'ended',
        until: DEC_1,
        open: { start: NOV_1, end: DEC_1 },
        ...(endedAt ? { endedAt } : {}),
      })
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: [portal('Reception', '2026-10-09')],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-11-01', 22)),
          ...readings('portal-reception', 'portal_rating_count', ['2026-11-22']),
        ],
      },
      programs: [stopped(new Date('2026-11-12T08:00:00.000Z'))],
      figure: governed(23),
    })

    await expect(read(deps)).resolves.toMatchObject({
      state: 'goal',
      goal: {
        status: 'ended',
        month: { key: '2026-11', target: 40, value: 23, daysAfterToday: 8 },
        rows: { kind: 'one', name: 'Reception' },
        stopped: { on: '2026-11-12', monthEnd: '2026-11-30' },
        countingMonth: null,
      },
    })
    expect(deps.metrics.queryGoalMetric).toHaveBeenCalledWith(
      expect.objectContaining({ periodStart: NOV_1, periodEnd: DEC_1 }),
    )

    // Ended before migration 0062 recorded the day: stopped, with no day.
    const undated = fakeWorld({
      now: NOV_22,
      programs: [stopped()],
      figure: governed(23),
    })
    expect(goalOf(await read(undated.deps)).stopped).toEqual({
      on: null,
      monthEnd: '2026-11-30',
    })
  })

  it('a goal stopped in November names November on Dec 1, while it is read', async () => {
    const { deps, calls } = fakeWorld({
      now: new Date('2026-12-01T10:00:00.000Z'),
      programs: [
        propertyGoal('monthly', 'portal_rating_count', {
          status: 'ended',
          until: DEC_1,
          endedAt: new Date('2026-11-12T08:00:00.000Z'),
          months: [{ start: NOV_1, end: DEC_1, target: 45, status: 'reconciling' }],
        }),
      ],
      figures: { [NOV_1.toISOString()]: governed(36) },
    })

    await expect(read(deps)).resolves.toMatchObject({
      state: 'goal',
      today: '2026-12-01',
      goal: {
        status: 'ended',
        month: null,
        rows: null,
        // November no longer counts on: its stop is behind it.
        stopped: null,
        countingMonth: { key: '2026-11', target: 45 },
        lastMonth: {
          key: '2026-11',
          value: 36,
          target: 45,
          outcome: 'updating',
          finalOn: '2026-12-02',
        },
      },
    })
    // November's figure so far, from the governed read: nothing of December.
    expect(calls.filter((call) => call === 'figure')).toHaveLength(1)
  })

  it('last month updating, then met or not met, through day 7', async () => {
    // A goal running since November, read in December: November's result is
    // read on Dec 1, closed from Dec 2, and shown through Dec 7.
    const DEC_LAST = new Date('2026-12-31T22:00:00.000Z')
    const withNovember = (november: MonthShape) =>
      propertyGoal('monthly', 'portal_rating_count', {
        status: 'active',
        months: [november, { start: DEC_1, end: DEC_LAST, target: 45 }],
      })
    const lastMonthOn = async (now: string, november: MonthShape) => {
      const { deps } = fakeWorld({
        now: new Date(now),
        programs: [withNovember(november)],
        figures: {
          [NOV_1.toISOString()]: governed(38),
          [DEC_1.toISOString()]: governed(2),
        },
      })
      return goalOf(await read(deps))
    }
    const NOVEMBER = { start: NOV_1, end: DEC_1 } as const

    const updating = await lastMonthOn('2026-12-01T10:00:00.000Z', {
      ...NOVEMBER,
      status: 'reconciling',
    })
    expect(updating.month).toMatchObject({ key: '2026-12', target: 45, value: 2 })
    expect(updating.lastMonth).toEqual({
      key: '2026-11',
      value: 38,
      target: 40,
      outcome: 'updating',
      finalOn: '2026-12-02',
    })

    const met = await lastMonthOn('2026-12-03T10:00:00.000Z', {
      ...NOVEMBER,
      status: 'closed',
      evaluation: { state: 'eligible', value: 41, sampleCount: 41, achieved: true },
    })
    expect(met.lastMonth).toMatchObject({ value: 41, target: 40, outcome: 'met' })

    const notMet = await lastMonthOn('2026-12-07T20:00:00.000Z', {
      ...NOVEMBER,
      status: 'closed',
      evaluation: { state: 'eligible', value: 36, sampleCount: 36, achieved: false },
    })
    expect(notMet.lastMonth).toMatchObject({ value: 36, outcome: 'not_met' })

    const unavailable = await lastMonthOn('2026-12-04T10:00:00.000Z', {
      ...NOVEMBER,
      status: 'closed',
      evaluation: { state: 'unavailable', value: null, achieved: null },
    })
    expect(unavailable.lastMonth).toMatchObject({ value: null, outcome: 'unavailable' })

    // Dec 8: November's result has had its week.
    const after = await lastMonthOn('2026-12-08T10:00:00.000Z', {
      ...NOVEMBER,
      status: 'closed',
      evaluation: { state: 'eligible', value: 41, sampleCount: 41, achieved: true },
    })
    expect(after.lastMonth).toBeNull()
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
