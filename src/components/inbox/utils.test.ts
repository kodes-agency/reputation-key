import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatCompactAge,
  formatDate,
  formatDateTime,
  formatInboxListDate,
  formatRelativeTime,
  formatReviewLanguage,
} from './utils'

describe('inbox date formatting', () => {
  const utcBoundary = new Date('2026-08-09T01:15:00.000Z')

  it('renders source dates in a server/client-stable timezone', () => {
    expect(formatDate(utcBoundary)).toBe('Aug 9, 2026')
  })

  it('renders source timestamps in a server/client-stable timezone', () => {
    expect(formatDateTime(utcBoundary)).toBe('Aug 9, 2026, 1:15 AM')
  })

  it('renders compact list dates in day-month order', () => {
    expect(formatInboxListDate(utcBoundary)).toBe('9 Aug')
  })

  it('renders a safe English language label from BCP-47 metadata', () => {
    expect(formatReviewLanguage('tr-TR')).toBe('Turkish')
    expect(formatReviewLanguage('not_a_tag')).toBeNull()
    expect(formatReviewLanguage(null)).toBeNull()
  })
})

describe('formatRelativeTime', () => {
  /**
   * Fixed clock: the repo forbids tests that read the wall clock.
   *
   * Local noon, built from local calendar parts, NOT a `Z` instant. Past a week
   * `formatRelativeTime` prints the viewer's LOCAL calendar day, so an instant
   * fixed in UTC names a different day wherever the zone's offset reaches the
   * twelve hours between UTC noon and midnight: `2026-08-21T12:00Z` is already
   * Aug 22 in Pacific/Auckland (UTC+12) and Pacific/Kiritimati (UTC+14), which
   * failed this suite on an unchanged codebase. A date assembled from local
   * parts is the same calendar day in every zone, and the seven days subtracted
   * below can move it by at most the one DST hour — never across midnight.
   */
  const NOW = new Date(2026, 7, 28, 12)
  const ago = (ms: number) => new Date(NOW.getTime() - ms)
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads anything under a minute as just now', () => {
    expect(formatRelativeTime(NOW)).toBe('just now')
    expect(formatRelativeTime(ago(59_999))).toBe('just now')
  })

  it('reads a timestamp from a clock running ahead as just now, not a negative age', () => {
    expect(formatRelativeTime(ago(-5 * MINUTE))).toBe('just now')
  })

  it('counts whole minutes below the hour', () => {
    expect(formatRelativeTime(ago(MINUTE))).toBe('1m ago')
    expect(formatRelativeTime(ago(59 * MINUTE + 59_999))).toBe('59m ago')
  })

  it('counts whole hours below the day', () => {
    expect(formatRelativeTime(ago(HOUR))).toBe('1h ago')
    expect(formatRelativeTime(ago(DAY - 1))).toBe('23h ago')
  })

  it('counts whole days below the week', () => {
    expect(formatRelativeTime(ago(DAY))).toBe('1d ago')
    expect(formatRelativeTime(ago(7 * DAY - 1))).toBe('6d ago')
  })

  it('switches to an absolute date from the seventh day on', () => {
    expect(formatRelativeTime(ago(7 * DAY))).toBe('Aug 21, 2026')
    expect(formatRelativeTime(new Date(2025, 11, 31, 12))).toBe('Dec 31, 2025')
  })

  it('accepts the string a Date becomes after server-function serialization', () => {
    expect(formatRelativeTime(ago(3 * HOUR).toISOString())).toBe('3h ago')
    // The wire string of a LOCAL noon, for the reason `NOW` gives: a literal
    // `…T12:00:00.000Z` is Aug 2 east of UTC+12.
    expect(formatRelativeTime(new Date(2026, 7, 1, 12).toISOString())).toBe('Aug 1, 2026')
  })
})

describe('formatCompactAge', () => {
  const NOW = new Date('2026-09-14T12:00:00.000Z')

  it('uses the fixed-width row clock', () => {
    expect(formatCompactAge(NOW, NOW)).toBe('now')
    expect(formatCompactAge('2026-09-14T10:00:00.000Z', NOW)).toBe('2h')
    expect(formatCompactAge('2026-09-11T12:00:00.000Z', NOW)).toBe('3d')
    expect(formatCompactAge('2026-09-01T12:00:00.000Z', NOW)).toBe('Sep 1')
    expect(formatCompactAge('2025-09-01T12:00:00.000Z', NOW)).toBe('Sep 1, 2025')
  })

  // The list formats every row through this clock, so a row older than a week
  // must not pay for a new `Intl.DateTimeFormat` — in either year branch.
  it('builds no formatter per call', () => {
    const construct = vi.spyOn(Intl, 'DateTimeFormat')
    try {
      expect(formatCompactAge('2026-09-01T12:00:00.000Z', NOW)).toBe('Sep 1')
      expect(formatCompactAge('2025-09-01T12:00:00.000Z', NOW)).toBe('Sep 1, 2025')
      expect(construct).not.toHaveBeenCalled()
    } finally {
      construct.mockRestore()
    }
  })
})
