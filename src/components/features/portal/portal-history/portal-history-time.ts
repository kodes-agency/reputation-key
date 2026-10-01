// The time a History row shows: "just now", "2 h ago", "yesterday", "22 Sep".
// Days are the property's days, not the browser's, because a ledger that says
// "yesterday" for something that happened at 23:50 in the hotel's time would be
// wrong for a manager travelling. The full instant is always in the title.

const dayKey = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)

const dayBefore = (key: string): string => {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day - 1))
  return date.toISOString().slice(0, 10)
}

// Month names are ours, not the platform's: some ICU versions spell September
// "Sept" in en-GB, and a ledger should not change its words with the browser.
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const wallClock = (at: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return {
    year: part('year'),
    month: MONTHS[Number(part('month')) - 1] ?? '',
    day: String(Number(part('day'))),
    time: `${part('hour')}:${part('minute')}`,
  }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export type HistoryTime = Readonly<{
  /** What the row shows: "2 h ago", "yesterday", "22 Sep". */
  label: string
  /** The calendar date, never relative: "22 Sep", or "22 Sep 2025" in another year. */
  date: string
  /** The full instant, for the title attribute. */
  title: string
  dateTime: string
}>

export function formatHistoryTime(iso: string, now: Date, timeZone: string): HistoryTime {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime()))
    return {
      label: 'Date unavailable',
      date: 'Date unavailable',
      title: '',
      dateTime: '',
    }
  const clock = wallClock(at, timeZone)
  const today = dayKey(now, timeZone)
  const thatDay = dayKey(at, timeZone)
  const sameYear = thatDay.slice(0, 4) === today.slice(0, 4)
  const date = `${clock.day} ${clock.month}${sameYear ? '' : ` ${clock.year}`}`
  const base = {
    date,
    title: `${clock.day} ${clock.month} ${clock.year} ${clock.time}`,
    dateTime: at.toISOString(),
  }
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
