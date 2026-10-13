// One clock for the Inbox's own stamps (review finding R4D-04).
//
// The Inbox printed one instant three ways: the hover title of a row, a note, a
// reply and a history line in UTC with no zone named; the review's date as its
// UTC day; a thread date past a week on the reader's clock. A manager in Sofia
// read a hover title three hours early, and a review published at 01:30 on
// 13 September was dated the 12th above notes about it dated the 13th.
//
// Every stamp the Inbox prints itself is now on the reader's clock, and a clock
// time names its zone. The Response Target stays on the Property's clock, which
// it names (`response-target-chip.ts`). Nothing here is rendered on the server:
// the list and the detail are read after mount, so the reader's zone cannot be
// a hydration mismatch.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readUiSources } from '#/shared/testing/source-tree'
import { formatCompactAge, formatExactTime, formatInboxDay } from './utils'

/** 01:30 on 13 September in Sofia (UTC+3): still the 12th in UTC. */
const PUBLISHED = '2026-09-12T22:30:00.000Z'
const TWO_WEEKS_LATER = new Date('2026-09-27T09:00:00.000Z')

describe('an Inbox stamp, read in Sofia', () => {
  // One zone for the whole file: `#/lib/format` builds the reader's formatters
  // once, so they are built under this zone.
  beforeAll(() => {
    vi.stubEnv('TZ', 'Europe/Sofia')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it("dates the review on the reader's day, as the thread dates the notes about it", () => {
    expect(formatInboxDay(PUBLISHED)).toBe('Sep 13, 2026')
    expect(formatInboxDay(new Date(PUBLISHED))).toBe('Sep 13, 2026')
  })

  it('dates a row older than a week on the same day', () => {
    expect(formatCompactAge(PUBLISHED, TWO_WEEKS_LATER)).toBe('Sep 13')
    expect(formatCompactAge('2025-12-31T22:30:00.000Z', TWO_WEEKS_LATER)).toBe('Jan 1')
    expect(formatCompactAge('2024-12-31T22:30:00.000Z', TWO_WEEKS_LATER)).toBe(
      'Jan 1, 2025',
    )
  })

  it("gives the exact time on the reader's clock and says which clock", () => {
    expect(formatExactTime(PUBLISHED)).toBe('Sep 13, 2026, 1:30 AM GMT+3')
  })

  it('has no exact time for something that is not an instant', () => {
    expect(formatExactTime('not a date')).toBeUndefined()
  })
})

describe('Inbox sources', () => {
  /** A date helper of `#/lib/format` called with the instant alone: the UTC default. */
  const UTC_DEFAULT =
    /\bformat(?:Timestamp|Date|MonthDay|LongDate|Clock|MonthYear|MonthName)\(\s*[\w.?!]+\s*\)/u

  it('never print an instant on the UTC default', () => {
    const offenders = readUiSources({ includeTs: true })
      .filter((file) => file.path.startsWith('src/components/inbox/'))
      .filter((file) => UTC_DEFAULT.test(file.text))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('tells the default from a call that names its zone', () => {
    expect(
      UTC_DEFAULT.test('title={formatTimestamp(item.sourceDate) ?? undefined}'),
    ).toBe(true)
    expect(UTC_DEFAULT.test("formatDate(d, 'viewer')")).toBe(false)
    expect(
      UTC_DEFAULT.test('formatTimestamp(target.dueAt, target.propertyTimezone)'),
    ).toBe(false)
  })
})
