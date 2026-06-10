import { describe, it, expect } from 'vitest'
import {
  buildProgressQuery,
  buildProgressQueryForInstance,
  computeProgressValue,
  shouldEmitCompleted,
} from './progress-strategy'
import type { Goal } from './types'
import type { AggregationFunction } from '#/shared/domain/metric-keys'
import {
  organizationId,
  propertyId,
  portalId,
  portalGroupId,
  goalId,
  userId,
} from '#/shared/domain/ids'

// ── Fixtures ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-15T12:00:00Z')
const PERIOD_START = new Date('2026-06-01T00:00:00Z')
const PERIOD_END = new Date('2026-06-30T23:59:59Z')
const INSTANCE_START = new Date('2026-07-01T00:00:00Z')
const INSTANCE_END = new Date('2026-07-31T23:59:59Z')

function makeGoal(overrides: Partial<Goal> & { goalType: Goal['goalType'] }): Goal {
  return {
    id: goalId('goal-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    portalId: null,
    portalGroupId: null,
    name: 'Test goal',
    description: null,
    createdBy: userId('user-1'),
    aggregationFunction: 'sum' as AggregationFunction,
    metricKey: 'portal.scan',
    targetValue: 100,
    status: 'active',
    periodStart: null,
    periodEnd: null,
    recurrenceRule: null,
    rollingWindowDays: null,
    parentGoalId: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const OPEN_GOAL = makeGoal({ goalType: 'open' })

const ONE_SHOT_GOAL = makeGoal({
  goalType: 'one_shot',
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
})

const ROLLING_GOAL = makeGoal({
  goalType: 'rolling',
  rollingWindowDays: 30,
})

const RECURRING_TEMPLATE = makeGoal({
  goalType: 'recurring',
  recurrenceRule: { frequency: 'monthly' },
})

const RECURRING_INSTANCE = makeGoal({
  goalType: 'recurring',
  recurrenceRule: { frequency: 'monthly' },
  periodStart: INSTANCE_START,
  periodEnd: INSTANCE_END,
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('buildProgressQuery', () => {
  // ── Goal type × time filter ───────────────────────────────────────────

  describe('time filter by goal type', () => {
    it('open goal → no time filter', () => {
      const result = buildProgressQuery(OPEN_GOAL)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter).toEqual({ tag: 'none' })
    })

    it('one_shot goal → bounded period', () => {
      const result = buildProgressQuery(ONE_SHOT_GOAL)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter).toEqual({
        tag: 'bounded',
        start: PERIOD_START,
        end: PERIOD_END,
      })
    })

    it('rolling goal → sliding window', () => {
      const result = buildProgressQuery(ROLLING_GOAL)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter).toEqual({ tag: 'sliding_window', days: 30 })
    })

    it('recurring instance (with period) → bounded period', () => {
      const result = buildProgressQuery(RECURRING_INSTANCE)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter).toEqual({
        tag: 'bounded',
        start: INSTANCE_START,
        end: INSTANCE_END,
      })
    })

    it('recurring template (no period) → returns error', () => {
      const result = buildProgressQuery(RECURRING_TEMPLATE)
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toEqual({
        tag: 'recurring_template_without_instance_period',
      })
    })

    it('recurring with only periodStart (no periodEnd) → returns error', () => {
      const goal = makeGoal({
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
        periodStart: PERIOD_START,
        periodEnd: null,
      })
      const result = buildProgressQuery(goal)
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toEqual({
        tag: 'recurring_template_without_instance_period',
      })
    })
  })

  // ── 16 combinations: 4 goal types × 4 aggregation functions ──────────

  describe('4×4 matrix: goalType × aggregationFunction', () => {
    const aggregations: AggregationFunction[] = ['sum', 'count', 'max', 'avg']

    // Open goals — all 4 aggregations
    for (const agg of aggregations) {
      it(`open + ${agg.toUpperCase()} → no time filter, ${agg} aggregate`, () => {
        const goal = makeGoal({ goalType: 'open', aggregationFunction: agg })
        const result = buildProgressQuery(goal)
        expect(result.isOk()).toBe(true)
        const query = result._unsafeUnwrap()
        expect(query.timeFilter).toEqual({ tag: 'none' })
        expect(query.aggregateFunction).toBe(agg)
        expect(query.metricKey).toBe('portal.scan')
      })
    }

    // One-shot goals — all 4 aggregations (using portal.rating for avg which allows it)
    it('one_shot + SUM → bounded, sum', () => {
      const goal = makeGoal({
        goalType: 'one_shot',
        aggregationFunction: 'sum',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      })
      const result = buildProgressQuery(goal)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter.tag).toBe('bounded')
      expect(query.aggregateFunction).toBe('sum')
    })

    it('one_shot + COUNT → bounded, count', () => {
      const goal = makeGoal({
        goalType: 'one_shot',
        aggregationFunction: 'count',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      })
      const result = buildProgressQuery(goal)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter.tag).toBe('bounded')
      expect(query.aggregateFunction).toBe('count')
    })

    it('one_shot + MAX → bounded, max', () => {
      const goal = makeGoal({
        goalType: 'one_shot',
        aggregationFunction: 'max',
        metricKey: 'portal.rating',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      })
      const result = buildProgressQuery(goal)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter.tag).toBe('bounded')
      expect(query.aggregateFunction).toBe('max')
    })

    it('one_shot + AVG → bounded, avg', () => {
      const goal = makeGoal({
        goalType: 'one_shot',
        aggregationFunction: 'avg',
        metricKey: 'portal.rating',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      })
      const result = buildProgressQuery(goal)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter.tag).toBe('bounded')
      expect(query.aggregateFunction).toBe('avg')
    })

    // Rolling goals — all 4 aggregations
    for (const agg of aggregations) {
      it(`rolling + ${agg.toUpperCase()} → sliding window, ${agg} aggregate`, () => {
        const goal = makeGoal({
          goalType: 'rolling',
          aggregationFunction: agg,
          rollingWindowDays: 14,
          metricKey: agg === 'max' || agg === 'avg' ? 'portal.rating' : 'portal.scan',
        })
        const result = buildProgressQuery(goal)
        expect(result.isOk()).toBe(true)
        const query = result._unsafeUnwrap()
        expect(query.timeFilter).toEqual({ tag: 'sliding_window', days: 14 })
        expect(query.aggregateFunction).toBe(agg)
      })
    }

    // Recurring instances — all 4 aggregations
    it('recurring instance + SUM → bounded, sum', () => {
      const result = buildProgressQuery(
        makeGoal({
          goalType: 'recurring',
          aggregationFunction: 'sum',
          recurrenceRule: { frequency: 'weekly' },
          periodStart: INSTANCE_START,
          periodEnd: INSTANCE_END,
        }),
      )
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter.tag).toBe('bounded')
      expect(query.aggregateFunction).toBe('sum')
    })

    it('recurring instance + COUNT → bounded, count', () => {
      const result = buildProgressQuery(
        makeGoal({
          goalType: 'recurring',
          aggregationFunction: 'count',
          recurrenceRule: { frequency: 'weekly' },
          periodStart: INSTANCE_START,
          periodEnd: INSTANCE_END,
        }),
      )
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter.tag).toBe('bounded')
      expect(query.aggregateFunction).toBe('count')
    })

    it('recurring instance + MAX → bounded, max', () => {
      const result = buildProgressQuery(
        makeGoal({
          goalType: 'recurring',
          aggregationFunction: 'max',
          metricKey: 'portal.rating',
          recurrenceRule: { frequency: 'weekly' },
          periodStart: INSTANCE_START,
          periodEnd: INSTANCE_END,
        }),
      )
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter.tag).toBe('bounded')
      expect(query.aggregateFunction).toBe('max')
    })

    it('recurring instance + AVG → bounded, avg', () => {
      const result = buildProgressQuery(
        makeGoal({
          goalType: 'recurring',
          aggregationFunction: 'avg',
          metricKey: 'portal.rating',
          recurrenceRule: { frequency: 'weekly' },
          periodStart: INSTANCE_START,
          periodEnd: INSTANCE_END,
        }),
      )
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter.tag).toBe('bounded')
      expect(query.aggregateFunction).toBe('avg')
    })
  })

  // ── Scope filter ──────────────────────────────────────────────────────

  describe('scopeFilter', () => {
    it('property scope — all FKs null except propertyId', () => {
      const result = buildProgressQuery(OPEN_GOAL)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.scopeFilter).toEqual({
        propertyId: propertyId('prop-1'),
        portalId: null,
        portalGroupId: null,
        staffId: null,
      })
    })

    it('portal scope', () => {
      const goal = makeGoal({
        goalType: 'open',
        portalId: portalId('portal-1'),
      })
      const result = buildProgressQuery(goal)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.scopeFilter.portalId).toEqual(portalId('portal-1'))
      expect(query.scopeFilter.portalGroupId).toBeNull()
      expect(query.scopeFilter.staffId).toBeNull()
    })

    it('portal_group scope', () => {
      const goal = makeGoal({
        goalType: 'open',
        portalGroupId: portalGroupId('pg-1'),
        metricKey: 'portal.scan',
      })
      const result = buildProgressQuery(goal)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.scopeFilter.portalGroupId).toEqual(portalGroupId('pg-1'))
      expect(query.scopeFilter.portalId).toBeNull()
      expect(query.scopeFilter.staffId).toBeNull()
    })
  })

  // ── Metric key passthrough ────────────────────────────────────────────

  describe('metricKey', () => {
    it('passes metricKey through unchanged', () => {
      const goal = makeGoal({
        goalType: 'open',
        metricKey: 'portal.feedback',
        aggregationFunction: 'sum',
      })
      const result = buildProgressQuery(goal)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.metricKey).toBe('portal.feedback')
    })
  })

  // ── buildProgressQueryForInstance ─────────────────────────────────────

  describe('buildProgressQueryForInstance', () => {
    it('builds bounded query for a recurring instance', () => {
      const result = buildProgressQueryForInstance(
        RECURRING_TEMPLATE,
        INSTANCE_START,
        INSTANCE_END,
      )
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.timeFilter).toEqual({
        tag: 'bounded',
        start: INSTANCE_START,
        end: INSTANCE_END,
      })
      expect(query.aggregateFunction).toBe('sum')
      expect(query.metricKey).toBe('portal.scan')
    })

    it('returns error if used on a non-recurring goal', () => {
      const result = buildProgressQueryForInstance(
        OPEN_GOAL,
        INSTANCE_START,
        INSTANCE_END,
      )
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toEqual({ tag: 'non_recurring_goal' })
    })

    it('preserves all scope fields', () => {
      const goal = makeGoal({
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
        portalId: portalId('p-1'),
        portalGroupId: portalGroupId('pg-1'),
        metricKey: 'portal.scan',
      })
      const result = buildProgressQueryForInstance(goal, INSTANCE_START, INSTANCE_END)
      expect(result.isOk()).toBe(true)
      const query = result._unsafeUnwrap()
      expect(query.scopeFilter).toEqual({
        propertyId: propertyId('prop-1'),
        portalId: portalId('p-1'),
        portalGroupId: portalGroupId('pg-1'),
        staffId: null,
      })
    })
  })
})

