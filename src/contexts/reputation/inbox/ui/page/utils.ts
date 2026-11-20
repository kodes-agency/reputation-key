// Inbox shared formatting utilities
//
// The date text itself comes from `#/lib/format` (one locale, and formatters
// built once: the rail formats a date for every row). This file keeps what is
// Inbox-specific: the relative clocks, and the one zone the Inbox prints its
// own stamps in.
//
// That zone is the reader's. A relative stamp ("3h ago") is only meaningful
// against the reader's `now`, so the absolute forms beside it (a date past a
// week, the review's date, a hover title) are read on the same clock, and a
// clock time names its zone. The Inbox list and detail are read after mount,
// never on the server, so the reader's zone cannot be a hydration mismatch
// (see `'viewer'` in `#/lib/format`). The Response Target is the exception: it
// is due on the Property's clock, and its chip names that zone.
import { formatDate, formatMonthDay, formatZonedTimestamp } from '#/lib/format'

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' })

/** The reader's own clock: the zone of every stamp the Inbox prints itself. */
const READER_ZONE = 'viewer'

const asDate = (date: Date | string): Date =>
  typeof date === 'string' ? new Date(date) : date

/** "Sep 12, 2026": the day of an Inbox instant, on the reader's clock. */
export function formatInboxDay(date: Date | string): string {
  return formatDate(asDate(date), READER_ZONE) ?? ''
}

/**
 * "Sep 12, 2026, 3:45 PM GMT+3": the exact time behind a relative stamp or a
 * date, for its hover title. The reader's clock, with the zone named, because a
 * bare clock time does not say whose it is.
 */
export function formatExactTime(date: Date | string): string | undefined {
  return formatZonedTimestamp(asDate(date), READER_ZONE) ?? undefined
}

/**
 * `just now`, `Nm ago`, `Nh ago`, `Nd ago`, then an absolute date from the
 * seventh day on — the one clock the thread's event nodes, notes and reply share.
 *
 * Lifted from `inbox-notes-thread.tsx` into the history event row, and from
 * there into this module when that row split into `history-event-line.ts` and
 * `history-event-node.tsx` (plan v2.1 PR 3): a note and a reply importing a
 * clock from an event renderer was a dependency on the wrong thing. The
 * parameter is widened to `Date | string` because a `Date` field arrives as a
 * string after server-function serialization.
 *
 * It reads the reader's own clock and, past a week, prints the reader's own
 * day. Every caller renders it inside a `<time>` whose `title` is
 * `formatExactTime`, the same instant on the same clock with its zone named.
 */
export function formatRelativeTime(date: Date | string): string {
  const d = asDate(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return formatInboxDay(d)
}

/** The fixed-width list clock: relative under a week, compact absolute after. */
export function formatCompactAge(date: Date | string, now = new Date()): string {
  const value = asDate(date)
  const diffMs = Math.max(0, now.getTime() - value.getTime())
  const hours = Math.floor(diffMs / 3_600_000)
  const days = Math.floor(diffMs / 86_400_000)
  if (hours < 1) return 'now'
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  // The reader's day and year, as the thread and the row's own title read it.
  const sameYear = value.getFullYear() === now.getFullYear()
  return sameYear ? (formatMonthDay(value, READER_ZONE) ?? '') : formatInboxDay(value)
}

export function formatReviewLanguage(languageCode: string | null | undefined) {
  if (!languageCode) return null
  try {
    const language = new Intl.Locale(languageCode.replaceAll('_', '-')).language
    const label = LANGUAGE_NAMES.of(language)
    return label && label.toLocaleLowerCase() !== language.toLocaleLowerCase()
      ? label
      : null
  } catch {
    return null
  }
}
