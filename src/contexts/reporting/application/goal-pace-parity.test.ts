// The three places that call a portal goal behind pace must say the same thing.
//
// The Goals list judges one subject's month through `createGoalListProgressReader`
// (`belowPace`). The Overview chip and the Properties list both count
// `goalsBehindPaceByProperty` over the running months the set-based read
// supplies. All three rest on `goalPace`, and the small months are where its
// guard (no pace while fewer than 5 are expected by today) decides, so this
// walks a grid of small and ordinary months through each of them.

import { beforeAll, describe, expect, it } from 'vitest'
import { calendarPeriodRange } from '#/shared/domain/period-range'
import type { GoalMetric, GoalSubject } from '../domain/goal-program'
import { goalPace, goalsBehindPaceByProperty } from '../domain/goal-pace'
import { METRIC_VERSION_IDS } from '../domain/metric-registry'
import type {
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from './ports/goal-program.repository'
import { createGoalListProgressReader } from './use-cases/goal-list-progress'
import type { GoalProgressDeps } from './use-cases/goal-progress'
import type { GoalActor } from './use-cases/goal-programs'
import type { GovernedGoalMetricResult } from './use-cases/query-goal-metric'

type CountMetric = Exclude<GoalMetric, 'portal_rating_average'>

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}

const PROPERTY_ID = 'property-1'
const PROGRAM_ID = 'program-1'
const ZONE = 'Europe/Sofia'
// 1 Aug 2026 in Sofia: the goal has counted every month since.
const GOAL_START = new Date('2026-07-31T21:00:00.000Z')

const VERSION_IDS: Record<CountMetric, string> = {
  qualified_scans: METRIC_VERSION_IDS.qualifiedScanGoal,
  portal_rating_count: METRIC_VERSION_IDS.portalRatingCountGoal,
}

const TARGETS = [4, 8, 10, 20, 40, 120] as const
const DAYS = [1, 4, 14, 15, 20, 30] as const
const VALUES = [0, 1, 4, 5, 23] as const
const METRICS: readonly CountMetric[] = ['qualified_scans', 'portal_rating_count']
/** A 30-day and a 31-day month, at 08:00 UTC: mid-morning in Sofia, either side of its clock change. */
const MONTHS = [
  { name: 'November', at: (day: number) => new Date(Date.UTC(2026, 10, day, 8)) },
  { name: 'October', at: (day: number) => new Date(Date.UTC(2026, 9, day, 8)) },
] as const

const property: GoalSubject = { kind: 'property', propertyId: PROPERTY_ID }

/** An active Property goal on one count measure, its month on the version's target. */
function goalOf(metric: CountMetric, target: number): GoalProgramBundle {
  const version: GoalProgramVersion = {
    id: `${PROGRAM_ID}-v1`,
    programId: PROGRAM_ID,
    organizationId: actor.organizationId,
    propertyId: PROPERTY_ID,
    version: 1,
    metricDefinitionId: 'definition-1',
    metricDefinitionVersionId: VERSION_IDS[metric],
    metric,
    metricMinimumSample: 0,
    targetValue: target,
    propertyTimezone: ZONE,
    effectiveFrom: GOAL_START,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'elena',
    createdAt: GOAL_START,
  }
  const assignment: GoalSubjectAssignment = {
    id: `${PROGRAM_ID}-a1`,
    programId: PROGRAM_ID,
    programVersionId: version.id,
    organizationId: actor.organizationId,
    propertyId: PROPERTY_ID,
    metric,
    subject: property,
    effectiveFrom: GOAL_START,
    effectiveTo: null,
    createdBy: 'elena',
    createdAt: GOAL_START,
  }
  return {
    program: {
      id: PROGRAM_ID,
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      name: 'Monthly portal goal',
      description: null,
      status: 'active',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'elena',
      createdAt: GOAL_START,
      updatedAt: GOAL_START,
    },
    version,
    versions: [version],
    assignments: [assignment],
    results: [],
  }
}

const counted = (metric: CountMetric, value: number): GovernedGoalMetricResult => ({
  definitionVersionId: VERSION_IDS[metric],
  metricKey:
    metric === 'qualified_scans' ? 'portal.qualified_scan' : 'portal.rating_count',
  state: 'updating',
  exactValue: value,
  sampleCount: value,
  minimumSample: 0,
  sourceCompleteThrough: null,
  reason: 'source_reconciling',
})

