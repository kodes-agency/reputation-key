// The time a History row shows: "just now", "2 h ago", "yesterday", "Sep 22".
// Days are the property's days, not the browser's, because a ledger that says
// "yesterday" for something that happened at 23:50 in the hotel's time would be
// wrong for a manager travelling. The full instant is always in the title.

import {
  formatDate,
  formatDayKey,
  formatMonthDay,
  formatTimestamp,
  toInstant,
} from '#/lib/format'

const dayBefore = (key: string): string => {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day - 1))
  return date.toISOString().slice(0, 10)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export type HistoryTime = Readonly<{
  /** What the row shows: "2 h ago", "yesterday", "Sep 22". */
  label: string
  /** The calendar date, never relative: "Sep 22", or "Sep 22, 2025" in another year. */
  date: string
  /** The full instant, for the title attribute. */
  title: string
  dateTime: string
}>

export function formatHistoryTime(iso: string, now: Date, timeZone: string): HistoryTime {
  const at = toInstant(iso)
  const today = formatDayKey(now, timeZone)
  const thatDay = formatDayKey(at, timeZone)
  const title = formatTimestamp(at, timeZone)
  if (at === null || today === null || thatDay === null || title === null)
    return {
      label: 'Date unavailable',
      date: 'Date unavailable',
      title: '',
      dateTime: '',
    }
  const sameYear = thatDay.slice(0, 4) === today.slice(0, 4)
  const date = (sameYear ? formatMonthDay(at, timeZone) : formatDate(at, timeZone)) ?? ''
  const base = { date, title, dateTime: at.toISOString() }
  const elapsed = now.getTime() - at.getTime()
  if (elapsed < MINUTE) return { ...base, label: 'just now' }
  if (thatDay === today) {
    return {
      ...base,
      label:
        elapsed < HOUR
          ? `${Math.floor(elapsed / MINUTE)} min ago`
          : `${Math.floor(elapsed / HOUR)} h ago`,
    }
  }
  if (thatDay === dayBefore(today)) return { ...base, label: 'yesterday' }
  return { ...base, label: date }
}
