// Shared period presets → concrete [start, end] ranges (BQC-5.9 E3).
//
// Single source for the badge/leaderboard period mapping — both contexts
// must agree on what 'this_week' (etc.) means. Range math uses SERVER local
// time (Date#setHours etc.), matching the pre-extraction behavior of both
// copies; tenant-timezone day bucketing is dayKeyInTimezone's job.

export type PeriodPreset =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_quarter'
  | 'all_time'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'

export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  'today',
  'this_week',
  'this_month',
  'this_quarter',
  'all_time',
  'last_7_days',
  'last_30_days',
  'last_90_days',
]

export function periodToRange(period: PeriodPreset | undefined, now: Date) {
  const end = new Date(now)
  const start = new Date(now)

  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0)
      break
    case 'this_week': {
      const day = start.getDay()
      const diff = day === 0 ? -6 : 1 - day
      start.setDate(start.getDate() + diff)
      start.setHours(0, 0, 0, 0)
      break
    }
    case 'this_month':
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      break
    case 'this_quarter': {
      const month = start.getMonth()
      const quarterStart = Math.floor(month / 3) * 3
      start.setMonth(quarterStart, 1)
      start.setHours(0, 0, 0, 0)
      break
    }
    case 'last_7_days':
      start.setDate(start.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      break
    case 'last_30_days':
      start.setDate(start.getDate() - 29)
      start.setHours(0, 0, 0, 0)
      break
    case 'last_90_days':
      start.setDate(start.getDate() - 89)
      start.setHours(0, 0, 0, 0)
      break
    case 'all_time':
    case undefined:
      return { start: undefined, end: undefined, period }
  }

  return { start, end, period }
}

/** Tenant-timezone day bucket key (yyyy_MM_dd) for streak/calendar logic. */
export function dayKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replaceAll('-', '_')
}

export type CalendarPeriodKind = 'weekly' | 'monthly' | 'quarterly'

type WallClock = Readonly<{
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}>

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>()

function wallClockAt(date: Date, timezone: string): WallClock {
  let formatter = wallClockFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
    wallClockFormatters.set(timezone, formatter)
  }
  const parts = formatter.formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)!.value)
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

function wallClockToInstant(target: WallClock, timezone: string): Date {
  const localEpoch = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  )
  const offsets = new Set<number>()
  for (const hours of [-36, 0, 36]) {
    const sample = new Date(localEpoch + hours * 3_600_000)
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
  const exact = [...offsets]
    .map((offset) => new Date(localEpoch - offset))
    .filter((candidate) => sameWallClock(wallClockAt(candidate, timezone), target))
    .sort((left, right) => left.getTime() - right.getTime())
  if (exact[0]) return exact[0]
  throw new RangeError(`Unresolvable calendar boundary in timezone ${timezone}`)
}

/** Half-open current calendar period in the property's IANA timezone. */
export function calendarPeriodRange(
  now: Date,
  timezone: string,
  kind: CalendarPeriodKind,
): Readonly<{ start: Date; end: Date }> {
  const local = wallClockAt(now, timezone)
  const startDate = new Date(Date.UTC(local.year, local.month - 1, local.day))
  if (kind === 'weekly') {
    const day = startDate.getUTCDay()
    startDate.setUTCDate(startDate.getUTCDate() + (day === 0 ? -6 : 1 - day))
  } else {
    startDate.setUTCDate(1)
    if (kind === 'quarterly') {
      startDate.setUTCMonth(Math.floor(startDate.getUTCMonth() / 3) * 3)
    }
  }
  const endDate = new Date(startDate)
  if (kind === 'weekly') endDate.setUTCDate(endDate.getUTCDate() + 7)
  else endDate.setUTCMonth(endDate.getUTCMonth() + (kind === 'quarterly' ? 3 : 1))
  const boundary = (date: Date): WallClock => ({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  })
  return {
    start: wallClockToInstant(boundary(startDate), timezone),
    end: wallClockToInstant(boundary(endDate), timezone),
  }
}
