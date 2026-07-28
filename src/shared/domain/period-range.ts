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