describe('computeProgressValue', () => {
  const rows = [{ value: 10 }, { value: 20 }, { value: 30 }]

  it('SUM — returns total of all values', () => {
    expect(computeProgressValue('sum', rows)).toBe(60)
  })

  it('SUM — single row', () => {
    expect(computeProgressValue('sum', [{ value: 5 }])).toBe(5)
  })

  it('COUNT — returns number of rows', () => {
    expect(computeProgressValue('count', rows)).toBe(3)
  })

  it('COUNT — empty rows returns 0', () => {
    expect(computeProgressValue('count', [])).toBe(0)
  })

  it('MAX — returns largest value', () => {
    expect(computeProgressValue('max', rows)).toBe(30)
  })

  it('MAX — single row', () => {
    expect(computeProgressValue('max', [{ value: 42 }])).toBe(42)
  })

  it('AVG — returns sum/count (manual division)', () => {
    // (10 + 20 + 30) / 3 = 20
    expect(computeProgressValue('avg', rows)).toBe(20)
  })

  it('AVG — non-integer result', () => {
    // (1 + 2) / 2 = 1.5
    expect(computeProgressValue('avg', [{ value: 1 }, { value: 2 }])).toBe(1.5)
  })

  it('AVG — empty rows returns 0', () => {
    expect(computeProgressValue('avg', [])).toBe(0)
  })

  it('SUM — empty rows returns 0', () => {
    expect(computeProgressValue('sum', [])).toBe(0)
  })

  it('MAX — empty rows returns 0', () => {
    expect(computeProgressValue('max', [])).toBe(0)
  })

  it('AVG — single row returns that value', () => {
    expect(computeProgressValue('avg', [{ value: 7 }])).toBe(7)
  })

  it('handles rows with zero values correctly', () => {
    expect(computeProgressValue('sum', [{ value: 0 }, { value: 0 }])).toBe(0)
    expect(computeProgressValue('max', [{ value: 0 }, { value: 0 }])).toBe(0)
    expect(computeProgressValue('avg', [{ value: 0 }, { value: 0 }])).toBe(0)
    expect(computeProgressValue('count', [{ value: 0 }, { value: 0 }])).toBe(2)
  })

  it('handles negative values', () => {
    expect(computeProgressValue('sum', [{ value: -5 }, { value: 3 }])).toBe(-2)
    expect(computeProgressValue('max', [{ value: -5 }, { value: 3 }])).toBe(3)
    expect(computeProgressValue('avg', [{ value: -5 }, { value: 3 }])).toBe(-1)
  })

  it('SUM — large array (1000 items)', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ value: i + 1 }))
    // sum of 1..1000 = 500500
    expect(computeProgressValue('sum', rows)).toBe(500500)
  })

  it('MAX — all-negative values returns the least negative', () => {
    const rows = [{ value: -10 }, { value: -3 }, { value: -99 }]
    expect(computeProgressValue('max', rows)).toBe(-3)
  })
})

