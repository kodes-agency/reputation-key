import { describe, expect, it, vi } from 'vitest'
import type {
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import type { GoalMetric, GoalSubject } from '../../domain/goal-program'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type { GovernedGoalMetricResult } from './query-goal-metric'
import {
  createGoalProgramProgressReader,
  createGoalProgressReader,
  MAX_GOAL_PROGRAM_PROGRESS_SUBJECTS,
  type GoalProgressDeps,
} from './goal-progress'
import type { GoalActor } from './goal-programs'

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}

const PROPERTY_ID = 'property-1'
const GROUP_ID = 'group-1'
const ZONE = 'Europe/Sofia'
// 24 Sep 2026, midday in Sofia: the September month, six days before it ends.
const NOW = new Date('2026-09-24T09:00:00.000Z')
const SEPTEMBER_START = new Date('2026-08-31T21:00:00.000Z')
const OCTOBER_START = new Date('2026-09-30T21:00:00.000Z')

const VERSION_IDS: Record<GoalMetric, string> = {
  qualified_scans: METRIC_VERSION_IDS.qualifiedScanGoal,
  portal_rating_count: METRIC_VERSION_IDS.portalRatingCountGoal,
  portal_rating_average: METRIC_VERSION_IDS.portalRatingAverageGoal,
}

type Spec = Readonly<{
  id?: string
  name?: string
  status?: GoalProgramBundle['program']['status']
  metric?: GoalMetric
  target?: number
  subject?: GoalSubject
  minimumSample?: number
  effectiveFrom?: Date
  createdBy?: string
}>

function bundle(spec: Spec = {}): GoalProgramBundle {
  const id = spec.id ?? 'program-1'
  const metric = spec.metric ?? 'portal_rating_count'
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
    metricMinimumSample:
      spec.minimumSample ?? (metric === 'portal_rating_average' ? 10 : 0),
    targetValue: spec.target ?? 250,
    propertyTimezone: ZONE,
    effectiveFrom,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: spec.createdBy ?? 'elena',
    createdAt: new Date('2026-08-12T10:00:00.000Z'),
  }
  const assignment: GoalSubjectAssignment = {
    id: `${id}-a1`,
    programId: id,
    programVersionId: version.id,
    organizationId: actor.organizationId,
    propertyId: PROPERTY_ID,
    metric,
    subject: spec.subject ?? { kind: 'portal_group', portalGroupId: GROUP_ID },
    effectiveFrom,
    effectiveTo: null,
    createdBy: 'elena',
    createdAt: version.createdAt,
  }
  return {
    program: {
      id,
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      name: spec.name ?? 'Private ratings',
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
    assignments: [assignment],
    results: [],
  }
}

const reading = (patch: Partial<GovernedGoalMetricResult>): GovernedGoalMetricResult => ({
  definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
  metricKey: 'portal.rating_count',
  state: 'updating',
  exactValue: 209,
  sampleCount: 209,
  minimumSample: 0,
  sourceCompleteThrough: null,
  reason: 'source_reconciling',
  ...patch,
})

function reader(
  programs: readonly GoalProgramBundle[],
  metricResult: GovernedGoalMetricResult = reading({}),
) {
  const queryGoalMetric = vi.fn<GoalProgressDeps['metrics']['queryGoalMetric']>(
    async () => metricResult,
  )
  const list = vi.fn(async () => programs)
  const get = vi.fn<GoalProgressDeps['reads']['get']>(async ({ programId }) => {
    const found = programs.find((candidate) => candidate.program.id === programId)
    if (!found) throw new Error('not_found')
    return found
  })
  const deps: GoalProgressDeps = {
    reads: { list, get },
    metrics: { queryGoalMetric },
    now: () => NOW,
  }
  return {
    progress: createGoalProgressReader(deps),
    programProgress: createGoalProgramProgressReader(deps),
    queryGoalMetric,
    list,
    get,
  }
}

/** A second version of a bundle, with its own assignment for the subject. */
function withNextVersion(
  base: GoalProgramBundle,
  patch: Partial<GoalProgramVersion>,
  assignment: Partial<GoalSubjectAssignment> = {},
): GoalProgramBundle {
  const next: GoalProgramVersion = {
    ...base.version,
    id: `${base.program.id}-v2`,
    version: 2,
    ...patch,
  }
  return {
    ...base,
    program: { ...base.program, currentVersion: 2 },
    version: next,
    versions: [...base.versions, next],
    assignments: [
      ...base.assignments,
      {
        ...base.assignments[0]!,
        id: `${base.program.id}-a2`,
        programVersionId: next.id,
        effectiveFrom: next.effectiveFrom,
        effectiveTo: null,
        ...assignment,
      },
    ],
  }
}

