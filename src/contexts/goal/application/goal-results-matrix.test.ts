import { describe, expect, it } from 'vitest'
import type { GoalMetric, GoalSubject } from '../domain/goal-program'
import type { GoalMetricEvaluation, GoalProgramBundle } from './public-api'
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
        explanation: 'Not met: 0 verified qualified scans; target is at least 100.',
      }),
      expect.objectContaining({
        scope: 'portal_group',
        subjectName: 'Front desk',
        metric: 'portal_rating_count',
        availability: 'ready',
        evidence: { kind: 'count', value: 24, sampleCount: 24 },
        outcome: 'met',
        explanation: 'Met: 24 eligible private ratings; target is at least 20.',
      }),
      expect.objectContaining({
        scope: 'portal',
        subjectName: 'Breakfast cards',
        ungroupedPortal: true,
        metric: 'portal_rating_average',
        availability: 'ready',
        evidence: {
          kind: 'average',
          value: 4.5,
          sampleCount: 12,
          minimumSample: 10,
        },
        outcome: 'met',
        explanation: 'Met: 4.5 average from 12 eligible ratings; target is at least 4.3.',
      }),
    ])
    expect(matrix.months[0]?.rows[2]?.targetProvenance).toEqual({
      programName: 'Breakfast rating',
      programVersion: 3,
      metricDefinitionVersionId: 'metric-version-rating-average',
      targetValue: 4.3,
      effectiveFrom: periodStart,
    })
    expect(JSON.stringify(matrix)).not.toMatch(/rank|composite|progressPercent|ring/i)
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
      'insufficient',
      'unavailable',
    ])
    expect(rows[0]).toMatchObject({
      dataThrough: new Date('2026-07-20T04:00:00.000Z'),
      outcome: 'pending',
      explanation: 'Updating: 7 is the last verified value; no outcome yet.',
    })
    expect(rows[1]).toMatchObject({
      outcome: 'pending',
      explanation: 'Insufficient data: 6 of 10 required eligible ratings are ready.',
    })
    expect(rows[2]).toMatchObject({
      dataThrough: null,
      outcome: 'pending',
      evidence: { kind: 'count', value: null, sampleCount: 0 },
      explanation: 'Unavailable: this result cannot be decided from current evidence.',
    })
  })

  it('identifies grouped and ungrouped Portals with no current Goal Program', () => {
    const matrix = buildGoalResultsMatrix({
      ...catalogue,
      programs: [
        bundle({
          id: 'assigned',
          name: 'Breakfast rating',
          metric: 'portal_rating_count',
          target: 10,
          subject: { kind: 'portal', portalId: 'portal-ungrouped' },
          evaluation: {
            state: 'eligible',
            value: 10,
            sampleCount: 10,
            achieved: true,
            reason: null,
          },
        }),
      ],
    })

    expect(matrix.unassignedPortals).toEqual([
      {
        portalId: 'portal-grouped',
        portalName: 'Front desk QR',
        groupName: 'Front desk',
        message: 'No Goal Programs assigned',
      },
      {
        portalId: 'portal-new',
        portalName: 'Lobby NFC',
        groupName: null,
        message: 'No Goal Programs assigned',
      },
    ])
  })
})
