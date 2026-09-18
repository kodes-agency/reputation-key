// Inbox shared formatting utilities

/**
 * The formatters are module constants, not per-call constructions.
 *
 * `new Intl.DateTimeFormat(...)` costs ~26.5 µs on V8 — it resolves the locale
 * and builds an ICU pattern every time. Every thread node formats its `title`
 * through `formatDateTime`, and every node older than a week also formats its
 * visible stamp through `formatRelativeTime`'s absolute branch — one
 * constructor per node for a recent thread, two once entries age past the
 * week. On a 50-row rail that is roughly 1.3 ms and 2.7 ms of construction per
 * render, and it ran again on each keystroke in the internal-note box, which
 * re-renders the pane. The inbox list's row clock, `formatCompactAge`, runs
 * once per row and formats every row older than a week the same way.
 *
 * `Intl.DateTimeFormat` instances are immutable and safe to share;
 * `person-initials.ts` already hoists its `Intl.Segmenter` for the same reason.
 *
 * Every formatter but `DATE_LOCAL` is zone-stable UTC on purpose — see
 * `formatRelativeTime` for the one deliberate exception.
 */
const DATE_UTC = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

const DATE_TIME_UTC = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

/** The viewer's own zone — `formatRelativeTime`'s absolute branch only. */
const DATE_LOCAL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** `formatCompactAge`'s same-year date; another year takes `DATE_UTC`. */
const MONTH_DAY_UTC = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

const LIST_DATE_UTC = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' })

const asDate = (date: Date | string): Date =>
  typeof date === 'string' ? new Date(date) : date

export function formatDate(date: Date | string): string {
  return DATE_UTC.format(asDate(date))
}

export function formatDateTime(date: Date | string): string {
  return DATE_TIME_UTC.format(asDate(date))
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
 * Unlike its neighbours this one reads the viewer's own clock and, past a week,
 * formats in the viewer's own time zone. That is deliberate and unchanged: a
 * relative stamp is only meaningful against the reader's `now`, and every
 * caller renders it inside a `<time>` whose `title` carries the zone-stable
 * `formatDateTime`.
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

  return DATE_LOCAL.format(d)
}

export function formatInboxListDate(date: Date | string): string {
  return LIST_DATE_UTC.format(asDate(date))
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
  const sameYear = value.getUTCFullYear() === now.getUTCFullYear()
  return (sameYear ? MONTH_DAY_UTC : DATE_UTC).format(value)
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
