import { addDays } from '../local-date'

export function lastMentionedLocalDate(
  reviews: readonly Readonly<{ localDate: string }>[],
): string | null {
  return reviews.reduce<string | null>(
    (latest, review) =>
      latest === null || review.localDate > latest ? review.localDate : latest,
    null,
  )
}

export type CalendarMonth = Readonly<{
  month: string
  startLocalDate: string
  endLocalDate: string
  partialStart: boolean
  partialEnd: boolean
}>

/** Calendar bounds, clipped to the actual read. Unread months are never manufactured. */
export function calendarMonths(
  period: Readonly<{ startLocalDate: string; endLocalDate: string }>,
): readonly CalendarMonth[] {
  const months: CalendarMonth[] = []
  let first = `${period.startLocalDate.slice(0, 7)}-01`
  while (first <= period.endLocalDate) {
    const next = `${addDays(first, 32).slice(0, 7)}-01`
    const last = addDays(next, -1)
    const startLocalDate = first < period.startLocalDate ? period.startLocalDate : first
    const endLocalDate = last > period.endLocalDate ? period.endLocalDate : last
    months.push({
      month: first.slice(0, 7),
      startLocalDate,
      endLocalDate,
      partialStart: startLocalDate !== first,
      partialEnd: endLocalDate !== last,
    })
    first = next
  }
  return months
}

/** Current calendar month plus the eleven preceding it. */
export function twelveMonthStart(endLocalDate: string): string {
  let year = Number(endLocalDate.slice(0, 4))
  let month = Number(endLocalDate.slice(5, 7)) - 11
  if (month < 1) {
    month += 12
    year -= 1
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}
