import { describe, expect, it, vi } from 'vitest'
import type {
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import type { GoalMetric, GoalSubject } from '../../domain/goal-program'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type { GovernedGoalMetricResult } from './query-goal-metric'
import { createGoalProgressReader, type GoalProgressDeps } from './goal-progress'
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
  const progress = createGoalProgressReader({
    reads: { list },
    metrics: { queryGoalMetric },
    now: () => NOW,
  })
  return { progress, queryGoalMetric, list }
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
    const progress = createGoalProgressReader({
      reads: {
        list: async () => {
          throw new Error('forbidden')
        },
      },
      metrics: { queryGoalMetric },
      now: () => NOW,
    })

    await expect(progress(input, actor)).rejects.toThrow('forbidden')
    expect(queryGoalMetric).not.toHaveBeenCalled()
  })
})
