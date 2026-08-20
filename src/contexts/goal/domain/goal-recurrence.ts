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

/** Resolve the property-local calendar period containing the reference instant. */
export function periodContaining(
  reference: Date,
  rule: RecurrenceRule,
  timezone: string,
): PeriodBounds {
  const local = wallClockAt(reference, timezone)
  let year = local.year
  let month = local.month
  let day = local.day
  if (rule.frequency === 'weekly') {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const boundaryWeekday = rule.dayOfWeek ?? 1
    day -= (weekday - boundaryWeekday + 7) % 7
  } else if (rule.frequency === 'monthly') {
    const boundaryDay = Math.min(rule.dayOfMonth ?? 1, daysInMonth(year, month))
    if (day < boundaryDay) {
      month--
      if (month === 0) {
        month = 12
        year--
      }
    }
    day = Math.min(rule.dayOfMonth ?? 1, daysInMonth(year, month))
  } else if (rule.frequency === 'quarterly') {
    month = Math.floor((month - 1) / 3) * 3 + 1
    day = 1
  } else if (rule.frequency === 'yearly') {
    const boundaryMonth = rule.monthOfYear ?? 1
    if (month < boundaryMonth) year--
    month = boundaryMonth
    day = Math.min(rule.dayOfMonth ?? 1, daysInMonth(year, month))
  }
  const normalized = new Date(Date.UTC(year, month - 1, day))
  const start = wallClockToInstant(
    {
      year: normalized.getUTCFullYear(),
      month: normalized.getUTCMonth() + 1,
      day: normalized.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
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
type WallClock = Readonly<{
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}>

function wallClockAt(date: Date, timezone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour') % 24,
    minute: value('minute'),
    second: value('second'),
  }
}

function sameWallClock(left: WallClock, right: WallClock): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  )
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function normalizedWallClock(
  current: WallClock,
  rule: RecurrenceRule,
  multiplier: number,
): WallClock {
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
    day: Math.min(requestedDay, daysInMonth(year, month)),
    hour: current.hour,
    minute: current.minute,
    second: current.second,
  }
}

function exactInstantsForWallClock(target: WallClock, timezone: string): Date[] {
  const localEpoch = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  )
  const offsets = new Set<number>()
  for (const delta of [-36, 0, 36]) {
    const sample = new Date(localEpoch + delta * 3_600_000)
    const local = wallClockAt(sample, timezone)
    offsets.add(
      Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
      ) - sample.getTime(),
    )
  }

  return [...offsets]
    .map((offset) => new Date(localEpoch - offset))
    .filter((candidate) => sameWallClock(wallClockAt(candidate, timezone), target))
    .sort((left, right) => left.getTime() - right.getTime())
}

function wallClockToInstant(target: WallClock, timezone: string): Date {
  const exact = exactInstantsForWallClock(target, timezone)
  if (exact[0]) return exact[0] // deterministic fold policy: earlier occurrence

  const localEpoch = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  )
  // Deterministic gap policy: advance to the first representable local minute.
  for (let minute = 1; minute <= 180; minute++) {
    const shifted = new Date(localEpoch + minute * 60_000)
    const candidate: WallClock = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    }
    const instants = exactInstantsForWallClock(candidate, timezone)
    if (instants[0]) return instants[0]
  }
  throw new RangeError(`Unable to resolve wall clock in timezone ${timezone}`)
}

function shiftDate(
  date: Date,
  rule: RecurrenceRule,
  timezone: string,
  multiplier: number,
): Date {
  const current = wallClockAt(date, timezone)
  return wallClockToInstant(normalizedWallClock(current, rule, multiplier), timezone)
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
