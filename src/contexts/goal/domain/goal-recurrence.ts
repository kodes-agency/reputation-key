// POST-BETA-3 PB3.3: Goal period recurrence — DST-safe IANA timezone calendar.
//
// Per ADR 0042:
// - Recurrence uses property-local IANA timezone dates.
// - Recurring periods are unique by (definition_id, period_start, period_end, version).
// - Calendar generation is tested across DST gaps/folds, leap days, month ends.
// - A property timezone change affects future periods only.

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

/**
 * Shift a date by one recurrence interval in the given timezone.
 * Operates on local wall-clock components, not absolute timestamps,
 * so DST transitions don't shift the wall-clock time.
 */
function shiftDate(
  date: Date,
  rule: RecurrenceRule,
  timezone: string,
  multiplier: number,
): Date {
  // Extract local wall-clock components in the target timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')

  let y = get('year')
  let mo = get('month') // 1-based
  let d = get('day')
  const h = get('hour') % 24
  const mi = get('minute')
  const s = get('second')

  // Shift the components (Date.UTC normalizes overflow automatically)
  switch (rule.frequency) {
    case 'daily':
      d += multiplier
      break
    case 'weekly':
      d += multiplier * 7
      break
    case 'monthly':
      mo += multiplier
      break
    case 'quarterly':
      mo += multiplier * 3
      break
    case 'yearly':
      y += multiplier
      break
  }

  // Construct as UTC — Date.UTC(y, mo-1, d, h, mi, s) normalizes
  // overflow (e.g. month 13 → next year month 1, day 32 → next month)
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s))

  // The guess is in UTC; correct for the timezone offset so the
  // wall-clock time in the target timezone matches our intent.
  const checkHour =
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      })
        .formatToParts(guess)
        .find((p) => p.type === 'hour')?.value ?? '0',
    ) % 24

  if (checkHour !== h) {
    return new Date(guess.getTime() + (h - checkHour) * 3600000)
  }
  return guess
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
