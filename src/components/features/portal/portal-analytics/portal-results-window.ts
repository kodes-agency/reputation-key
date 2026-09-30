// Portal results — how a window is named on the page.
//
// The server cuts every window into Property-local calendar days and hands them
// over as `YYYY-MM-DD` (`localDays`), so nothing here works out a day from an
// instant and a zone. Month names are spelled from a fixed list: `Intl` prints
// "Sept" in some locales and the boards say "Sep".

import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import {
  timeRangePreset,
  type TimeRangePreset,
} from '#/contexts/reporting/application/dto/dashboard.dto'

type LocalDays = NonNullable<PortalAnalyticsData['localDays']>

export const PORTAL_RESULTS_RANGES: ReadonlyArray<{
  value: TimeRangePreset
  label: string
}> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '60d', label: 'Last 60 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

const DEFAULT_RANGE: TimeRangePreset = '30d'

/** A remembered range, if the picker still offers it: the server accepts more presets than this tab shows. */
export function storedResultsRange(stored: string | null): TimeRangePreset {
  const parsed = timeRangePreset.safeParse(stored)
  if (!parsed.success) return DEFAULT_RANGE
  return PORTAL_RESULTS_RANGES.some((range) => range.value === parsed.data)
    ? parsed.data
    : DEFAULT_RANGE
}

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
] as const

type Day = Readonly<{ year: number; month: number; day: number }>

function parseDay(localDate: string): Day {
  const [year = 0, month = 1, day = 1] = localDate.split('-').map(Number)
  return { year, month, day }
}

function monthName(month: number): string {
  return MONTHS[month - 1] ?? ''
}

/** "1–30 Sep", "28 Aug – 3 Sep", or with years when the range crosses one. */
export function formatDayRange(startLocalDate: string, endLocalDate: string): string {
  const start = parseDay(startLocalDate)
  const end = parseDay(endLocalDate)
  if (startLocalDate === endLocalDate) return `${end.day} ${monthName(end.month)}`
  if (start.year !== end.year) {
    return `${start.day} ${monthName(start.month)} ${start.year} – ${end.day} ${monthName(end.month)} ${end.year}`
  }
  if (start.month !== end.month) {
    return `${start.day} ${monthName(start.month)} – ${end.day} ${monthName(end.month)}`
  }
  return `${start.day}–${end.day} ${monthName(end.month)}`
}

const MS_PER_DAY = 86_400_000

function utcDay({ year, month, day }: Day): number {
  return Date.UTC(year, month - 1, day)
}

/** Days in an inclusive range of local dates. */
export function dayCount(startLocalDate: string, endLocalDate: string): number {
  return (
    Math.round(
      (utcDay(parseDay(endLocalDate)) - utcDay(parseDay(startLocalDate))) / MS_PER_DAY,
    ) + 1
  )
}

/** The window's own name: "1–30 Sep, Europe/Sofia time". */
export function windowCaption(days: LocalDays, timezone: string): string {
  return `${formatDayRange(days.start, days.end)}, ${timezone} time`
}

/** What the toggle compares against: "Compare with the 30 days before". */
export function compareLabel(days: LocalDays): string {
  const length = dayCount(days.start, days.end)
  return length === 1
    ? 'Compare with the day before'
    : `Compare with the ${length} days before`
}

/** The current period as the legend names it: "Last 30 days", from the days the figures cover. */
export function currentPeriodLabel(days: LocalDays): string {
  return `Last ${dayCount(days.start, days.end)} days`
}

/** The period before as the legend and the table name it: "The 30 days before". */
export function priorPeriodLabel(days: LocalDays): string {
  const length = dayCount(days.start, days.end)
  return length === 1 ? 'The day before' : `The ${length} days before`
}

/** The footer line: both periods, the zone, and the floor a comparison needs.
 *  All Time (`days` is null) has no comparison, so it has no floor to state. */
export function windowFooter(
  days: LocalDays | null,
  timezone: string,
  comparisonMinSample: number,
): string {
  if (days === null) return `All time, ${timezone} time`
  const current = formatDayRange(days.start, days.end)
  if (days.compareStart === null || days.compareEnd === null) {
    return `${current}, ${timezone} time`
  }
  const prior = formatDayRange(days.compareStart, days.compareEnd)
  return `${current} against ${prior}, ${timezone} time · Averages compare only when both periods have at least ${comparisonMinSample} private ratings.`
}
