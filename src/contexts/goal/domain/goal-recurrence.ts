// POST-BETA-3 PB3.3: Goal period recurrence — DST-safe IANA timezone calendar.
//
// Per ADR 0042:
// - Recurrence uses property-local IANA timezone dates.
// - Recurring periods are unique by (definition_id, period_start, period_end, version).
// - Calendar generation is tested across DST gaps/folds, leap days, month ends.
// - A property timezone change affects future periods only.

import {
  daysInGregorianMonth,
  propertyWallClockAt,
  propertyWallClockToInstant,
  type PropertyWallClock,
} from '#/shared/domain/property-calendar'

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency
  readonly interval: number // every N periods (e.g. every 2 weeks)
  readonly dayOfWeek?: number // 0-6, for weekly
  readonly dayOfMonth?: number // 1-31, for monthly
  readonly monthOfYear?: number // 1-12, for yearly
}

export interface PeriodBounds {
  readonly start: Date
  readonly end: Date
}

/**
 * Generate the next period bounds from a given start date,
 * respecting the recurrence rule and IANA timezone.
 *
 * Periods are half-open: [start, end).
 * Uses Intl.DateTimeFormat for timezone-safe date arithmetic.
 */
export function generateNextPeriod(
  currentStart: Date,
  rule: RecurrenceRule,
  timezone: string,
): PeriodBounds {
  const start = shiftDate(currentStart, rule, timezone, rule.interval)
  const end = shiftDate(start, rule, timezone, rule.interval)
  return { start, end }
}

/**
 * Generate a sequence of period bounds.
 * Does NOT deduplicate — callers should check uniqueness.
 */
export function generatePeriodSequence(
  firstStart: Date,
  rule: RecurrenceRule,
  timezone: string,
  count: number,
): readonly PeriodBounds[] {
  const periods: PeriodBounds[] = []
  let current = {
    start: firstStart,
    end: shiftDate(firstStart, rule, timezone, rule.interval),
  }
  periods.push(current)

  for (let i = 1; i < count; i++) {
    current = generateNextPeriod(current.start, rule, timezone)
    periods.push(current)
  }

  return periods
}

/** Resolve the property-local calendar period containing the reference instant. */
export function periodContaining(
  reference: Date,
  rule: RecurrenceRule,
  timezone: string,
): PeriodBounds {
  const local = propertyWallClockAt(reference, timezone)
  let year = local.year
  let month = local.month
  let day = local.day
  if (rule.frequency === 'weekly') {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const boundaryWeekday = rule.dayOfWeek ?? 1
    day -= (weekday - boundaryWeekday + 7) % 7
  } else if (rule.frequency === 'monthly') {
    const boundaryDay = Math.min(rule.dayOfMonth ?? 1, daysInGregorianMonth(year, month))
    if (day < boundaryDay) {
      month--
      if (month === 0) {
        month = 12
        year--
      }
    }
    day = Math.min(rule.dayOfMonth ?? 1, daysInGregorianMonth(year, month))
  } else if (rule.frequency === 'quarterly') {
    month = Math.floor((month - 1) / 3) * 3 + 1
    day = 1
  } else if (rule.frequency === 'yearly') {
    const boundaryMonth = rule.monthOfYear ?? 1
    if (month < boundaryMonth) year--
    month = boundaryMonth
    day = Math.min(rule.dayOfMonth ?? 1, daysInGregorianMonth(year, month))
  }
  const normalized = new Date(Date.UTC(year, month - 1, day))
  const start = propertyWallClockToInstant(
    {
      year: normalized.getUTCFullYear(),
      month: normalized.getUTCMonth() + 1,
      day: normalized.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timezone,
  )
  return {
    start,
    end: shiftDate(start, rule, timezone, rule.interval),
  }
}

/**
 * Shift a date by one recurrence interval in the given timezone.
 * Operates on local wall-clock components, not absolute timestamps,
 * so DST transitions don't shift the wall-clock time.
 */
function normalizedWallClock(
  current: PropertyWallClock,
  rule: RecurrenceRule,
  multiplier: number,
): PropertyWallClock {
  if (rule.frequency === 'daily' || rule.frequency === 'weekly') {
    const days = multiplier * (rule.frequency === 'weekly' ? 7 : 1)
    const normalized = new Date(
      Date.UTC(
        current.year,
        current.month - 1,
        current.day + days,
        current.hour,
        current.minute,
        current.second,
      ),
    )
    return {
      year: normalized.getUTCFullYear(),
      month: normalized.getUTCMonth() + 1,
      day: normalized.getUTCDate(),
      hour: normalized.getUTCHours(),
      minute: normalized.getUTCMinutes(),
      second: normalized.getUTCSeconds(),
      millisecond: normalized.getUTCMilliseconds(),
    }
  }

  const monthDelta =
    rule.frequency === 'monthly'
      ? multiplier
      : rule.frequency === 'quarterly'
        ? multiplier * 3
        : multiplier * 12
  const monthIndex = current.year * 12 + current.month - 1 + monthDelta
  const year = Math.floor(monthIndex / 12)
  const month = (((monthIndex % 12) + 12) % 12) + 1
  const requestedDay = rule.dayOfMonth ?? current.day
  return {
    year,
    month,
    day: Math.min(requestedDay, daysInGregorianMonth(year, month)),
    hour: current.hour,
    minute: current.minute,
    second: current.second,
    millisecond: current.millisecond,
  }
}

function shiftDate(
  date: Date,
  rule: RecurrenceRule,
  timezone: string,
  multiplier: number,
): Date {
  const current = propertyWallClockAt(date, timezone)
  return propertyWallClockToInstant(
    normalizedWallClock(current, rule, multiplier),
    timezone,
  )
}

/**
 * Build the uniqueness key for a recurring period.
 * Per ADR 0042: unique by (definition_id, period_start, period_end, version).
 */
export function buildPeriodUniquenessKey(
  definitionId: string,
  periodStart: Date,
  periodEnd: Date,
  version: number,
): string {
  return `${definitionId}:${periodStart.toISOString()}:${periodEnd.toISOString()}:v${version}`
}
