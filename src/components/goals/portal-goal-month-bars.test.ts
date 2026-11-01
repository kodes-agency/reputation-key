import { describe, expect, it } from 'vitest'
import type { PortalGoalPageMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import { monthBars } from './portal-goal-bands-view'
import { PAGE_LATER, PAGE_RUNNING } from './portal-goal-page.stories.fixtures'

describe('monthBars: each month against its own number', () => {
  const ratings = 'portal_rating_count'
  const month = (key: string, patch: Partial<PortalGoalPageMonth> = {}) =>
    ({
      key,
      measure: ratings,
      value: 36,
      target: 40,
      outcome: 'not_met',
      finalOn: null,
      correction: null,
      ...patch,
    }) satisfies PortalGoalPageMonth

  it('draws the months oldest first, each with its own figure, number and words', () => {
    // Dec 22: December running against 45, November met, October not.
    expect(monthBars(PAGE_LATER.months, ratings, PAGE_LATER.today)).toEqual({
      caption: 'Private ratings each month. The short line is that month’s number.',
      earlier: null,
      columns: [
        {
          key: '2026-10',
          label: 'Oct',
          value: 36,
          figure: '36',
          tone: 'since',
          mark: 40,
          met: false,
          line: 'October: 36 of 40 private ratings · not met · Final on Nov 2 · Number in October: 40',
        },
        {
          key: '2026-11',
          label: 'Nov',
          value: 41,
          figure: '41',
          tone: 'since',
          mark: 40,
          met: true,
          line: 'November: 41 of 40 private ratings · met · Final on Dec 2 · Number in November: 40',
        },
        {
          key: '2026-12',
          label: 'Dec',
          value: 12,
          figure: '12',
          tone: 'open',
          mark: 45,
          met: false,
          line: 'December: 12 of 45 private ratings · running · Final on Jan 2 · Number in December: 45',
        },
      ],
    })
  })

  it('has nothing to compare under two months: one bar compares nothing', () => {
    expect(monthBars(PAGE_RUNNING.months, ratings, PAGE_RUNNING.today)).toBeNull()
    expect(monthBars([], ratings, PAGE_RUNNING.today)).toBeNull()
    // Two months, but only one of them counts scans.
    const mixed = [month('2026-11', { measure: 'qualified_scans' }), month('2026-10')]
    expect(monthBars(mixed, 'qualified_scans', '2026-11-22')).toBeNull()
  })

  it('shows 12 months at most, the latest, oldest first', () => {
    // 14 months, newest first: Dec 2026 back to Nov 2025.
    const months = Array.from({ length: 14 }, (_, index) => {
      const at = 2026 * 12 + 11 - index
      return month(`${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, '0')}`)
    })
    const bars = monthBars(months, ratings, '2026-12-22')

    expect(bars?.columns).toHaveLength(12)
    expect(bars?.columns.map(({ key }) => key).at(0)).toBe('2026-01')
    expect(bars?.columns.map(({ key }) => key).at(-1)).toBe('2026-12')
  })

  it('leaves out the months of the other measure, and says so', () => {
    const months = [
      month('2026-12', { measure: 'qualified_scans', value: 80, target: 120 }),
      month('2026-11', { measure: 'qualified_scans', value: 130, target: 120 }),
      month('2026-10'),
    ]

    const scans = monthBars(months, 'qualified_scans', '2026-12-22')
    expect(scans?.columns.map(({ key }) => key)).toEqual(['2026-11', '2026-12'])
    expect(scans).toMatchObject({
      caption: 'Scans each month. The short line is that month’s number.',
      earlier: 'Earlier months counted private ratings.',
    })
    const before = [
      month('2026-12'),
      month('2026-11'),
      month('2026-10', { measure: 'qualified_scans' }),
    ]
    expect(monthBars(before, ratings, '2026-12-22')?.earlier).toBe(
      'Earlier months counted scans.',
    )
  })

  it('draws a month still counting, or being read, dashed: open', () => {
    const months = [
      month('2026-12', { outcome: 'running' }),
      month('2026-11', { outcome: 'updating' }),
      month('2026-10', { outcome: 'met', value: 41 }),
    ]

    expect(
      monthBars(months, ratings, '2026-12-22')?.columns.map(({ tone }) => tone),
    ).toEqual(['since', 'open', 'open'])
  })

  it('checks a month that was met, and only that month', () => {
    const months = [month('2026-11', { outcome: 'met', value: 40 }), month('2026-10')]

    expect(
      monthBars(months, ratings, '2026-11-22')?.columns.map(({ met }) => met),
    ).toEqual([false, true])
  })

  it('draws no bar and prints no figure for a month with no usable result', () => {
    const months = [
      month('2026-11'),
      month('2026-10', { value: null, outcome: 'unavailable' }),
    ]
    const [unread] = monthBars(months, ratings, '2026-11-22')?.columns ?? []

    expect(unread).toMatchObject({ value: null, figure: null, met: false, mark: 40 })
  })

  it('names a month of another year by its year in its line, not in its label', () => {
    const months = [month('2026-01'), month('2025-11')]
    const [older] = monthBars(months, ratings, '2026-01-22')?.columns ?? []

    expect(older).toMatchObject({ label: 'Nov' })
    expect(older?.line).toMatch(/^November 2025: /u)
  })
})
