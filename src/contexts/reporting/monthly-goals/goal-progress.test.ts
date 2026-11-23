import { describe, expect, it, vi } from 'vitest'
import type {
  GoalMonthlyResult,
  GoalMonthTargetChange,
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../application/ports/goal-program.repository'
import type { GoalMetric, GoalSubject } from '../domain/goal-program'
import { METRIC_VERSION_IDS } from '../readings/contracts'
import type { GovernedGoalMetricResult } from '../readings/query-goal-metric.server'
import { createGoalProgressReader, type GoalProgressDeps } from './goal-progress.server'
import type { GoalActor } from './goal-programs.server'

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
  const deps: GoalProgressDeps = {
    reads: { list },
    metrics: { queryGoalMetric },
    now: () => NOW,
  }
  return {
    progress: createGoalProgressReader(deps),
    queryGoalMetric,
    list,
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

/** The month of an assignment of `base`: September, open, unless patched. */
function monthOf(
  base: GoalProgramBundle,
  patch: Partial<GoalMonthlyResult> = {},
  assignment = base.assignments[0],
): GoalMonthlyResult {
  if (!assignment) throw new Error('the goal has no assignment')
  return {
    id: `${assignment.id}-september`,
    assignmentId: assignment.id,
    programId: base.program.id,
    programVersionId: assignment.programVersionId,
    organizationId: actor.organizationId,
    propertyId: PROPERTY_ID,
    periodStart: SEPTEMBER_START,
    periodEnd: OCTOBER_START,
    propertyTimezone: ZONE,
    status: 'open',
    targetValue: null,
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
    ...patch,
  }
}

const targetChange = (
  month: GoalMonthlyResult,
  patch: Pick<
    GoalMonthTargetChange,
    'previousTargetValue' | 'newTargetValue' | 'createdBy' | 'createdAt'
  >,
): GoalMonthTargetChange => ({
  id: `change-${month.id}-${patch.createdAt.getTime()}`,
  organizationId: actor.organizationId,
  propertyId: PROPERTY_ID,
  programId: month.programId,
  monthlyResultId: month.id,
  changeId: `command-${patch.createdAt.getTime()}`,
  followingOutcome: 'not_requested',
  followingReason: null,
  followingVersionId: null,
  note: null,
  ...patch,
})

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
        monthTarget: null,
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

  it('dates a paused goal by the month it is in, not the month its assignment began', async () => {
    const JUNE_START = new Date('2026-05-31T21:00:00.000Z')
    const { progress, queryGoalMetric } = reader([
      bundle({ status: 'paused', effectiveFrom: JUNE_START }),
    ])

    const [goal] = await progress(input, actor)

    expect(goal?.period.start).toEqual(SEPTEMBER_START)
    expect(goal?.period.end).toEqual(OCTOBER_START)
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
      reads: { list: refuse },
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

  describe('a month with a target of its own', () => {
    const SEP_10 = new Date('2026-09-10T08:00:00.000Z')
    const SEP_20 = new Date('2026-09-20T08:00:00.000Z')

    it('shows the month’s own target, and a changed month names the person who changed it', async () => {
      const base = bundle()
      const september = monthOf(base, { targetValue: 200 })
      const { progress } = reader([
        {
          ...base,
          results: [september],
          targetChanges: [
            targetChange(september, {
              previousTargetValue: 250,
              newTargetValue: 200,
              createdBy: 'marco',
              createdAt: SEP_20,
            }),
          ],
        },
      ])

      const [goal] = await progress(input, actor)

      expect(goal).toMatchObject({
        targetValue: 200,
        monthTarget: {
          changedAt: SEP_20,
          changedBy: 'marco',
          startTarget: 250,
          changeCount: 1,
        },
        // Who set the goal stays who set it.
        setBy: 'elena',
        setAt: new Date('2026-08-12T10:00:00.000Z'),
      })
    })

    it('counts every change and keeps the target the month started with', async () => {
      const base = bundle()
      const september = monthOf(base, { targetValue: 180 })
      const { progress } = reader([
        {
          ...base,
          results: [september],
          targetChanges: [
            targetChange(september, {
              previousTargetValue: 250,
              newTargetValue: 200,
              createdBy: 'marco',
              createdAt: SEP_10,
            }),
            targetChange(september, {
              previousTargetValue: 200,
              newTargetValue: 180,
              createdBy: 'ivana',
              createdAt: SEP_20,
            }),
          ],
        },
      ])

      const [goal] = await progress(input, actor)

      expect(goal).toMatchObject({
        targetValue: 180,
        monthTarget: {
          changedAt: SEP_20,
          changedBy: 'ivana',
          startTarget: 250,
          changeCount: 2,
        },
      })
    })

    it('has no marker once the month is back on the target it started with', async () => {
      const base = bundle()
      const september = monthOf(base)
      const { progress } = reader([
        {
          ...base,
          results: [september],
          targetChanges: [
            targetChange(september, {
              previousTargetValue: 250,
              newTargetValue: 200,
              createdBy: 'marco',
              createdAt: SEP_10,
            }),
            targetChange(september, {
              previousTargetValue: 200,
              newTargetValue: 250,
              createdBy: 'marco',
              createdAt: SEP_20,
            }),
          ],
        },
      ])

      const [goal] = await progress(input, actor)

      expect(goal).toMatchObject({ targetValue: 250, monthTarget: null })
    })

    it('does not carry last month’s own target into this month', async () => {
      const AUGUST_START = new Date('2026-07-31T21:00:00.000Z')
      const base = bundle({ effectiveFrom: AUGUST_START })
      const august = monthOf(base, {
        id: 'august',
        periodStart: AUGUST_START,
        periodEnd: SEPTEMBER_START,
        status: 'closed',
        targetValue: 180,
      })
      const { progress } = reader([
        {
          ...base,
          results: [august, monthOf(base)],
          targetChanges: [
            targetChange(august, {
              previousTargetValue: 250,
              newTargetValue: 180,
              createdBy: 'marco',
              createdAt: new Date('2026-08-20T08:00:00.000Z'),
            }),
          ],
        },
      ])

      const [goal] = await progress(input, actor)

      expect(goal).toMatchObject({ targetValue: 250, monthTarget: null })
    })

    it('reads each subject of a goal against its own running month', async () => {
      const lobbyPortal: GoalSubject = { kind: 'portal', portalId: 'portal-lobby' }
      const barPortal: GoalSubject = { kind: 'portal', portalId: 'portal-bar' }
      const base = bundle()
      const assignments = [lobbyPortal, barPortal].map((subject, index) => ({
        ...base.assignments[0]!,
        id: `program-1-a${index + 1}`,
        subject,
      }))
      const goal: GoalProgramBundle = { ...base, assignments }
      const months = assignments.map((assignment) =>
        monthOf(goal, { targetValue: 200 }, assignment),
      )
      const { progress } = reader([
        {
          ...goal,
          results: months,
          targetChanges: months.map((month) =>
            targetChange(month, {
              previousTargetValue: 250,
              newTargetValue: 200,
              createdBy: 'marco',
              createdAt: SEP_20,
            }),
          ),
        },
      ])

      for (const subject of [lobbyPortal, barPortal]) {
        const [card] = await progress({ propertyId: PROPERTY_ID, subject }, actor)
        expect(card).toMatchObject({
          targetValue: 200,
          monthTarget: { changedBy: 'marco', changeCount: 1 },
        })
      }
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

  it('the card shows the superseding target, not the empty one', async () => {
    // Set at 250 for October, changed to 300 and then to 350 before October
    // began. Each replaced plan keeps the empty window [October, October).
    const emptied = (plan: GoalProgramBundle): GoalProgramBundle => ({
      ...plan,
      assignments: plan.assignments.map((assignment) => ({
        ...assignment,
        effectiveTo: assignment.effectiveTo ?? OCTOBER_START,
      })),
    })
    const first = bundle({ status: 'scheduled', effectiveFrom: OCTOBER_START })
    const second = withNextVersion(emptied(first), {
      targetValue: 300,
      effectiveFrom: OCTOBER_START,
      createdBy: 'marco',
      createdAt: new Date('2026-09-10T08:00:00.000Z'),
    })
    const third = withNextVersion(
      emptied(second),
      {
        id: 'program-1-v3',
        version: 3,
        targetValue: 350,
        effectiveFrom: OCTOBER_START,
        createdBy: 'ivana',
        createdAt: new Date('2026-09-20T08:00:00.000Z'),
      },
      { id: 'program-1-a3' },
    )
    const { progress } = reader([third])

    const [card] = await progress(input, actor)

    expect(card).toMatchObject({
      targetValue: 350,
      setBy: 'ivana',
      setAt: new Date('2026-09-20T08:00:00.000Z'),
      period: { start: OCTOBER_START },
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
