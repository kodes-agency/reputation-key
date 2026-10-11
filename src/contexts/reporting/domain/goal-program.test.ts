import { describe, expect, it } from 'vitest'
import {
  canTransitionGoalMonthlyResult,
  canTransitionGoalProgram,
  defaultGoalStartMonth,
  evaluateGoalMetric,
  firstFullMonthlyPeriodAtOrAfter,
  goalAssignmentMonthlyKey,
  goalAssignmentsOverlap,
  goalStartOptions,
  GOAL_CURRENT_MONTH_CUTOFF_DAY,
  isCompleteMonthlyPeriod,
  isGoalResultReadyToClose,
  minimumSampleForGoalMetric,
  parseGoalSubject,
  resolveGoalStart,
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

    // 04:30Z on 1 November 2026 is 00:30 CDT in Havana: local November, but
    // before the month's first instant (05:00Z, the repeated midnight's
    // standard-time occurrence). November still starts at or after it.
    it('starts the local month that begins after an instant in its repeated midnight hour', () => {
      const period = firstFullMonthlyPeriodAtOrAfter(
        new Date('2026-11-01T04:30:00.000Z'),
        'America/Havana',
      )
      expect(period.start.toISOString()).toBe('2026-11-01T05:00:00.000Z')
      expect(period.end.toISOString()).toBe('2026-12-01T05:00:00.000Z')
      expect(isCompleteMonthlyPeriod(period, 'America/Havana')).toBe(true)
    })

    it('keeps a full leap-year month across the European spring DST change', () => {
      const period = firstFullMonthlyPeriodAtOrAfter(
        new Date('2028-02-29T12:00:00.000Z'),
        'Europe/Sofia',
      )
      expect(period.start.toISOString()).toBe('2028-02-29T22:00:00.000Z')
      expect(period.end.toISOString()).toBe('2028-03-31T21:00:00.000Z')
      expect(isCompleteMonthlyPeriod(period, 'Europe/Sofia')).toBe(true)
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

  describe('start month', () => {
    const SOFIA = 'Europe/Sofia'
    // Sofia is UTC+3 in October 2026 and UTC+2 from the 25th.
    const OCTOBER = {
      start: new Date('2026-09-30T21:00:00.000Z'),
      end: new Date('2026-10-31T22:00:00.000Z'),
    }
    const NOVEMBER = {
      start: new Date('2026-10-31T22:00:00.000Z'),
      end: new Date('2026-11-30T22:00:00.000Z'),
    }

    it('offers the current local month and the next one, each a complete month', () => {
      const options = goalStartOptions(new Date('2026-10-11T09:00:00.000Z'), SOFIA)

      expect(options).toEqual({
        current: { monthKey: '2026-10', period: OCTOBER },
        next: { monthKey: '2026-11', period: NOVEMBER },
      })
      expect(isCompleteMonthlyPeriod(options.current.period, SOFIA)).toBe(true)
      expect(isCompleteMonthlyPeriod(options.next.period, SOFIA)).toBe(true)
    })

    it('rolls the next month over the year end', () => {
      const options = goalStartOptions(new Date('2026-12-15T12:00:00.000Z'), 'UTC')

      expect(options.current.monthKey).toBe('2026-12')
      expect(options.next).toEqual({
        monthKey: '2027-01',
        period: {
          start: new Date('2027-01-01T00:00:00.000Z'),
          end: new Date('2027-02-01T00:00:00.000Z'),
        },
      })
    })

    it('defaults to this month on local day 20 and to next month on day 21', () => {
      expect(GOAL_CURRENT_MONTH_CUTOFF_DAY).toBe(20)
      expect(defaultGoalStartMonth(new Date('2026-10-01T00:00:00.000Z'), 'UTC')).toBe(
        '2026-10',
      )
      expect(defaultGoalStartMonth(new Date('2026-10-20T23:59:59.000Z'), 'UTC')).toBe(
        '2026-10',
      )
      expect(defaultGoalStartMonth(new Date('2026-10-21T00:00:00.000Z'), 'UTC')).toBe(
        '2026-11',
      )
    })

    it('uses the Property time zone, not UTC, for the day', () => {
      // 22:30 UTC on the 20th is already 01:30 on the 21st in Sofia.
      const lateOnTheTwentieth = new Date('2026-10-20T22:30:00.000Z')
      expect(defaultGoalStartMonth(lateOnTheTwentieth, 'UTC')).toBe('2026-10')
      expect(defaultGoalStartMonth(lateOnTheTwentieth, SOFIA)).toBe('2026-11')

      // 02:00 UTC on the 21st is still 22:00 on the 20th in New York.
      const earlyOnTheTwentyFirst = new Date('2026-10-21T02:00:00.000Z')
      expect(defaultGoalStartMonth(earlyOnTheTwentyFirst, 'UTC')).toBe('2026-11')
      expect(defaultGoalStartMonth(earlyOnTheTwentyFirst, 'America/New_York')).toBe(
        '2026-10',
      )
    })

    it('resolves the current or the next local month from its key', () => {
      const now = new Date('2026-10-25T09:00:00.000Z')

      expect(resolveGoalStart(now, SOFIA, '2026-10')).toEqual({
        ok: true,
        period: OCTOBER,
      })
      expect(resolveGoalStart(now, SOFIA, '2026-11')).toEqual({
        ok: true,
        period: NOVEMBER,
      })
    })

    it('a month key that is neither the current nor the next local month is refused', () => {
      const now = new Date('2026-10-25T09:00:00.000Z')

      for (const stale of ['2026-09', '2026-12', '2025-10', '2026-10-25', 'next']) {
        expect(resolveGoalStart(now, SOFIA, stale)).toEqual({
          ok: false,
          reason: 'start_month_changed',
        })
      }
      // 22:30 UTC on 31 October is already November in Sofia, so the October
      // a form opened that afternoon no longer exists as a choice.
      expect(
        resolveGoalStart(new Date('2026-10-31T22:30:00.000Z'), SOFIA, '2026-10'),
      ).toEqual({ ok: false, reason: 'start_month_changed' })
    })

    it('keeps the next full month when no start month is given', () => {
      const now = new Date('2026-10-11T09:00:00.000Z')

      expect(resolveGoalStart(now, SOFIA)).toEqual({ ok: true, period: NOVEMBER })
      expect(resolveGoalStart(OCTOBER.start, SOFIA)).toEqual({
        ok: true,
        period: firstFullMonthlyPeriodAtOrAfter(OCTOBER.start, SOFIA),
      })
    })

    // 04:30Z on 1 November 2026 is 00:30 CDT in Havana: local November, in the
    // first pass of the repeated midnight hour. November begins at the later
    // occurrence (05:00Z), so a goal for "this month" has not started yet and
    // its Program must wait as scheduled rather than open a month early.
    it('this month on a repeated-midnight first hour stays scheduled', () => {
      const now = new Date('2026-11-01T04:30:00.000Z')
      const start = resolveGoalStart(now, 'America/Havana', '2026-11')

      expect(defaultGoalStartMonth(now, 'America/Havana')).toBe('2026-11')
      expect(start).toEqual({
        ok: true,
        period: {
          start: new Date('2026-11-01T05:00:00.000Z'),
          end: new Date('2026-12-01T05:00:00.000Z'),
        },
      })
      expect(start.ok && start.period.start.getTime() > now.getTime()).toBe(true)
    })
  })

  describe('lifecycles', () => {
    it.each([
      ['scheduled', 'active'],
      ['scheduled', 'ended'],
      ['active', 'paused'],
      ['paused', 'active'],
      ['active', 'ended'],
      ['paused', 'ended'],
    ] as const)('allows Goal Program %s → %s', (from, to) => {
      expect(canTransitionGoalProgram(from, to)).toBe(true)
    })

    it.each([
      ['scheduled', 'paused'],
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
