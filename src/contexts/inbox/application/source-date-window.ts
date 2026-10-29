// The days a drill-down names, as the moments an Inbox item's source date is
// compared with.
//
// A number on Guest voice counts the reviews of a Property's own calendar days
// (`ai_property_local_date_v1` over the review's date, in its timezone), and the
// link that opens them says `since` and `until` in those days. An Inbox item
// stores the review's date as an instant, so the days are turned into the
// instants they start and end at in the Property's timezone: reading them as UTC
// days would move a review near midnight in or out of the list, and the list
// would no longer hold the reviews the number counted.
import { propertyWallClockToInstant } from '#/shared/domain/property-calendar'

export type SourceDateWindow = Readonly<{
  /** Start of the first day, inclusive. */
  sourceDateFrom?: Date
  /** Last millisecond of the last day, inclusive (the list compares with `<=`). */
  sourceDateTo?: Date
}>

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

function dayParts(
  localDate: string,
): Readonly<{ year: number; month: number; day: number }> {
  const match = DAY.exec(localDate)
  if (match === null) throw new RangeError(`Not a calendar day: ${localDate}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function startOfDay(localDate: string, timezone: string | null): Date {
  const { year, month, day } = dayParts(localDate)
  // No timezone is an unknown Property (the whole Inbox, a hand-written link):
  // the days are read in UTC, the one calendar every reader shares.
  if (timezone === null) return new Date(Date.UTC(year, month - 1, day))
  return propertyWallClockToInstant(
    { year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timezone,
  )
}

function nextDay(localDate: string): string {
  const { year, month, day } = dayParts(localDate)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

export function sourceDateWindow(
  window: Readonly<{ since?: string; until?: string; timezone: string | null }>,
): SourceDateWindow {
  const { since, until, timezone } = window
  return {
    ...(since === undefined ? {} : { sourceDateFrom: startOfDay(since, timezone) }),
    ...(until === undefined
      ? {}
      : { sourceDateTo: new Date(startOfDay(nextDay(until), timezone).getTime() - 1) }),
  }
}
