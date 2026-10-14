import { describe, expect, it, vi } from 'vitest'
import { POOL_MAX_CONNECTIONS } from '#/shared/db/pool'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import type { GoalMetric, GoalSubject } from '../../domain/goal-program'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type { GovernedGoalMetricResult } from './query-goal-metric'
import type { GoalProgressDeps } from './goal-progress'
import {
  createGoalListProgressReader,
  GOAL_LIST_PROGRESS_CONCURRENCY,
  MAX_GOAL_LIST_PROGRESS_READS,
} from './goal-list-progress'
import type { GoalActor } from './goal-programs'

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}

const PROPERTY_ID = 'property-1'
const ZONE = 'Europe/Sofia'
// 24 Sep 2026, midday in Sofia: day 24 of 30, six days before the month ends.
const NOW = new Date('2026-09-24T09:00:00.000Z')
const EARLY = new Date('2026-09-02T09:00:00.000Z')
const SEPTEMBER_START = new Date('2026-08-31T21:00:00.000Z')
const OCTOBER_START = new Date('2026-09-30T21:00:00.000Z')

const VERSION_IDS: Record<GoalMetric, string> = {
  qualified_scans: METRIC_VERSION_IDS.qualifiedScanGoal,
  portal_rating_count: METRIC_VERSION_IDS.portalRatingCountGoal,
  portal_rating_average: METRIC_VERSION_IDS.portalRatingAverageGoal,
}

const portal = (id: string): GoalSubject => ({ kind: 'portal', portalId: id })
const portals = (count: number): readonly GoalSubject[] =>
  Array.from({ length: count }, (_, index) => portal(`portal-${index + 1}`))

type Spec = Readonly<{
  id?: string
  status?: GoalProgramBundle['program']['status']
  metric?: GoalMetric
  target?: number
  subjects?: readonly GoalSubject[]
  effectiveFrom?: Date
  monthTarget?: number | null
}>

function monthOf(
  id: string,
  assignment: GoalSubjectAssignment,
  targetValue: number | null,
): GoalMonthlyResult {
  return {
    id: `${assignment.id}-september`,
    assignmentId: assignment.id,
    programId: id,
    programVersionId: assignment.programVersionId,
    organizationId: actor.organizationId,
    propertyId: PROPERTY_ID,
    periodStart: SEPTEMBER_START,
    periodEnd: OCTOBER_START,
    propertyTimezone: ZONE,
    status: 'open',
    targetValue,
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
    createdAt: SEPTEMBER_START,
    updatedAt: SEPTEMBER_START,
  }
}

function bundle(spec: Spec = {}): GoalProgramBundle {
  const id = spec.id ?? 'program-1'
  const metric = spec.metric ?? 'qualified_scans'
  const effectiveFrom = spec.effectiveFrom ?? SEPTEMBER_START
  const version: GoalProgramVersion = {
    id: `${id}-v1`,
    programId: id,
    organizationId: actor.organizationId,
    propertyId: PROPERTY_ID,
    version: 1,
    metricDefinitionId: 'definition-1',
    metricDefinitionVersionId: VERSION_IDS[metric],
    metric,
    metricMinimumSample: metric === 'portal_rating_average' ? 10 : 0,
    targetValue: spec.target ?? 120,
    propertyTimezone: ZONE,
    effectiveFrom,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'elena',
    createdAt: new Date('2026-08-12T10:00:00.000Z'),
  }
  const assignments: readonly GoalSubjectAssignment[] = (
    spec.subjects ?? [portal('portal-1')]
  ).map((subject, index) => ({
    id: `${id}-a${index + 1}`,
    programId: id,
    programVersionId: version.id,
    organizationId: actor.organizationId,
    propertyId: PROPERTY_ID,
    metric,
    subject,
    effectiveFrom,
    effectiveTo: null,
    createdBy: 'elena',
    createdAt: version.createdAt,
  }))
  return {
    program: {
      id,
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      name: 'Lobby scans',
      description: null,
      status: spec.status ?? 'active',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'elena',
      createdAt: version.createdAt,
      updatedAt: version.createdAt,
    },
    version,
    versions: [version],
    assignments: [...assignments],
    results: assignments.map((assignment) =>
      monthOf(id, assignment, spec.monthTarget ?? null),
    ),
  }
}

