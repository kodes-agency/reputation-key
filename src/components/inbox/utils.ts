// Inbox shared formatting utilities

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(typeof date === 'string' ? new Date(date) : date)
}

export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(typeof date === 'string' ? new Date(date) : date)
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
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

export function formatInboxListDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(typeof date === 'string' ? new Date(date) : date)
}

/** The fixed-width list clock: relative under a week, compact absolute after. */
export function formatCompactAge(date: Date | string, now = new Date()): string {
  const value = typeof date === 'string' ? new Date(date) : date
  const diffMs = Math.max(0, now.getTime() - value.getTime())
  const hours = Math.floor(diffMs / 3_600_000)
  const days = Math.floor(diffMs / 86_400_000)
  if (hours < 1) return 'now'
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(value.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(value)
}

export function formatReviewLanguage(languageCode: string | null | undefined) {
  if (!languageCode) return null
  try {
    const language = new Intl.Locale(languageCode.replaceAll('_', '-')).language
    const label = new Intl.DisplayNames(['en'], { type: 'language' }).of(language)
    return label && label.toLocaleLowerCase() !== language.toLocaleLowerCase()
      ? label
      : null
  } catch {
    return null
  }
}
