import { describe, expect, it } from 'vitest'
import { hasRunningPortalRatingGoal } from './running-portal-rating-goal'
import { propertyGoal } from './use-cases/monthly-portal-goal-test-fixtures'

describe('running single-Portal rating goal guard', () => {
  const now = new Date('2026-11-18T10:00:00.000Z')
  const property = propertyGoal('goal', 'portal_rating_count', { status: 'active' })
  const rating = {
    ...property,
    assignments: property.assignments.map((assignment) => ({
      ...assignment,
      subject: { kind: 'portal' as const, portalId: 'portal' },
    })),
  }
  it('refuses a live rating goal but leaves Property subjects and ended goals alone', () => {
    expect(hasRunningPortalRatingGoal([rating], 'portal', now)).toBe(true)
    expect(hasRunningPortalRatingGoal([property], 'portal', now)).toBe(false)
    expect(
      hasRunningPortalRatingGoal(
        [{ ...rating, program: { ...rating.program, status: 'ended' } }],
        'portal',
        now,
      ),
    ).toBe(false)
  })
  it('keeps the running rating month guarded when a scans version waits for next month', () => {
    const nextMonth = new Date('2026-12-01T00:00:00.000Z')
    const scanVersion = {
      ...rating.version,
      id: 'scans',
      version: 2,
      metric: 'qualified_scans' as const,
      effectiveFrom: nextMonth,
    }
    expect(
      hasRunningPortalRatingGoal(
        [
          {
            ...rating,
            version: scanVersion,
            versions: [{ ...rating.version, effectiveTo: nextMonth }, scanVersion],
            assignments: rating.assignments.map((assignment) => ({
              ...assignment,
              effectiveTo: nextMonth,
            })),
          },
        ],
        'portal',
        now,
      ),
    ).toBe(true)
  })
})