const group: GoalSubject = { kind: 'portal_group', portalGroupId: GROUP_ID }
const input = { propertyId: PROPERTY_ID, subject: group }

describe('createGoalProgressReader', () => {
  it('reads the live month to date for the goal that targets the subject', async () => {
    const { progress, queryGoalMetric, list } = reader([bundle()])

    const goals = await progress(input, actor)

    expect(list).toHaveBeenCalledWith(PROPERTY_ID, actor)
    expect(goals).toEqual([
      {
        programId: 'program-1',
        name: 'Private ratings',
        metric: 'portal_rating_count',
        targetValue: 250,
        setBy: 'elena',
        setAt: new Date('2026-08-12T10:00:00.000Z'),
        status: 'active',
        period: { start: SEPTEMBER_START, end: OCTOBER_START },
        timezone: ZONE,
        asOf: NOW,
        reading: { kind: 'live', value: 209, sampleCount: 209 },
      },
    ])
    expect(queryGoalMetric).toHaveBeenCalledWith({
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      subject: { kind: 'portal_group', portalGroupId: GROUP_ID },
      periodStart: SEPTEMBER_START,
      periodEnd: OCTOBER_START,
    })
  })

  it('never reports a goal for another subject, a property-wide goal or an ended one', async () => {
    const { progress, queryGoalMetric } = reader([
      bundle({
        id: 'other-group',
        subject: { kind: 'portal_group', portalGroupId: 'group-2' },
      }),
      bundle({
        id: 'whole-property',
        subject: { kind: 'property', propertyId: PROPERTY_ID },
      }),
      bundle({ id: 'ended', status: 'ended' }),
    ])

    expect(await progress(input, actor)).toEqual([])
    expect(queryGoalMetric).not.toHaveBeenCalled()
  })

  it('ignores an assignment that has been replaced by a later version', async () => {
    const replaced = bundle()
    const closed = {
      ...replaced,
      assignments: replaced.assignments.map((assignment) => ({
        ...assignment,
        effectiveTo: new Date('2026-09-10T00:00:00.000Z'),
      })),
    }
    const { progress } = reader([closed])

    expect(await progress(input, actor)).toEqual([])
  })

  it('shows a goal that has not started yet without reading a figure', async () => {
    const { progress, queryGoalMetric } = reader([
      bundle({ status: 'scheduled', effectiveFrom: OCTOBER_START }),
    ])

    const [goal] = await progress(input, actor)

    expect(goal?.status).toBe('scheduled')
    expect(goal?.reading).toEqual({ kind: 'not_started' })
    expect(goal?.period.start).toEqual(OCTOBER_START)
    expect(queryGoalMetric).not.toHaveBeenCalled()
  })

  it('shows a paused goal as not started, with no figure', async () => {
    const { progress, queryGoalMetric } = reader([bundle({ status: 'paused' })])

    const [goal] = await progress(input, actor)

    expect(goal?.reading).toEqual({ kind: 'not_started' })
    expect(queryGoalMetric).not.toHaveBeenCalled()
  })

  it('does not show an average the month so far cannot support', async () => {
    const { progress } = reader(
      [bundle({ metric: 'portal_rating_average', target: 4.6 })],
      reading({ exactValue: 4.8, sampleCount: 6, minimumSample: 10 }),
    )

    const [goal] = await progress(input, actor)

    expect(goal?.reading).toEqual({ kind: 'too_few', sampleCount: 6, minimumSample: 10 })
  })

  it('shows an average once the sample is large enough', async () => {
    const { progress } = reader(
      [bundle({ metric: 'portal_rating_average', target: 4.6 })],
      reading({ exactValue: 4.5, sampleCount: 31, minimumSample: 10 }),
    )

    const [goal] = await progress(input, actor)

    expect(goal?.reading).toEqual({ kind: 'live', value: 4.5, sampleCount: 31 })
  })

  it.each(['unavailable', 'quarantined'] as const)(
    'says the figure is unavailable when the read is %s, never a zero',
    async (state) => {
      const { progress } = reader(
        [bundle()],
        reading({ state, exactValue: 0, sampleCount: 0, reason: 'x' }),
      )

      const [goal] = await progress(input, actor)

      expect(goal?.reading).toEqual({ kind: 'unavailable' })
    },
  )

  it('says the figure is unavailable when a count has no value', async () => {
    const { progress } = reader([bundle()], reading({ exactValue: null }))

    const [goal] = await progress(input, actor)

    expect(goal?.reading).toEqual({ kind: 'unavailable' })
  })

  it('reports every goal for the subject, one per metric', async () => {
    const { progress } = reader([
      bundle({ id: 'ratings' }),
      bundle({ id: 'scans', metric: 'qualified_scans', name: 'Scans', target: 700 }),
    ])

    const goals = await progress(input, actor)

    expect(goals.map((goal) => goal.programId)).toEqual(['ratings', 'scans'])
  })

  it('lets the list refuse: an actor who may not read goals never reaches a figure', async () => {
    const queryGoalMetric = vi.fn()
    const refuse = async () => {
      throw new Error('forbidden')
    }
    const progress = createGoalProgressReader({
      reads: { list: refuse, get: refuse },
      metrics: { queryGoalMetric },
      now: () => NOW,
    })

    await expect(progress(input, actor)).rejects.toThrow('forbidden')
    expect(queryGoalMetric).not.toHaveBeenCalled()
  })

  it('credits the target to who set it and when, not to a later subjects-only change', async () => {
    // Elena set 250 on 12 August, counted from August. On 20 August Marco
    // changed the subjects: a new version, in force from September, with the
    // same measure and target.
    const AUGUST_START = new Date('2026-07-31T21:00:00.000Z')
    const august = bundle({ effectiveFrom: AUGUST_START })
    const closedInSeptember = {
      ...august,
      assignments: august.assignments.map((assignment) => ({
        ...assignment,
        effectiveTo: SEPTEMBER_START,
      })),
    }
    const marcosChange = {
      effectiveFrom: SEPTEMBER_START,
      createdBy: 'marco',
      createdAt: new Date('2026-08-20T08:00:00.000Z'),
    }
    const subjectsOnly = reader([withNextVersion(closedInSeptember, marcosChange)])
    const targetToo = reader([
      withNextVersion(closedInSeptember, { ...marcosChange, targetValue: 300 }),
    ])

    const [unchanged] = await subjectsOnly.progress(input, actor)
    const [raised] = await targetToo.progress(input, actor)

    expect(unchanged).toMatchObject({
      targetValue: 250,
      setBy: 'elena',
      setAt: new Date('2026-08-12T10:00:00.000Z'),
    })
    expect(raised).toMatchObject({
      targetValue: 300,
      setBy: 'marco',
      setAt: new Date('2026-08-20T08:00:00.000Z'),
    })
  })

  it('never reads a goal card from an empty assignment window', async () => {
    // The first plan (target 250) was replaced before it began: its window is
    // [October, October), which holds nothing. The plan in its place says 300.
    const scheduled = bundle({ status: 'scheduled', effectiveFrom: OCTOBER_START })
    const replaced = withNextVersion(
      {
        ...scheduled,
        assignments: scheduled.assignments.map((assignment) => ({
          ...assignment,
          effectiveTo: OCTOBER_START,
        })),
      },
      {
        targetValue: 300,
        effectiveFrom: OCTOBER_START,
        createdBy: 'marco',
        createdAt: new Date('2026-09-10T08:00:00.000Z'),
      },
    )
    const { progress } = reader([replaced])

    const [goal] = await progress(input, actor)

    expect(goal).toMatchObject({
      targetValue: 300,
      setBy: 'marco',
      reading: { kind: 'not_started' },
    })
  })

  it('shows no card for a subject whose only assignment is an empty window', async () => {
    const scheduled = bundle({ status: 'scheduled', effectiveFrom: OCTOBER_START })
    const cancelledSubject = {
      ...scheduled,
      assignments: scheduled.assignments.map((assignment) => ({
        ...assignment,
        effectiveTo: OCTOBER_START,
      })),
    }
    const { progress } = reader([cancelledSubject])

    expect(await progress(input, actor)).toEqual([])
  })
})

