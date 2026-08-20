import { describe, it, expect } from 'vitest'
import {
  type RecurrenceRule,
  generateNextPeriod,
  generatePeriodSequence,
  periodContaining,
  buildPeriodUniquenessKey,
} from './goal-recurrence'

describe('Goal recurrence', () => {
  const nyTimezone = 'America/New_York'

  describe('generateNextPeriod (daily)', () => {
    const daily: RecurrenceRule = { frequency: 'daily', interval: 1 }

    it('shifts by one day', () => {
      const start = new Date('2026-01-15T10:00:00-05:00')
      const result = generateNextPeriod(start, daily, nyTimezone)
      expect(result.start.getDate()).toBe(16)
    })
  })

  describe('generateNextPeriod (weekly)', () => {
    const weekly: RecurrenceRule = { frequency: 'weekly', interval: 1 }

    it('shifts by seven days', () => {
      const start = new Date('2026-01-15T10:00:00-05:00')
      const result = generateNextPeriod(start, weekly, nyTimezone)
      const expectedStart = new Date('2026-01-22T10:00:00-05:00')
      expect(result.start.toISOString().split('T')[0]).toBe(
        expectedStart.toISOString().split('T')[0],
      )
    })
  })

  describe('generateNextPeriod (monthly)', () => {
    const monthly: RecurrenceRule = { frequency: 'monthly', interval: 1 }

    it('shifts by one month', () => {
      const start = new Date('2026-01-15T10:00:00-05:00')
      const result = generateNextPeriod(start, monthly, nyTimezone)
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: nyTimezone,
        month: 'numeric',
      })
      expect(formatter.format(result.start)).toBe('2')
    })
  })

  describe('generateNextPeriod (quarterly)', () => {
    const quarterly: RecurrenceRule = { frequency: 'quarterly', interval: 1 }

    it('shifts by three months', () => {
      const start = new Date('2026-01-15T10:00:00-05:00')
      const result = generateNextPeriod(start, quarterly, nyTimezone)
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: nyTimezone,
        month: 'numeric',
      })
      expect(formatter.format(result.start)).toBe('4')
    })
  })

  describe('DST safety', () => {
    const daily: RecurrenceRule = { frequency: 'daily', interval: 1 }

    it('handles spring forward (March DST)', () => {
      // March 8, 2026 is the spring forward in US
      const beforeDST = new Date('2026-03-07T10:00:00-05:00')
      const afterShift = generateNextPeriod(beforeDST, daily, nyTimezone)
      // The day should advance by 1
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: nyTimezone,
        day: 'numeric',
        month: 'numeric',
      })
      expect(formatter.format(afterShift.start)).toBe('3/8')
    })

    it('handles fall back (November DST)', () => {
      // November 1, 2026 is the fall back in US
      const beforeDST = new Date('2026-10-31T10:00:00-04:00')
      const afterShift = generateNextPeriod(beforeDST, daily, nyTimezone)
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: nyTimezone,
        day: 'numeric',
        month: 'numeric',
      })
      expect(formatter.format(afterShift.start)).toBe('11/1')
    })

    it('moves a nonexistent spring-gap wall time to the first valid instant', () => {
      const beforeGap = new Date('2026-03-07T02:30:00-05:00')
      const afterShift = generateNextPeriod(beforeGap, daily, nyTimezone)
      expect(afterShift.start.toISOString()).toBe('2026-03-08T07:00:00.000Z')
    })

    it('chooses the earlier instant for an ambiguous fall-fold wall time', () => {
      const beforeFold = new Date('2026-10-31T01:30:00-04:00')
      const afterShift = generateNextPeriod(beforeFold, daily, nyTimezone)
      expect(afterShift.start.toISOString()).toBe('2026-11-01T05:30:00.000Z')
    })
  })

  describe('generatePeriodSequence', () => {
    it('generates N periods', () => {
      const weekly: RecurrenceRule = { frequency: 'weekly', interval: 1 }
      const start = new Date('2026-01-05T10:00:00-05:00') // Monday
      const periods = generatePeriodSequence(start, weekly, nyTimezone, 4)
      expect(periods).toHaveLength(4)
    })
  })

  it('clamps month-end periods without overflowing into the following month', () => {
    const monthly: RecurrenceRule = {
      frequency: 'monthly',
      interval: 1,
      dayOfMonth: 31,
    }
    const periods = generatePeriodSequence(
      new Date('2026-01-31T00:00:00-05:00'),
      monthly,
      nyTimezone,
      3,
    )
    const localDates = periods.map((period) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: nyTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(period.start),
    )
    expect(localDates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  describe('periodContaining', () => {
    it.each([
      {
        name: 'daily',
        reference: '2026-04-15T12:00:00.000Z',
        rule: { frequency: 'daily', interval: 1 } satisfies RecurrenceRule,
        start: '2026-04-15T00:00:00.000Z',
        end: '2026-04-16T00:00:00.000Z',
      },
      {
        name: 'weekly with a Monday boundary',
        reference: '2026-04-15T12:00:00.000Z',
        rule: {
          frequency: 'weekly',
          interval: 1,
          dayOfWeek: 1,
        } satisfies RecurrenceRule,
        start: '2026-04-13T00:00:00.000Z',
        end: '2026-04-20T00:00:00.000Z',
      },
      {
        name: 'monthly before a clamped month-end boundary',
        reference: '2026-04-15T12:00:00.000Z',
        rule: {
          frequency: 'monthly',
          interval: 1,
          dayOfMonth: 31,
        } satisfies RecurrenceRule,
        start: '2026-03-31T00:00:00.000Z',
        end: '2026-04-30T00:00:00.000Z',
      },
      {
        name: 'quarterly',
        reference: '2026-04-15T12:00:00.000Z',
        rule: { frequency: 'quarterly', interval: 1 } satisfies RecurrenceRule,
        start: '2026-04-01T00:00:00.000Z',
        end: '2026-07-01T00:00:00.000Z',
      },
      {
        name: 'yearly before the configured boundary month',
        reference: '2026-04-15T12:00:00.000Z',
        rule: {
          frequency: 'yearly',
          interval: 1,
          monthOfYear: 7,
          dayOfMonth: 31,
        } satisfies RecurrenceRule,
        start: '2025-07-31T00:00:00.000Z',
        end: '2026-07-31T00:00:00.000Z',
      },
    ])('resolves the $name calendar period', ({ reference, rule, start, end }) => {
      const period = periodContaining(new Date(reference), rule, 'UTC')
      expect(period.start.toISOString()).toBe(start)
      expect(period.end.toISOString()).toBe(end)
    })
  })

  describe('buildPeriodUniquenessKey', () => {
    it('produces unique keys for different periods', () => {
      const def = 'def-1'
      const k1 = buildPeriodUniquenessKey(
        def,
        new Date('2026-01-01'),
        new Date('2026-02-01'),
        1,
      )
      const k2 = buildPeriodUniquenessKey(
        def,
        new Date('2026-02-01'),
        new Date('2026-03-01'),
        1,
      )
      expect(k1).not.toBe(k2)
    })

    it('includes version in the key', () => {
      const def = 'def-1'
      const start = new Date('2026-01-01')
      const end = new Date('2026-02-01')
      const k1 = buildPeriodUniquenessKey(def, start, end, 1)
      const k2 = buildPeriodUniquenessKey(def, start, end, 2)
      expect(k1).not.toBe(k2)
    })
  })
})
