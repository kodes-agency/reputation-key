import { describe, expect, it } from 'vitest'
import {
  goalBulkAnswered,
  goalBulkEdited,
  goalBulkHeldBack,
  goalBulkReportIn,
  goalBulkTargetsOf,
  type GoalBulkEntries,
} from './goal-bulk-entries'

/** The table as it opens: nothing typed, nothing saved. */
const NOTHING_YET: GoalBulkEntries = {}
const LOBBY = 'portal:lobby'
const BAR = 'portal:bar'
const SPA = 'portal:spa'
const RATINGS_OCTOBER = { metric: 'portal_rating_count', startMonth: '2026-10' } as const
const RATINGS_NOVEMBER = { metric: 'portal_rating_count', startMonth: '2026-11' } as const
const AVERAGE_OCTOBER = {
  metric: 'portal_rating_average',
  startMonth: '2026-10',
} as const
const AVERAGE_NOVEMBER = {
  metric: 'portal_rating_average',
  startMonth: '2026-11',
} as const

const typed = (
  entries: GoalBulkEntries,
  metric: 'portal_rating_count' | 'portal_rating_average' | 'qualified_scans',
  numbers: Readonly<Record<string, number>>,
) =>
  Object.entries(numbers).reduce(
    (all, [key, value]) => goalBulkEdited(all, metric, key, value),
    entries,
  )

describe('the numbers of the table that sets several goals', () => {
  it('belong to their measure: another measure starts with empty rows', () => {
    const entries = typed(NOTHING_YET, 'portal_rating_count', {
      [LOBBY]: 20,
      [BAR]: 30,
    })

    expect(goalBulkTargetsOf(entries, 'portal_rating_count')).toEqual({
      [LOBBY]: 20,
      [BAR]: 30,
    })
    expect(goalBulkTargetsOf(entries, 'qualified_scans')).toEqual({})
    expect(goalBulkTargetsOf(entries, 'portal_rating_average')).toEqual({})
  })

  it('come back when the person returns to their measure', () => {
    const ratings = typed(NOTHING_YET, 'portal_rating_count', { [LOBBY]: 20 })
    const both = typed(ratings, 'qualified_scans', { [LOBBY]: 900 })

    expect(goalBulkTargetsOf(both, 'portal_rating_count')).toEqual({ [LOBBY]: 20 })
    expect(goalBulkTargetsOf(both, 'qualified_scans')).toEqual({ [LOBBY]: 900 })
  })

  it('leave a row once its goal is created, so no later save can send them again', () => {
    const entries = typed(NOTHING_YET, 'portal_rating_count', {
      [LOBBY]: 20,
      [BAR]: 30,
      [SPA]: 40,
    })

    const answered = goalBulkAnswered(entries, RATINGS_OCTOBER, {
      [LOBBY]: { code: 'created', programId: 'program-1', targetValue: 20 },
      [BAR]: { code: 'failed' },
    })

    // The refused row keeps its number for another try; the untouched one too.
    expect(goalBulkTargetsOf(answered, 'portal_rating_count')).toEqual({
      [BAR]: 30,
      [SPA]: 40,
    })
  })
})

describe('what the saves left on the rows', () => {
  it('is kept under the measure and the month it was saved for', () => {
    const answered = goalBulkAnswered(NOTHING_YET, RATINGS_OCTOBER, {
      [LOBBY]: { code: 'created', programId: 'program-1', targetValue: 20 },
    })

    expect(goalBulkReportIn(answered, RATINGS_OCTOBER)).toEqual({
      [LOBBY]: { code: 'created', programId: 'program-1', targetValue: 20 },
    })
    expect(goalBulkReportIn(answered, RATINGS_NOVEMBER)).toEqual({})
    expect(goalBulkReportIn(answered, AVERAGE_OCTOBER)).toEqual({})
  })

  it('a wrong-number message leaves with its number, in every month of the measure', () => {
    const fault = {
      code: 'invalid_target',
      fault: 'Use a rating target from 1 to 5',
    } as const
    const failed = { code: 'failed' } as const
    const october = goalBulkHeldBack(NOTHING_YET, AVERAGE_OCTOBER, {
      [LOBBY]: fault,
    })
    const both = goalBulkAnswered(october, AVERAGE_NOVEMBER, {
      [LOBBY]: fault,
      [BAR]: failed,
    })

    const edited = goalBulkEdited(both, 'portal_rating_average', LOBBY, 3)

    expect(goalBulkReportIn(edited, AVERAGE_OCTOBER)).toEqual({})
    // Any other reason a row got no goal stays until a save answers for it.
    expect(goalBulkReportIn(edited, AVERAGE_NOVEMBER)).toEqual({ [BAR]: failed })
  })

  it('an attempt that is not sent replaces the faults of the one before', () => {
    const first = goalBulkHeldBack(NOTHING_YET, RATINGS_OCTOBER, {
      [LOBBY]: { code: 'invalid_target', fault: 'Use a positive whole number' },
    })
    const answered = goalBulkAnswered(first, RATINGS_OCTOBER, {
      [BAR]: { code: 'failed' },
    })

    const second = goalBulkHeldBack(answered, RATINGS_OCTOBER, {
      [SPA]: { code: 'invalid_target', fault: 'Enter a valid monthly target' },
    })

    // Nothing was sent, so what the last save said about the Bar still holds.
    expect(goalBulkReportIn(second, RATINGS_OCTOBER)).toEqual({
      [BAR]: { code: 'failed' },
      [SPA]: { code: 'invalid_target', fault: 'Enter a valid monthly target' },
    })
  })

  it('a save answers for the rows it was sent and clears the rows it was not', () => {
    const first = goalBulkAnswered(NOTHING_YET, RATINGS_OCTOBER, {
      [LOBBY]: { code: 'created', programId: 'program-1', targetValue: 20 },
      [BAR]: { code: 'failed' },
      [SPA]: { code: 'invalid_subject' },
    })

    // The Bar's number was cleared, so the second save sends another row only.
    const second = goalBulkAnswered(first, RATINGS_OCTOBER, {
      'portal_group:floor': {
        code: 'created',
        programId: 'program-2',
        targetValue: 5,
      },
    })

    expect(goalBulkReportIn(second, RATINGS_OCTOBER)).toEqual({
      // A goal that was created stays created, and a Portal that is gone stays gone.
      [LOBBY]: { code: 'created', programId: 'program-1', targetValue: 20 },
      [SPA]: { code: 'invalid_subject' },
      'portal_group:floor': {
        code: 'created',
        programId: 'program-2',
        targetValue: 5,
      },
    })
  })
})
