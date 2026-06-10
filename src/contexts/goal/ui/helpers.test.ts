import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Goal } from '#/contexts/goal/domain/types'
import {
  formatProgressLabel,
  progressBarWidth,
  progressBarColor,
  sortGoalsByStatus,
  filterGoalsForPortalGroupView,
  getMetricKeysForScope,
  getDefaultAggregationForKey,
  getValidAggregationsForKey,
  daysRemaining,
  formatPeriodDates,
} from './helpers'

// ── Test factories ─────────────────────────────────────────────────────

function makeGoal(overrides: Partial<Goal> & { id: Goal['id'] }): Goal {
  return {
    organizationId: 'org1' as Goal['organizationId'],
    propertyId: 'prop1' as Goal['propertyId'],
    portalId: null,
    portalGroupId: null,
    name: 'Test Goal',
    description: null,
    createdBy: 'user1' as Goal['createdBy'],
    goalType: 'one_shot',
    aggregationFunction: 'sum',
    metricKey: 'portal.scan',
    targetValue: 100,
    status: 'active',
    periodStart: null,
    periodEnd: null,
    recurrenceRule: null,
    rollingWindowDays: null,
    parentGoalId: null,
    completedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

// ── 1. formatProgressLabel ─────────────────────────────────────────────

describe('formatProgressLabel', () => {
  it('formats SUM with integer values as "120 / 200"', () => {
    expect(formatProgressLabel(120, 200, 'sum')).toBe('120 / 200')
  })

  it('formats COUNT with integer values', () => {
    expect(formatProgressLabel(50, 100, 'count')).toBe('50 / 100')
  })

  it('formats AVG with suffixes', () => {
    expect(formatProgressLabel(3.8, 4.2, 'avg')).toBe('3.8 avg / 4.2 target')
  })

  it('formats MAX with suffixes', () => {
    expect(formatProgressLabel(3, 5, 'max')).toBe('3 best / 5 target')
  })

  it('formats non-integer values to 1 decimal for SUM', () => {
    expect(formatProgressLabel(120.5, 200.3, 'sum')).toBe('120.5 / 200.3')
  })

  it('formats integer values with 0 decimals for AVG', () => {
    expect(formatProgressLabel(4, 5, 'avg')).toBe('4 avg / 5 target')
  })

  it('handles zero current value', () => {
    expect(formatProgressLabel(0, 100, 'sum')).toBe('0 / 100')
  })

  it('handles current exceeding target', () => {
    expect(formatProgressLabel(250, 200, 'sum')).toBe('250 / 200')
  })

  it('formats MAX with non-integer values', () => {
    expect(formatProgressLabel(3.75, 5.5, 'max')).toBe('3.8 best / 5.5 target')
  })
})

// ── 2. progressBarWidth ────────────────────────────────────────────────

describe('progressBarWidth', () => {
  it('returns correct percentage for partial progress', () => {
    expect(progressBarWidth(50, 200)).toBe(25)
  })

  it('returns 100 for completed progress', () => {
    expect(progressBarWidth(200, 200)).toBe(100)
  })

  it('caps at 100 when current exceeds target', () => {
    expect(progressBarWidth(300, 200)).toBe(100)
  })

  it('returns 0 when target is 0', () => {
    expect(progressBarWidth(50, 0)).toBe(0)
  })

  it('returns 0 for zero current and positive target', () => {
    expect(progressBarWidth(0, 100)).toBe(0)
  })

  it('handles fractional percentages with floor', () => {
    expect(progressBarWidth(33, 100)).toBe(33)
  })
})

// ── 3. progressBarColor ────────────────────────────────────────────────

describe('progressBarColor', () => {
  it('returns green for completed status', () => {
    expect(progressBarColor('completed', 100, 200)).toBe('green')
  })

  it('returns gray for expired status', () => {
    expect(progressBarColor('expired', 50, 100)).toBe('gray')
  })

  it('returns gray for cancelled status', () => {
    expect(progressBarColor('cancelled', 0, 100)).toBe('gray')
  })

  it('returns green for active status when current >= target', () => {
    expect(progressBarColor('active', 200, 200)).toBe('green')
  })

  it('returns green for active status when current exceeds target', () => {
    expect(progressBarColor('active', 250, 200)).toBe('green')
  })

  it('returns blue for active status when current < target', () => {
    expect(progressBarColor('active', 50, 200)).toBe('blue')
  })
})

// ── 4. sortGoalsByStatus ───────────────────────────────────────────────

describe('sortGoalsByStatus', () => {
  it('sorts by status bucket: active → completed → expired → cancelled', () => {
    const cancelled = makeGoal({
      id: 'g1' as Goal['id'],
      status: 'cancelled',
      createdAt: new Date('2026-04-01'),
    })
    const active = makeGoal({
      id: 'g2' as Goal['id'],
      status: 'active',
      createdAt: new Date('2026-01-01'),
    })
    const expired = makeGoal({
      id: 'g3' as Goal['id'],
      status: 'expired',
      createdAt: new Date('2026-03-01'),
    })
    const completed = makeGoal({
      id: 'g4' as Goal['id'],
      status: 'completed',
      createdAt: new Date('2026-02-01'),
    })

    const result = sortGoalsByStatus([cancelled, active, expired, completed])
    expect(result.map((g: Goal) => g.status)).toEqual([
      'active',
      'completed',
      'expired',
      'cancelled',
    ])
  })

  it('sorts within bucket by createdAt descending (newest first)', () => {
    const a1 = makeGoal({
      id: 'g1' as Goal['id'],
      status: 'active',
      createdAt: new Date('2026-01-01'),
    })
    const a2 = makeGoal({
      id: 'g2' as Goal['id'],
      status: 'active',
      createdAt: new Date('2026-03-15'),
    })
    const a3 = makeGoal({
      id: 'g3' as Goal['id'],
      status: 'active',
      createdAt: new Date('2026-02-10'),
    })

    const result = sortGoalsByStatus([a1, a2, a3])
    expect(result.map((g: Goal) => g.id)).toEqual(['g2', 'g3', 'g1'])
  })

  it('returns empty array for empty input', () => {
    expect(sortGoalsByStatus([])).toEqual([])
  })

  it('handles goals all in same status bucket', () => {
    const g1 = makeGoal({
      id: 'g1' as Goal['id'],
      status: 'completed',
      createdAt: new Date('2026-01-01'),
    })
    const g2 = makeGoal({
      id: 'g2' as Goal['id'],
      status: 'completed',
      createdAt: new Date('2026-06-01'),
    })
    const result = sortGoalsByStatus([g1, g2])
    expect(result.map((g: Goal) => g.id)).toEqual(['g2', 'g1'])
  })
})

// ── 5. filterGoalsForPortalGroupView ──────────────────────────────────

describe('filterGoalsForPortalGroupView', () => {
  const groupGoal = makeGoal({
    id: 'g1' as Goal['id'],
    portalGroupId: 'pg-A' as Goal['portalGroupId'],
    status: 'active',
  })
  const otherGoal = makeGoal({
    id: 'g2' as Goal['id'],
    portalGroupId: 'pg-B' as Goal['portalGroupId'],
    status: 'active',
  })
  const propertyGoal = makeGoal({
    id: 'g3' as Goal['id'],
    portalGroupId: null,
    status: 'active',
  })
  const expiredGoal = makeGoal({
    id: 'g4' as Goal['id'],
    portalGroupId: 'pg-A' as Goal['portalGroupId'],
    status: 'expired',
  })

  it('returns goals matching portalGroupIds', () => {
    const result = filterGoalsForPortalGroupView(
      [groupGoal, otherGoal, propertyGoal],
      ['pg-A'],
    )
    expect(result.map((g: Goal) => g.id)).toEqual(['g1'])
  })

  it('returns goals matching any of multiple groupIds', () => {
    const result = filterGoalsForPortalGroupView([groupGoal, otherGoal], ['pg-A', 'pg-B'])
    expect(result.map((g: Goal) => g.id)).toEqual(['g1', 'g2'])
  })

  it('excludes expired goals even if groupId matches', () => {
    const result = filterGoalsForPortalGroupView([expiredGoal], ['pg-A'])
    expect(result).toEqual([])
  })

  it('excludes goals with null portalGroupId', () => {
    const result = filterGoalsForPortalGroupView([propertyGoal], ['pg-A'])
    expect(result).toEqual([])
  })

  it('returns empty for no matching group', () => {
    const result = filterGoalsForPortalGroupView([groupGoal], ['pg-Z'])
    expect(result).toEqual([])
  })

  it('returns empty for empty goals array', () => {
    expect(filterGoalsForPortalGroupView([], ['pg-A'])).toEqual([])
  })
})

// ── 6. getMetricKeysForScope ───────────────────────────────────────────

describe('getMetricKeysForScope', () => {
  it('returns all keys for property scope', () => {
    const keys = getMetricKeysForScope('property')
    expect(keys).toEqual([
      'portal.scan',
      'portal.rating',
      'portal.feedback',
      'portal.review_link_click',
      'property.review',
    ])
  })

  it('returns portal keys for portal_group scope', () => {
    const keys = getMetricKeysForScope('portal_group')
    expect(keys).not.toContain('property.review')
    expect(keys).toContain('portal.scan')
  })

  it('returns portal keys for portal scope', () => {
    const keys = getMetricKeysForScope('portal')
    expect(keys).not.toContain('property.review')
    expect(keys.length).toBe(4)
  })
})

// ── 7. getDefaultAggregationForKey ─────────────────────────────────────

describe('getDefaultAggregationForKey', () => {
  it('returns sum for portal.scan', () => {
    expect(getDefaultAggregationForKey('portal.scan')).toBe('sum')
  })

  it('returns avg for portal.rating', () => {
    expect(getDefaultAggregationForKey('portal.rating')).toBe('avg')
  })

  it('returns sum for property.review', () => {
    expect(getDefaultAggregationForKey('property.review')).toBe('sum')
  })
})

// ── 8. getValidAggregationsForKey ──────────────────────────────────────

describe('getValidAggregationsForKey', () => {
  it('returns sum/count for portal.scan', () => {
    expect(getValidAggregationsForKey('portal.scan')).toEqual(['sum', 'count'])
  })

  it('returns count/max/avg for portal.rating', () => {
    expect(getValidAggregationsForKey('portal.rating')).toEqual(['count', 'max', 'avg'])
  })
})

// ── 9. daysRemaining ───────────────────────────────────────────────────

describe('daysRemaining', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-22T12:00:00Z'))
  })

  it('returns null when periodEnd is null', () => {
    expect(daysRemaining(null)).toBeNull()
  })

  it('returns positive days for future date', () => {
    expect(daysRemaining(new Date('2026-06-01T00:00:00Z'))).toBe(10)
  })

  it('returns 0 when periodEnd is exactly now', () => {
    expect(daysRemaining(new Date('2026-05-22T12:00:00Z'))).toBe(0)
  })

  it('returns negative days for past date', () => {
    expect(daysRemaining(new Date('2026-05-20T00:00:00Z'))).toBe(-2)
  })

  it('uses ceiling for fractional days', () => {
    const future = new Date('2026-05-25T00:00:00Z')
    expect(daysRemaining(future)).toBe(3)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

// ── 10. formatPeriodDates ──────────────────────────────────────────────

describe('formatPeriodDates', () => {
  it('returns empty string when both null', () => {
    expect(formatPeriodDates(null, null)).toBe('')
  })

  it('returns full range when both present', () => {
    expect(formatPeriodDates(new Date('2026-01-15'), new Date('2026-03-31'))).toBe(
      'Jan 15 – Mar 31',
    )
  })

  it('returns start only with dash when end is null', () => {
    expect(formatPeriodDates(new Date('2026-01-15'), null)).toBe('Jan 15 –')
  })

  it('handles end only (start is null)', () => {
    expect(formatPeriodDates(null, new Date('2026-03-31'))).toBe('– Mar 31')
  })

  it('formats day without leading zero', () => {
    expect(formatPeriodDates(new Date('2026-02-05'), new Date('2026-09-01'))).toBe(
      'Feb 5 – Sep 1',
    )
  })

  it('formats same month correctly', () => {
    expect(formatPeriodDates(new Date('2026-01-01'), new Date('2026-01-31'))).toBe(
      'Jan 1 – Jan 31',
    )
  })
})