type Case = Readonly<{
  month: string
  metric: CountMetric
  target: number
  day: number
  value: number
}>

type Verdicts = Case &
  Readonly<{
    /** The Goals list: 1 below pace, 0 keeping up, null not judged. */
    list: number | null
    /** The Overview chip and the Properties list. */
    byProperty: number
    pace: ReturnType<typeof goalPace>['state']
  }>

async function verdictsOf(now: Date, item: Case): Promise<Verdicts> {
  const deps: GoalProgressDeps = {
    reads: {
      list: async () => [goalOf(item.metric, item.target)],
      get: async () => {
        throw new Error('the list reads no goal one by one')
      },
    },
    metrics: { queryGoalMetric: async () => counted(item.metric, item.value) },
    now: () => now,
  }
  const listed = await createGoalListProgressReader(deps)(
    { propertyId: PROPERTY_ID },
    actor,
  )
  const period = calendarPeriodRange(now, ZONE, 'monthly')
  const byProperty = goalsBehindPaceByProperty(
    [
      {
        propertyId: PROPERTY_ID,
        programId: PROGRAM_ID,
        metric: item.metric,
        period,
        timezone: ZONE,
        target: item.target,
        value: item.value,
      },
    ],
    now,
  )
  const pace = goalPace({
    metric: item.metric,
    value: item.value,
    target: item.target,
    period,
    now,
    timezone: ZONE,
  })
  if (listed.length !== 1) throw new Error(`the list gave ${listed.length} goals`)
  return {
    ...item,
    list: listed[0]!.belowPace,
    byProperty: byProperty.get(PROPERTY_ID) ?? 0,
    pace: pace.state,
  }
}

async function everyVerdict(): Promise<readonly Verdicts[]> {
  const verdicts: Verdicts[] = []
  for (const month of MONTHS) {
    for (const metric of METRICS) {
      for (const target of TARGETS) {
        for (const day of DAYS) {
          for (const value of VALUES) {
            const item = { month: month.name, metric, target, day, value }
            verdicts.push(await verdictsOf(month.at(day), item))
          }
        }
      }
    }
  }
  return verdicts
}

const label = (verdict: Verdicts) =>
  `${verdict.metric} ${verdict.value} of ${verdict.target} on ${verdict.month} ${verdict.day}`

describe('goal pace parity', () => {
  let verdicts: readonly Verdicts[] = []

  beforeAll(async () => {
    verdicts = await everyVerdict()
  })

  it('list, chip and Properties list agree on every small month', () => {
    const disagreements = verdicts.flatMap((verdict) => {
      const behind = verdict.pace === 'behind'
      const judged = behind || verdict.pace === 'on_pace'
      const agree =
        (verdict.list === 1) === behind &&
        (verdict.byProperty === 1) === behind &&
        (verdict.list !== null) === judged
      return agree ? [] : [label(verdict)]
    })

    expect(verdicts).toHaveLength(
      MONTHS.length * METRICS.length * TARGETS.length * DAYS.length * VALUES.length,
    )
    expect(disagreements).toEqual([])
  })

  it('agrees on the months the guard decides, not only where nothing is judged', () => {
    const find = (month: string, target: number, day: number, value: number) =>
      verdicts.find(
        (verdict) =>
          verdict.metric === 'portal_rating_count' &&
          verdict.month === month &&
          verdict.target === target &&
          verdict.day === day &&
          verdict.value === value,
      )

    // 10 in 30 days: 14 days in expects 4.67, so nothing is judged.
    expect(find('November', 10, 14, 0)).toMatchObject({ list: null, byProperty: 0 })
    // 15 days in expects exactly 5: 4 is behind, 5 keeps pace.
    expect(find('November', 10, 15, 4)).toMatchObject({ list: 1, byProperty: 1 })
    expect(find('November', 10, 15, 5)).toMatchObject({ list: 0, byProperty: 0 })
    // 8 in 31 days: judged from the 20th.
    expect(find('October', 8, 15, 0)).toMatchObject({ list: null, byProperty: 0 })
    expect(find('October', 8, 20, 0)).toMatchObject({ list: 1, byProperty: 1 })
    // 4 a month is never judged, even on its last day with nothing counted.
    expect(
      verdicts
        .filter(
          (verdict) =>
            verdict.target === 4 && (verdict.list !== null || verdict.byProperty !== 0),
        )
        .map(label),
    ).toEqual([])
  })
})
