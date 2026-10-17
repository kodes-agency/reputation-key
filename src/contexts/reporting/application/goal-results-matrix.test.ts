import { describe, expect, it } from 'vitest'
import type {
  GoalMetric,
  GoalMetricEvaluation,
  GoalSubject,
} from '../domain/goal-program'
import type { GoalProgramBundle } from './ports/goal-program.repository'
import { buildGoalResultsMatrix } from './goal-results-matrix'

const periodStart = new Date('2026-07-01T04:00:00.000Z')
const periodEnd = new Date('2026-08-01T04:00:00.000Z')

function bundle(
  input: Readonly<{
    id: string
    name: string
    metric: GoalMetric
    target: number
    subject: GoalSubject
    evaluation: GoalMetricEvaluation
    sourceCompleteThrough?: Date | null
  }>,
): GoalProgramBundle {
  const versionId = `version-${input.id}`
  const assignmentId = `assignment-${input.id}`
  const now = new Date('2026-08-02T05:00:00.000Z')
  const version = {
    id: versionId,
    programId: input.id,
    organizationId: 'org-1',
    propertyId: 'property-1',
    version: 3,
    metricDefinitionId: `definition-${input.id}`,
    metricDefinitionVersionId: `metric-version-${input.id}`,
    metric: input.metric,
    metricMinimumSample: input.metric === 'portal_rating_average' ? 10 : 0,
    targetValue: input.target,
    propertyTimezone: 'America/New_York',
    effectiveFrom: periodStart,
    effectiveTo: null,
    changeReason: 'Manager-approved target',
    createdBy: 'manager-1',
    createdAt: now,
  } as const
  const assignment = {
    id: assignmentId,
    programId: input.id,
    programVersionId: versionId,
    organizationId: 'org-1',
    propertyId: 'property-1',
    metric: input.metric,
    subject: input.subject,
    effectiveFrom: periodStart,
    effectiveTo: null,
    createdBy: 'manager-1',
    createdAt: now,
  } as const
  return {
    program: {
      id: input.id,
      organizationId: 'org-1',
      propertyId: 'property-1',
      name: input.name,
      description: null,
      status: 'active',
      statusReason: null,
      currentVersion: 3,
      createdBy: 'manager-1',
      createdAt: now,
      updatedAt: now,
    },
    version,
    versions: [version],
    assignments: [assignment],
    results: [
      {
        id: `result-${input.id}`,
        assignmentId,
        programId: input.id,
        programVersionId: versionId,
        organizationId: 'org-1',
        propertyId: 'property-1',
        periodStart,
        periodEnd,
        propertyTimezone: 'America/New_York',
        status: 'closed',
        targetValue: null,
        evaluation: input.evaluation,
        sourceCompleteThrough:
          input.sourceCompleteThrough === undefined
            ? periodEnd
            : input.sourceCompleteThrough,
        evaluationWatermark: now,
        closedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}

const catalogue = {
  property: { id: 'property-1', name: 'Riverside Hotel' },
  portalGroups: [{ id: 'group-1', name: 'Front desk', portalIds: ['portal-grouped'] }],
  portals: [
    { id: 'portal-grouped', name: 'Front desk QR' },
    { id: 'portal-ungrouped', name: 'Breakfast cards' },
    { id: 'portal-new', name: 'Lobby NFC' },
  ],
} as const

describe('Goal Results Matrix', () => {
  it('presents all three measures and scopes without a rank, composite, or progress ring', () => {
    const matrix = buildGoalResultsMatrix({
      ...catalogue,
      programs: [
        bundle({
          id: 'scans',
          name: 'Property scans',
          metric: 'qualified_scans',
          target: 100,
          subject: { kind: 'property', propertyId: 'property-1' },
          evaluation: {
            state: 'eligible',
            value: 0,
            sampleCount: 0,
            achieved: false,
            reason: null,
          },
        }),
        bundle({
          id: 'rating-count',
          name: 'Front desk ratings',
          metric: 'portal_rating_count',
          target: 20,
          subject: { kind: 'portal_group', portalGroupId: 'group-1' },
          evaluation: {
            state: 'eligible',
            value: 24,
            sampleCount: 24,
            achieved: true,
            reason: null,
          },
        }),
        bundle({
          id: 'rating-average',
          name: 'Breakfast rating',
          metric: 'portal_rating_average',
          target: 4.3,
          subject: { kind: 'portal', portalId: 'portal-ungrouped' },
          evaluation: {
            state: 'eligible',
            value: 4.5,
            sampleCount: 12,
            achieved: true,
            reason: null,
          },
        }),
      ],
    })

    expect(matrix.months).toHaveLength(1)
    expect(matrix.months[0]?.rows).toEqual([
      expect.objectContaining({
        scope: 'property',
        subjectName: 'Riverside Hotel',
        metric: 'qualified_scans',
        availability: 'ready',
        evidence: { kind: 'count', value: 0, sampleCount: 0 },
        outcome: 'not_met',
        explanation: 'Not met: 0 scans, the goal was 100.',
        monthTarget: null,
      }),
      expect.objectContaining({
        scope: 'portal_group',
        subjectName: 'Front desk',
        metric: 'portal_rating_count',
        availability: 'ready',
        evidence: { kind: 'count', value: 24, sampleCount: 24 },
        outcome: 'met',
        explanation: 'Met: 24 private ratings, the goal was 20.',
      }),
      expect.objectContaining({
        scope: 'portal',
        subjectName: 'Breakfast cards',
        metric: 'portal_rating_average',
        availability: 'ready',
        evidence: {
          kind: 'average',
          value: 4.5,
          sampleCount: 12,
          minimumSample: 10,
        },
        outcome: 'met',
        explanation: 'Met: 4.5 from 12 ratings, the goal was 4.3.',
      }),
    ])
    expect(matrix.months[0]?.rows[2]?.targetProvenance).toEqual({
      programName: 'Breakfast rating',
      programVersion: 3,
      metricDefinitionVersionId: 'metric-version-rating-average',
      targetValue: 4.3,
      effectiveFrom: periodStart,
      setAt: new Date('2026-08-02T05:00:00.000Z'),
    })
    expect(JSON.stringify(matrix)).not.toMatch(/rank|composite|progressPercent|ring/i)
  })

  it('shows and explains a month against its own target, and names who changed it', () => {
    const base = bundle({
      id: 'scans',
      name: 'Property scans',
      metric: 'qualified_scans',
      target: 100,
      subject: { kind: 'property', propertyId: 'property-1' },
      // Judged against 80, the target the month closed with.
      evaluation: {
        state: 'eligible',
        value: 90,
        sampleCount: 90,
        achieved: true,
        reason: null,
      },
    })
    const changedAt = new Date('2026-07-20T15:00:00.000Z')
    const changes = [
      { previous: 100, next: 90, by: 'elena', at: new Date('2026-07-10T15:00:00.000Z') },
      { previous: 90, next: 80, by: 'marco', at: changedAt },
    ]

    const matrix = buildGoalResultsMatrix({
      ...catalogue,
      programs: [
        {
          ...base,
          results: base.results.map((result) => ({ ...result, targetValue: 80 })),
          targetChanges: changes.map((change, index) => ({
            id: `change-${index}`,
            organizationId: 'org-1',
            propertyId: 'property-1',
            programId: 'scans',
            monthlyResultId: 'result-scans',
            changeId: `command-${index}`,
            previousTargetValue: change.previous,
            newTargetValue: change.next,
            followingOutcome: 'not_requested' as const,
            followingReason: null,
            followingVersionId: null,
            note: null,
            createdBy: change.by,
            createdAt: change.at,
          })),
        },
      ],
    })

    expect(matrix.months[0]?.rows[0]).toMatchObject({
      outcome: 'met',
      explanation: 'Met: 90 scans, the goal was 80.',
      targetProvenance: { targetValue: 80, programVersion: 3 },
      monthTarget: {
        changedAt,
        changedBy: 'marco',
        startTarget: 100,
        changeCount: 2,
      },
    })
  })

  it('dates a target from when it was set, not from a later change of subjects', () => {
    const base = bundle({
      id: 'ratings',
      name: 'Front desk ratings',
      metric: 'portal_rating_count',
      target: 20,
      subject: { kind: 'portal_group', portalGroupId: 'group-1' },
      evaluation: {
        state: 'eligible',
        value: 24,
        sampleCount: 24,
        achieved: true,
        reason: null,
      },
    })
    const setAt = new Date('2026-06-12T09:00:00.000Z')
    // The version the result is pinned to only changed the subjects: it carries
    // the measure and the target of the version before it.
    const targetSet = {
      ...base.version,
      id: 'version-target-set',
      version: 2,
      effectiveFrom: new Date('2026-06-01T04:00:00.000Z'),
      effectiveTo: periodStart,
      createdAt: setAt,
    }

    const matrix = buildGoalResultsMatrix({
      ...catalogue,
      programs: [{ ...base, versions: [targetSet, base.version] }],
    })

    expect(matrix.months[0]?.rows[0]?.targetProvenance).toMatchObject({
      programVersion: 3,
      effectiveFrom: periodStart,
      setAt,
    })
  })

  it('keeps readiness, evidence, and data-through semantics honest', () => {
    const matrix = buildGoalResultsMatrix({
      ...catalogue,
      programs: [
        bundle({
          id: 'updating',
          name: 'Updating scans',
          metric: 'qualified_scans',
          target: 10,
          subject: { kind: 'property', propertyId: 'property-1' },
          sourceCompleteThrough: new Date('2026-07-20T04:00:00.000Z'),
          evaluation: {
            state: 'updating',
            value: 7,
            sampleCount: 7,
            achieved: null,
            reason: 'reading_updating',
          },
        }),
        bundle({
          id: 'insufficient',
          name: 'Rating sample',
          metric: 'portal_rating_average',
          target: 4.2,
          subject: { kind: 'portal_group', portalGroupId: 'group-1' },
          evaluation: {
            state: 'insufficient_data',
            value: null,
            sampleCount: 6,
            achieved: null,
            reason: 'minimum_sample_not_met',
          },
        }),
        bundle({
          id: 'unavailable',
          name: 'Unavailable count',
          metric: 'portal_rating_count',
          target: 10,
          subject: { kind: 'portal', portalId: 'portal-ungrouped' },
          sourceCompleteThrough: null,
          evaluation: {
            state: 'unavailable',
            value: null,
            sampleCount: 0,
            achieved: null,
            reason: 'reading_unavailable',
          },
        }),
      ],
    })
    const rows = matrix.months[0]?.rows ?? []

    expect(rows.map(({ availability }) => availability)).toEqual([
      'updating',
      'insufficient_data',
      'temporarily_unavailable',
    ])
    expect(rows[0]).toMatchObject({
      dataThrough: new Date('2026-07-20T04:00:00.000Z'),
      outcome: 'pending',
      explanation: 'Updating: the final figure is on its way.',
    })
    expect(rows[1]).toMatchObject({
      outcome: 'pending',
      explanation: 'More ratings needed: 6 of 10.',
    })
    expect(rows[2]).toMatchObject({
      dataThrough: null,
      outcome: 'pending',
      evidence: { kind: 'count', value: null, sampleCount: 0 },
      explanation: 'Unavailable: this result cannot be decided from current evidence.',
    })
  })

  it('explains a month in plain words', () => {
    const judged = (
      id: string,
      metric: GoalMetric,
      target: number,
      evaluation: GoalMetricEvaluation,
    ) =>
      bundle({
        id,
        name: id,
        metric,
        target,
        subject: { kind: 'property', propertyId: 'property-1' },
        evaluation,
      })
    const matrix = buildGoalResultsMatrix({
      ...catalogue,
      programs: [
        judged('met', 'portal_rating_count', 60, {
          state: 'eligible',
          value: 64,
          sampleCount: 64,
          achieved: true,
          reason: null,
        }),
        judged('missed', 'portal_rating_count', 40, {
          state: 'eligible',
          value: 31,
          sampleCount: 31,
          achieved: false,
          reason: null,
        }),
        judged('updating', 'qualified_scans', 40, {
          state: 'updating',
          value: null,
          sampleCount: 0,
          achieved: null,
          reason: 'reading_updating',
        }),
        judged('thin', 'portal_rating_average', 4.5, {
          state: 'insufficient_data',
          value: null,
          sampleCount: 6,
          achieved: null,
          reason: 'minimum_sample_not_met',
        }),
      ],
    })
    const explanationOf = (programId: string) =>
      matrix.months[0]?.rows.find((row) => row.programId === programId)?.explanation

    expect(explanationOf('met')).toBe('Met: 64 private ratings, the goal was 60.')
    expect(explanationOf('missed')).toBe('Not met: 31 private ratings, the goal was 40.')
    expect(explanationOf('updating')).toBe('Updating: the final figure is on its way.')
    expect(explanationOf('thin')).toBe('More ratings needed: 6 of 10.')
    expect(JSON.stringify(matrix)).not.toMatch(
      /verified|eligible|target is at least|Insufficient data/u,
    )
  })

  it('lists no portal without a goal: a first visit shows nothing to fix', () => {
    const matrix = buildGoalResultsMatrix({ ...catalogue, programs: [] })

    expect(matrix).toEqual({ months: [] })
  })
})