describe('shouldEmitCompleted', () => {
  // ── 8 combos: goalType × aggregation (sum | avg) ───────────────────────

  it('open + sum → true', () => {
    const goal = makeGoal({ goalType: 'open', aggregationFunction: 'sum' })
    expect(shouldEmitCompleted(goal)).toBe(true)
  })

  it('open + avg → true', () => {
    const goal = makeGoal({
      goalType: 'open',
      aggregationFunction: 'avg',
      metricKey: 'portal.rating',
    })
    expect(shouldEmitCompleted(goal)).toBe(true)
  })

  it('rolling + sum → true', () => {
    const goal = makeGoal({
      goalType: 'rolling',
      aggregationFunction: 'sum',
      rollingWindowDays: 30,
    })
    expect(shouldEmitCompleted(goal)).toBe(true)
  })

  it('rolling + avg → true', () => {
    const goal = makeGoal({
      goalType: 'rolling',
      aggregationFunction: 'avg',
      metricKey: 'portal.rating',
      rollingWindowDays: 30,
    })
    expect(shouldEmitCompleted(goal)).toBe(true)
  })

  it('one_shot + sum → true', () => {
    const goal = makeGoal({
      goalType: 'one_shot',
      aggregationFunction: 'sum',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    })
    expect(shouldEmitCompleted(goal)).toBe(true)
  })

  it('one_shot + avg → false (deferred to reconciliation)', () => {
    const goal = makeGoal({
      goalType: 'one_shot',
      aggregationFunction: 'avg',
      metricKey: 'portal.rating',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    })
    expect(shouldEmitCompleted(goal)).toBe(false)
  })

  it('recurring instance + sum → true', () => {
    const goal = makeGoal({
      goalType: 'recurring',
      aggregationFunction: 'sum',
      recurrenceRule: { frequency: 'monthly' },
      periodStart: INSTANCE_START,
      periodEnd: INSTANCE_END,
    })
    expect(shouldEmitCompleted(goal)).toBe(true)
  })

  it('recurring instance + avg → false (deferred to reconciliation)', () => {
    const goal = makeGoal({
      goalType: 'recurring',
      aggregationFunction: 'avg',
      metricKey: 'portal.rating',
      recurrenceRule: { frequency: 'monthly' },
      periodStart: INSTANCE_START,
      periodEnd: INSTANCE_END,
    })
    expect(shouldEmitCompleted(goal)).toBe(false)
  })

  // ── Non-active status always returns false ─────────────────────────────

  it('completed status → false regardless of type/agg', () => {
    const goal = makeGoal({
      goalType: 'open',
      aggregationFunction: 'sum',
      status: 'completed',
    })
    expect(shouldEmitCompleted(goal)).toBe(false)
  })

  it('cancelled status → false', () => {
    const goal = makeGoal({
      goalType: 'open',
      aggregationFunction: 'sum',
      status: 'cancelled',
    })
    expect(shouldEmitCompleted(goal)).toBe(false)
  })

  it('expired status → false', () => {
    const goal = makeGoal({
      goalType: 'one_shot',
      aggregationFunction: 'sum',
      status: 'expired',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    })
    expect(shouldEmitCompleted(goal)).toBe(false)
  })
})