const counted = (value: number, sampleCount = value): GovernedGoalMetricResult => ({
  definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
  metricKey: 'portal.qualified_scan',
  state: 'updating',
  exactValue: value,
  sampleCount,
  minimumSample: 0,
  sourceCompleteThrough: null,
  reason: 'source_reconciling',
})

const broken: GovernedGoalMetricResult = {
  ...counted(0),
  state: 'unavailable',
  exactValue: null,
  reason: 'subject_unavailable',
}

type Reads = (subject: GoalSubject) => GovernedGoalMetricResult

function reader(
  programs: readonly GoalProgramBundle[],
  reads: Reads = () => counted(64),
  now = NOW,
) {
  const queryGoalMetric = vi.fn<GoalProgressDeps['metrics']['queryGoalMetric']>(
    async (query) =>
      reads(
        query.subject.kind === 'portal'
          ? portal(query.subject.portalId)
          : { kind: 'property', propertyId: query.propertyId },
      ),
  )
  const list = vi.fn(async () => programs)
  const get = vi.fn<GoalProgressDeps['reads']['get']>(async () => {
    throw new Error('the list reads no goal one by one')
  })
  const deps: GoalProgressDeps = {
    reads: { list, get },
    metrics: { queryGoalMetric },
    now: () => now,
  }
  return {
    listProgress: createGoalListProgressReader(deps),
    queryGoalMetric,
    list,
    get,
  }
}

const input = { propertyId: PROPERTY_ID }