describe('createGoalProgramProgressReader', () => {
  const lobby: GoalSubject = { kind: 'portal', portalId: 'portal-lobby' }
  const bar: GoalSubject = { kind: 'portal', portalId: 'portal-bar' }
  const programInput = { propertyId: PROPERTY_ID, programId: 'program-1' }

  /** One goal over several Portals, each with its own assignment. */
  function goalOver(
    subjects: readonly GoalSubject[],
    spec: Spec = {},
  ): GoalProgramBundle {
    const base = bundle(spec)
    return {
      ...base,
      assignments: subjects.map((subject, index) => ({
        ...base.assignments[0]!,
        id: `${base.program.id}-a${index + 1}`,
        subject,
      })),
    }
  }

  it('reads the month to date for every current subject of one goal', async () => {
    const { programProgress, queryGoalMetric, get } = reader([goalOver([lobby, bar])])

    const subjects = await programProgress(programInput, actor)

    expect(get).toHaveBeenCalledWith(programInput, actor)
    expect(subjects).toEqual([
      {
        subject: lobby,
        progress: expect.objectContaining({
          programId: 'program-1',
          targetValue: 250,
          period: { start: SEPTEMBER_START, end: OCTOBER_START },
          reading: { kind: 'live', value: 209, sampleCount: 209 },
        }),
      },
      {
        subject: bar,
        progress: expect.objectContaining({
          reading: { kind: 'live', value: 209, sampleCount: 209 },
        }),
      },
    ])
    expect(queryGoalMetric).toHaveBeenCalledTimes(2)
    expect(queryGoalMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { kind: 'portal', portalId: 'portal-bar' },
        periodStart: SEPTEMBER_START,
        periodEnd: OCTOBER_START,
      }),
    )
  })

  it('returns nothing for a goal with more than 25 current subjects', async () => {
    expect(MAX_GOAL_PROGRAM_PROGRESS_SUBJECTS).toBe(25)
    const portals = (count: number): readonly GoalSubject[] =>
      Array.from({ length: count }, (_, index) => ({
        kind: 'portal',
        portalId: `portal-${index + 1}`,
      }))
    const atTheLimit = reader([goalOver(portals(25))])
    const overTheLimit = reader([goalOver(portals(26))])

    expect(await atTheLimit.programProgress(programInput, actor)).toHaveLength(25)
    expect(atTheLimit.queryGoalMetric).toHaveBeenCalledTimes(25)

    expect(await overTheLimit.programProgress(programInput, actor)).toEqual([])
    expect(overTheLimit.queryGoalMetric).not.toHaveBeenCalled()
  })

  it('counts a subject once, and leaves out one whose assignment has ended', async () => {
    const base = goalOver([lobby, bar])
    const revised = withNextVersion(
      {
        ...base,
        assignments: base.assignments.map((assignment) => ({
          ...assignment,
          // The bar left the goal on 10 September; the lobby stays until October.
          effectiveTo:
            assignment.subject === bar
              ? new Date('2026-09-10T00:00:00.000Z')
              : OCTOBER_START,
        })),
      },
      { effectiveFrom: OCTOBER_START },
      { subject: lobby },
    )
    const { programProgress, queryGoalMetric } = reader([revised])

    const subjects = await programProgress(programInput, actor)

    expect(subjects.map(({ subject }) => subject)).toEqual([lobby])
    expect(queryGoalMetric).toHaveBeenCalledOnce()
  })

  it('shows a subject that joins next month as not started', async () => {
    const base = goalOver([lobby])
    const revised = withNextVersion(
      {
        ...base,
        assignments: base.assignments.map((assignment) => ({
          ...assignment,
          effectiveTo: OCTOBER_START,
        })),
      },
      { effectiveFrom: OCTOBER_START },
      { subject: bar },
    )
    const { programProgress } = reader([revised])

    const subjects = await programProgress(programInput, actor)

    expect(subjects).toEqual([
      {
        subject: lobby,
        progress: expect.objectContaining({
          reading: { kind: 'live', value: 209, sampleCount: 209 },
        }),
      },
      {
        subject: bar,
        progress: expect.objectContaining({ reading: { kind: 'not_started' } }),
      },
    ])
  })

  it('reads no figure for a scheduled or paused goal, and none at all for an ended one', async () => {
    const scheduled = reader([
      goalOver([lobby], { status: 'scheduled', effectiveFrom: OCTOBER_START }),
    ])
    const ended = reader([goalOver([lobby], { status: 'ended' })])

    expect(await scheduled.programProgress(programInput, actor)).toEqual([
      {
        subject: lobby,
        progress: expect.objectContaining({ reading: { kind: 'not_started' } }),
      },
    ])
    expect(scheduled.queryGoalMetric).not.toHaveBeenCalled()
    expect(await ended.programProgress(programInput, actor)).toEqual([])
    expect(ended.queryGoalMetric).not.toHaveBeenCalled()
  })

  it('lets the goal read refuse: a goal the actor may not read never reaches a figure', async () => {
    const { programProgress, queryGoalMetric } = reader([goalOver([lobby])])

    await expect(
      programProgress({ propertyId: PROPERTY_ID, programId: 'another-program' }, actor),
    ).rejects.toThrow('not_found')
    expect(queryGoalMetric).not.toHaveBeenCalled()
  })
})
