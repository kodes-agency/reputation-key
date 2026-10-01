import { describe, expect, it } from 'vitest'
import { formatHistoryTime } from './portal-history-time'

const NOW = new Date('2026-09-30T10:05:00.000Z')
const SOFIA = 'Europe/Sofia'

describe('formatHistoryTime', () => {
  it('says just now within the minute', () => {
    expect(formatHistoryTime('2026-09-30T10:04:30.000Z', NOW, SOFIA).label).toBe(
      'just now',
    )
  })

  it('counts minutes and hours on the same day', () => {
    expect(formatHistoryTime('2026-09-30T09:35:00.000Z', NOW, SOFIA).label).toBe(
      '30 min ago',
    )
    expect(formatHistoryTime('2026-09-30T08:05:00.000Z', NOW, SOFIA).label).toBe(
      '2 h ago',
    )
  })

  it('says yesterday for the property day before', () => {
    expect(formatHistoryTime('2026-09-29T13:40:00.000Z', NOW, SOFIA).label).toBe(
      'yesterday',
    )
  })

  it('reads the day in the property time zone, not the browser one', () => {
    // 21:30 UTC on the 29th is 00:30 on the 30th in Sofia (UTC+3): today, not yesterday.
    expect(formatHistoryTime('2026-09-29T21:30:00.000Z', NOW, SOFIA).label).toBe(
      '12 h ago',
    )
    expect(formatHistoryTime('2026-09-29T21:30:00.000Z', NOW, 'UTC').label).toBe(
      'yesterday',
    )
  })

  it('gives a short date for anything older, with the year only when it is another year', () => {
    expect(formatHistoryTime('2026-09-22T11:20:00.000Z', NOW, SOFIA).label).toBe('22 Sep')
    expect(formatHistoryTime('2025-12-01T11:20:00.000Z', NOW, SOFIA).label).toBe(
      '1 Dec 2025',
    )
  })

  it('keeps the full instant in the title, in the property time zone', () => {
    const time = formatHistoryTime('2026-09-30T08:05:00.000Z', NOW, SOFIA)

    expect(time.title).toBe('30 Sep 2026 11:05')
    expect(time.dateTime).toBe('2026-09-30T08:05:00.000Z')
    expect(time.date).toBe('30 Sep')
  })

  it('does not throw on a date it cannot read', () => {
    expect(formatHistoryTime('not a date', NOW, SOFIA).label).toBe('Date unavailable')
  })
})