describe('the month so far of the goals on the Goals list', () => {
  it('reads the Property once and no goal one by one', async () => {
    const { listProgress, list, get } = reader([
      bundle({ id: 'program-1' }),
      bundle({ id: 'program-2', metric: 'portal_rating_count' }),
    ])

    await listProgress(input, actor)

    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(PROPERTY_ID, actor)
    expect(get).not.toHaveBeenCalled()
  })

  it('gives a goal with one count subject its figure, target and days left', async () => {
    // 100 of 120 on day 24 of 30 keeps up with the 96 the line expects.
    const { listProgress } = reader([bundle({ target: 120 })], () => counted(100))

    const goals = await listProgress(input, actor)

    expect(goals).toEqual([
      {
        programId: 'program-1',
        metric: 'qualified_scans',
        subjectCount: 1,
        daysLeft: 6,
        month: {
          reading: { kind: 'live', value: 100, sampleCount: 100 },
          targetValue: 120,
        },
        belowPace: 0,
      },
    ])
  })

  it("gives the running month's own target, not the version's", async () => {
    const { listProgress } = reader([bundle({ target: 120, monthTarget: 200 })])

    const [goal] = await listProgress(input, actor)

    expect(goal?.month?.targetValue).toBe(200)
  })

  it('gives a goal with one average subject its average, or why there is none yet', async () => {
    const average = bundle({ metric: 'portal_rating_average', target: 4.5 })
    const enough = reader([average], () => counted(4.6, 31)).listProgress
    const few = reader([average], () => counted(4.6, 4)).listProgress

    expect(await enough(input, actor)).toMatchObject([
      { month: { reading: { kind: 'live', value: 4.6 }, targetValue: 4.5 } },
    ])
    expect(await few(input, actor)).toMatchObject([
      { month: { reading: { kind: 'too_few', sampleCount: 4, minimumSample: 10 } } },
    ])
  })

  it('says a figure that cannot be read is unavailable, never a zero', async () => {
    const { listProgress } = reader([bundle()], () => broken)

    expect(await listProgress(input, actor)).toMatchObject([
      { month: { reading: { kind: 'unavailable' } } },
    ])
  })

  describe('the pace of a goal with one count subject', () => {
    // Day 24 of 30, target 120: the line expects 96; 90% of it is 86.4.
    const paced = (value: number, now = NOW) =>
      reader([bundle({ target: 120 })], () => counted(value), now).listProgress

    it('says the subject is below pace under 90% of what the line expects', async () => {
      expect(await paced(86)(input, actor)).toMatchObject([
        { subjectCount: 1, belowPace: 1 },
      ])
    })

    it('says it keeps up from 90% of what the line expects', async () => {
      expect(await paced(87)(input, actor)).toMatchObject([
        { subjectCount: 1, belowPace: 0 },
      ])
    })

    it('judges it by the pace of the running month’s own target', async () => {
      const { listProgress } = reader([bundle({ target: 120, monthTarget: 400 })], () =>
        counted(100),
      )

      // 100 clears the 120 of the version and misses the 400 of the month.
      expect(await listProgress(input, actor)).toMatchObject([{ belowPace: 1 }])
    })

    it('judges nothing in the first days of the month', async () => {
      expect(await paced(0, EARLY)(input, actor)).toMatchObject([
        { belowPace: null, daysLeft: 28 },
      ])
    })

    it('judges nothing for an average, which has no pace', async () => {
      const { listProgress } = reader(
        [bundle({ metric: 'portal_rating_average', target: 4.5 })],
        () => counted(2.1, 31),
      )

      expect(await listProgress(input, actor)).toMatchObject([{ belowPace: null }])
    })

    it('judges nothing when the figure cannot be read', async () => {
      const { listProgress } = reader([bundle()], () => broken)

      expect(await listProgress(input, actor)).toMatchObject([{ belowPace: null }])
    })

    it('judges the same figure the same way as one of several subjects', async () => {
      const one = await paced(86)(input, actor)
      const several = await reader([bundle({ target: 120, subjects: portals(2) })], () =>
        counted(86),
      ).listProgress(input, actor)

      expect(one[0]?.belowPace).toBe(1)
      expect(several[0]?.belowPace).toBe(2)
    })
  })

  it('counts the subjects of a count goal that are below pace', async () => {
    // Day 24 of 30, target 120: the line expects 96; 90% of it is 86.4.
    const figures: Record<string, number> = {
      'portal-1': 100,
      'portal-2': 86,
      'portal-3': 20,
    }
    const { listProgress, queryGoalMetric } = reader(
      [bundle({ subjects: portals(3) })],
      (subject) =>
        counted(subject.kind === 'portal' ? (figures[subject.portalId] ?? 0) : 0),
    )

    const [goal] = await listProgress(input, actor)

    expect(goal).toMatchObject({ subjectCount: 3, belowPace: 2, month: null })
    expect(queryGoalMetric).toHaveBeenCalledTimes(3)
  })

  it('says none are below pace when every subject keeps up', async () => {
    const { listProgress } = reader([bundle({ subjects: portals(2) })], () =>
      counted(110),
    )

    expect(await listProgress(input, actor)).toMatchObject([
      { subjectCount: 2, belowPace: 0 },
    ])
  })

  it('judges a subject against the running month of its own assignment', async () => {
    const goal = bundle({ subjects: portals(2) })
    const [lobby, bar] = goal.results
    const withOwnTargets: GoalProgramBundle = {
      ...goal,
      results: [
        { ...lobby!, targetValue: 20 },
        { ...bar!, targetValue: 400 },
      ],
    }
    const { listProgress } = reader([withOwnTargets], () => counted(50))

    // 50 clears the 20 of one month and misses the 400 of the other.
    expect(await listProgress(input, actor)).toMatchObject([{ belowPace: 1 }])
  })

  it('does not count a subject whose figure cannot be read', async () => {
    const { listProgress } = reader([bundle({ subjects: portals(3) })], (subject) =>
      subject.kind === 'portal' && subject.portalId === 'portal-1' ? broken : counted(10),
    )

    expect(await listProgress(input, actor)).toMatchObject([{ belowPace: 2 }])
  })

  it('judges nothing when no subject can be read', async () => {
    const { listProgress } = reader([bundle({ subjects: portals(2) })], () => broken)

    expect(await listProgress(input, actor)).toMatchObject([
      { subjectCount: 2, belowPace: null },
    ])
  })

  it('judges nothing in the first days of the month', async () => {
    const { listProgress } = reader(
      [bundle({ subjects: portals(2) })],
      () => counted(0),
      EARLY,
    )

    expect(await listProgress(input, actor)).toMatchObject([
      { subjectCount: 2, belowPace: null, daysLeft: 28 },
    ])
  })

  it('reads no figure for a goal on an average with several subjects', async () => {
    const { listProgress, queryGoalMetric } = reader([
      bundle({ metric: 'portal_rating_average', target: 4.5, subjects: portals(3) }),
    ])

    expect(await listProgress(input, actor)).toMatchObject([
      { subjectCount: 3, belowPace: null, month: null },
    ])
    expect(queryGoalMetric).not.toHaveBeenCalled()
  })

  it('reads no figure for a goal with more subjects than its page reads', async () => {
    const { listProgress, queryGoalMetric } = reader([bundle({ subjects: portals(26) })])

    expect(await listProgress(input, actor)).toMatchObject([
      { subjectCount: 26, belowPace: null, month: null },
    ])
    expect(queryGoalMetric).not.toHaveBeenCalled()
  })

  it.each(['scheduled', 'paused', 'ended'] as const)(
    'gives a %s goal no live figure and reads nothing for it',
    async (status) => {
      const { listProgress, queryGoalMetric } = reader([bundle({ status })])

      expect(await listProgress(input, actor)).toEqual([])
      expect(queryGoalMetric).not.toHaveBeenCalled()
    },
  )

  it('gives an active goal that has not begun no live figure', async () => {
    const { listProgress } = reader([bundle({ effectiveFrom: OCTOBER_START })])

    expect(await listProgress(input, actor)).toEqual([])
  })

  it('stops reading once a page has used its reads, keeping the goals before it', async () => {
    const goals = Array.from({ length: MAX_GOAL_LIST_PROGRESS_READS + 5 }, (_, index) =>
      bundle({ id: `program-${index + 1}`, subjects: [portal(`portal-${index + 1}`)] }),
    )
    const { listProgress, queryGoalMetric } = reader(goals)

    const read = await listProgress(input, actor)

    expect(read).toHaveLength(MAX_GOAL_LIST_PROGRESS_READS)
    expect(read[0]?.programId).toBe('program-1')
    expect(queryGoalMetric).toHaveBeenCalledTimes(MAX_GOAL_LIST_PROGRESS_READS)
  })

  it('keeps the reads of a page within its concurrency', async () => {
    let inFlight = 0
    let widest = 0
    const goals = Array.from({ length: 20 }, (_, index) =>
      bundle({ id: `program-${index + 1}`, subjects: [portal(`portal-${index + 1}`)] }),
    )
    const deps: GoalProgressDeps = {
      reads: { list: async () => goals, get: vi.fn() },
      metrics: {
        queryGoalMetric: async () => {
          inFlight += 1
          widest = Math.max(widest, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 1))
          inFlight -= 1
          return counted(1)
        },
      },
      now: () => NOW,
    }

    await createGoalListProgressReader(deps)(input, actor)

    expect(widest).toBeGreaterThan(1)
    expect(widest).toBeLessThanOrEqual(GOAL_LIST_PROGRESS_CONCURRENCY)
  })

  it('asks for no more connections at once than the web pool can spare', () => {
    // A governed read asks two queries at once (the aggregate and the source
    // check), each on a pool connection of its own. A page view must leave the
    // pool room for the loader's other reads and for other requests.
    const queriesPerRead = 2
    const spareForOthers = 4

    expect(GOAL_LIST_PROGRESS_CONCURRENCY * queriesPerRead).toBeLessThanOrEqual(
      POOL_MAX_CONNECTIONS - spareForOthers,
    )
  })

  it('keeps the order of the goals the Property lists', async () => {
    const { listProgress } = reader([
      bundle({ id: 'program-b' }),
      bundle({ id: 'program-a', status: 'paused' }),
      bundle({ id: 'program-c', metric: 'portal_rating_count' }),
    ])

    const goals = await listProgress(input, actor)

    expect(goals.map((goal) => goal.programId)).toEqual(['program-b', 'program-c'])
  })
})
