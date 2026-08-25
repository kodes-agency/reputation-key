import { describe, expect, it } from 'vitest'
import {
  canTransitionGoalMonthlyResult,
  canTransitionGoalProgram,
  evaluateGoalMetric,
  firstFullMonthlyPeriodAtOrAfter,
  goalAssignmentMonthlyKey,
  goalAssignmentsOverlap,
  isCompleteMonthlyPeriod,
  isGoalResultReadyToClose,
  minimumSampleForGoalMetric,
  parseGoalSubject,
  validateGoalTarget,
  type GoalAssignmentWindow,
  type GoalMetric,
  type GoalSubject,
} from './goal-program'

describe('canonical Goal Program contract', () => {
  describe('targets', () => {
    it.each<readonly [GoalMetric, number]>([
      ['qualified_scans', 1],
      ['qualified_scans', 120],
      ['portal_rating_count', 1],
      ['portal_rating_count', 50],
      ['portal_rating_average', 1],
      ['portal_rating_average', 4.3],
      ['portal_rating_average', 5],
    ])('accepts %s target %s', (metric, target) => {
      expect(validateGoalTarget(metric, target)).toEqual({
        ok: true,
        normalizedTarget: target,
      })
    })

    it.each<readonly [GoalMetric, number, string]>([
      ['qualified_scans', 0, 'count_target_not_positive_integer'],
      ['qualified_scans', 1.5, 'count_target_not_positive_integer'],
      ['portal_rating_count', -1, 'count_target_not_positive_integer'],
      ['portal_rating_average', 0.9, 'average_target_out_of_range'],
      ['portal_rating_average', 5.1, 'average_target_out_of_range'],
      ['portal_rating_average', 4.25, 'average_target_precision'],
      ['portal_rating_average', Number.NaN, 'target_not_finite'],
    ])('rejects %s target %s', (metric, target, reason) => {
      expect(validateGoalTarget(metric, target)).toEqual({ ok: false, reason })
    })
  })

  describe('evaluation', () => {
    it('treats verified zero as an eligible count result', () => {
      expect(
        evaluateGoalMetric({
          metric: 'qualified_scans',
          target: 10,
          reading: { dataQuality: 'eligible', exactValue: 0, sampleCount: 0 },
        }),
      ).toEqual({
        state: 'eligible',
        value: 0,
        sampleCount: 0,
        achieved: false,
        reason: null,
      })
    })

    it('requires ten eligible ratings for an average', () => {
      expect(minimumSampleForGoalMetric('portal_rating_average')).toBe(10)
      expect(
        evaluateGoalMetric({
          metric: 'portal_rating_average',
          target: 4.2,
          reading: { dataQuality: 'eligible', exactValue: 4.8, sampleCount: 9 },
        }),
      ).toEqual({
        state: 'insufficient_data',
        value: null,
        sampleCount: 9,
        achieved: null,
        reason: 'minimum_sample_not_met',
      })
    })

    it('evaluates an eligible rating average without averaging averages', () => {
      expect(
        evaluateGoalMetric({
          metric: 'portal_rating_average',
          target: 4.2,
          reading: { dataQuality: 'eligible', exactValue: 4.3, sampleCount: 27 },
        }),
      ).toMatchObject({ state: 'eligible', value: 4.3, achieved: true })
    })

    it('preserves a last-safe value while updating but does not decide an outcome', () => {
      expect(
        evaluateGoalMetric({
          metric: 'portal_rating_count',
          target: 20,
          reading: { dataQuality: 'updating', exactValue: 12, sampleCount: 12 },
        }),
      ).toEqual({
        state: 'updating',
        value: 12,
        sampleCount: 12,
        achieved: null,
        reason: 'reading_updating',
      })
    })

    it.each([
      [null, 'unavailable'],
      [
        { dataQuality: 'quarantined' as const, exactValue: 4.5, sampleCount: 20 },
        'quarantined',
      ],
      [
        { dataQuality: 'eligible' as const, exactValue: 0, sampleCount: 20 },
        'quarantined',
      ],
    ])('never fabricates an average for %j', (reading, state) => {
      expect(
        evaluateGoalMetric({ metric: 'portal_rating_average', target: 4, reading }),
      ).toMatchObject({ state, achieved: null })
    })
  })

  describe('monthly calendar', () => {
    it('starts next month for a mid-month change', () => {
      const period = firstFullMonthlyPeriodAtOrAfter(
        new Date('2026-03-15T16:00:00.000Z'),
        'America/New_York',
      )
      expect(period.start.toISOString()).toBe('2026-04-01T04:00:00.000Z')
      expect(period.end.toISOString()).toBe('2026-05-01T04:00:00.000Z')
      expect(isCompleteMonthlyPeriod(period, 'America/New_York')).toBe(true)
    })

    it('allows the month beginning at an exact property-local boundary', () => {
      const period = firstFullMonthlyPeriodAtOrAfter(
        new Date('2026-11-01T04:00:00.000Z'),
        'America/New_York',
      )
      expect(period.start.toISOString()).toBe('2026-11-01T04:00:00.000Z')
      expect(period.end.toISOString()).toBe('2026-12-01T05:00:00.000Z')
    })

    it('rejects partial monthly windows', () => {
      expect(
        isCompleteMonthlyPeriod(
          {
            start: new Date('2026-04-02T04:00:00.000Z'),
            end: new Date('2026-05-01T04:00:00.000Z'),
          },
          'America/New_York',
        ),
      ).toBe(false)
    })
  })

  describe('lifecycles', () => {
    it.each([
      ['scheduled', 'active'],
      ['active', 'paused'],
      ['paused', 'active'],
      ['active', 'ended'],
      ['paused', 'ended'],
    ] as const)('allows Goal Program %s → %s', (from, to) => {
      expect(canTransitionGoalProgram(from, to)).toBe(true)
    })

    it.each([
      ['scheduled', 'paused'],
      ['scheduled', 'ended'],
      ['ended', 'active'],
      ['active', 'scheduled'],
    ] as const)('denies Goal Program %s → %s', (from, to) => {
      expect(canTransitionGoalProgram(from, to)).toBe(false)
    })

    it('requires Open → Reconciling → Closed', () => {
      expect(canTransitionGoalMonthlyResult('open', 'reconciling')).toBe(true)
      expect(canTransitionGoalMonthlyResult('reconciling', 'closed')).toBe(true)
      expect(canTransitionGoalMonthlyResult('open', 'closed')).toBe(false)
      expect(canTransitionGoalMonthlyResult('closed', 'reconciling')).toBe(false)
    })
  })

  describe('subjects and assignments', () => {
    it('accepts Property, Portal Group, and Portal but rejects Person and Team', () => {
      expect(parseGoalSubject('property', 'property-1', 'property-1')).toEqual({
        kind: 'property',
        propertyId: 'property-1',
      })
      expect(parseGoalSubject('portal_group', 'group-1', 'property-1')).toEqual({
        kind: 'portal_group',
        portalGroupId: 'group-1',
      })
      expect(parseGoalSubject('portal', 'portal-1', 'property-1')).toEqual({
        kind: 'portal',
        portalId: 'portal-1',
      })
      expect(parseGoalSubject('person', 'staff-1', 'property-1')).toBeNull()
      expect(parseGoalSubject('team', 'team-1', 'property-1')).toBeNull()
      expect(parseGoalSubject('property', 'property-2', 'property-1')).toBeNull()
    })

    const assignment = (
      subject: GoalSubject,
      metric: GoalMetric,
      from: string,
      to: string | null,
    ): GoalAssignmentWindow => ({
      subject,
      metric,
      effectiveFrom: new Date(from),
      effectiveTo: to ? new Date(to) : null,
    })

    it('detects overlapping half-open assignments for one subject and metric', () => {
      const first = assignment(
        { kind: 'portal', portalId: 'portal-1' },
        'qualified_scans',
        '2026-01-01T00:00:00.000Z',
        '2026-03-01T00:00:00.000Z',
      )
      expect(
        goalAssignmentsOverlap(
          first,
          assignment(
            { kind: 'portal', portalId: 'portal-1' },
            'qualified_scans',
            '2026-02-01T00:00:00.000Z',
            null,
          ),
        ),
      ).toBe(true)
      expect(
        goalAssignmentsOverlap(
          first,
          assignment(
            { kind: 'portal', portalId: 'portal-1' },
            'qualified_scans',
            '2026-03-01T00:00:00.000Z',
            null,
          ),
        ),
      ).toBe(false)
      expect(
        goalAssignmentsOverlap(
          first,
          assignment(
            { kind: 'portal', portalId: 'portal-1' },
            'portal_rating_count',
            '2026-02-01T00:00:00.000Z',
            null,
          ),
        ),
      ).toBe(false)
    })

    it('builds a stable monthly overlap identity', () => {
      expect(
        goalAssignmentMonthlyKey(
          {
            subject: { kind: 'portal_group', portalGroupId: 'group-1' },
            metric: 'portal_rating_average',
          },
          new Date('2026-04-01T00:00:00.000Z'),
        ),
      ).toBe('portal_group:group-1:portal_rating_average:2026-04-01T00:00:00.000Z')
    })
  })

  it('waits 24 hours after period end and for the source watermark', () => {
    const periodEnd = new Date('2026-05-01T04:00:00.000Z')
    expect(
      isGoalResultReadyToClose({
        periodEnd,
        now: new Date('2026-05-02T03:59:59.999Z'),
        sourceWatermark: new Date('2026-05-02T04:00:00.000Z'),
      }),
    ).toBe(false)
    expect(
      isGoalResultReadyToClose({
        periodEnd,
        now: new Date('2026-05-02T04:00:00.000Z'),
        sourceWatermark: new Date('2026-05-01T03:59:59.999Z'),
      }),
    ).toBe(false)
    expect(
      isGoalResultReadyToClose({
        periodEnd,
        now: new Date('2026-05-02T04:00:00.000Z'),
        sourceWatermark: periodEnd,
      }),
    ).toBe(true)
  })
})
