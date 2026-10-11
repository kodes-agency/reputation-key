import { describe, expect, it, vi } from 'vitest'
import type { GoalMetric, GoalSubject } from '../../domain/goal-program'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import { readGoalMonthPreview, type GoalMonthPreviewDeps } from './goal-month-preview'
import { GoalProgramError, type GoalActor } from './goal-programs'
import type { GovernedGoalMetricResult } from './query-goal-metric'

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}
const PROPERTY_ID = 'property-1'
const lobby: GoalSubject = { kind: 'portal', portalId: 'portal-lobby' }
// 11 October 2026, midday in Sofia (UTC+3 until the 25th, UTC+2 after).
const NOW = new Date('2026-10-11T09:00:00.000Z')
const OCTOBER = {
  start: new Date('2026-09-30T21:00:00.000Z'),
  end: new Date('2026-10-31T22:00:00.000Z'),
}

const reading = (patch: Partial<GovernedGoalMetricResult>): GovernedGoalMetricResult => ({
  definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
  metricKey: 'portal.qualified_scan',
  state: 'updating',
  exactValue: 412,
  sampleCount: 412,
  minimumSample: 0,
  sourceCompleteThrough: null,
  reason: 'source_reconciling',
  ...patch,
})

function setup(metricResult: GovernedGoalMetricResult = reading({})) {
  const deps = {
    policy: { authorize: vi.fn(async () => undefined) },
    subjects: {
      getTimezone: vi.fn(async (): Promise<string | null> => 'Europe/Sofia'),
      subjectBelongsToProperty: vi.fn(async () => true),
    },
    metrics: {
      queryGoalMetric: vi.fn(async () => metricResult),
      getApprovedGoalVersion: vi.fn(async (versionId: string) => ({
        definition: { id: `definition-${versionId}` },
        version: {
          id: versionId,
          minimumSample:
            versionId === METRIC_VERSION_IDS.portalRatingAverageGoal ? 10 : 0,
        },
      })),
    },
    now: () => NOW,
  }
  return { deps, run: deps as unknown as GoalMonthPreviewDeps }
}

const input = (metric: GoalMetric = 'qualified_scans') => ({
  propertyId: PROPERTY_ID,
  metric,
  subject: lobby,
})

describe('readGoalMonthPreview', () => {
  it('reads the current local month so far for one subject, before a goal exists', async () => {
    const { deps, run } = setup()

    const preview = await readGoalMonthPreview(run, input(), actor)

    expect(preview).toEqual({
      metric: 'qualified_scans',
      period: OCTOBER,
      timezone: 'Europe/Sofia',
      asOf: NOW,
      reading: { kind: 'live', value: 412, sampleCount: 412 },
    })
    expect(deps.policy.authorize).toHaveBeenCalledWith({
      actor,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
    expect(deps.metrics.queryGoalMetric).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      subject: { kind: 'portal', portalId: 'portal-lobby' },
      periodStart: OCTOBER.start,
      periodEnd: OCTOBER.end,
    })
  })

  it('refuses an actor who may not set goals before reading anything', async () => {
    const { deps, run } = setup()
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(readGoalMonthPreview(run, input(), actor)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(deps.subjects.getTimezone).not.toHaveBeenCalled()
    expect(deps.metrics.queryGoalMetric).not.toHaveBeenCalled()
  })

  it('refuses a subject that is not part of the Property', async () => {
    const { deps, run } = setup()
    deps.subjects.subjectBelongsToProperty.mockResolvedValueOnce(false)

    await expect(readGoalMonthPreview(run, input(), actor)).rejects.toMatchObject({
      code: 'invalid_subject',
    })
    expect(deps.metrics.queryGoalMetric).not.toHaveBeenCalled()
  })

  it('refuses a Property that cannot be found', async () => {
    const { deps, run } = setup()
    deps.subjects.getTimezone.mockResolvedValueOnce(null)

    await expect(readGoalMonthPreview(run, input(), actor)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(deps.metrics.queryGoalMetric).not.toHaveBeenCalled()
  })

  it('refuses a measure with no approved version', async () => {
    const { deps, run } = setup()
    deps.metrics.getApprovedGoalVersion.mockResolvedValueOnce(
      null as unknown as Awaited<ReturnType<typeof deps.metrics.getApprovedGoalVersion>>,
    )

    await expect(readGoalMonthPreview(run, input(), actor)).rejects.toMatchObject({
      code: 'metric_unavailable',
    })
    expect(deps.metrics.queryGoalMetric).not.toHaveBeenCalled()
  })

  it.each(['unavailable', 'quarantined'] as const)(
    'says the figure is unavailable when the read is %s, never a zero',
    async (state) => {
      const { run } = setup(reading({ state, exactValue: 0, sampleCount: 0 }))

      const preview = await readGoalMonthPreview(run, input(), actor)

      expect(preview.reading).toEqual({ kind: 'unavailable' })
    },
  )

  it('does not show an average the month so far cannot support', async () => {
    const { deps, run } = setup(
      reading({
        definitionVersionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
        metricKey: 'portal.rating_average',
        exactValue: 4.8,
        sampleCount: 6,
        minimumSample: 10,
      }),
    )

    const preview = await readGoalMonthPreview(run, input('portal_rating_average'), actor)

    expect(preview.reading).toEqual({
      kind: 'too_few',
      sampleCount: 6,
      minimumSample: 10,
    })
    expect(deps.metrics.queryGoalMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionVersionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
      }),
    )
  })
})
