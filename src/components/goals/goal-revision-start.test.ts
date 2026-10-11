import { describe, expect, it } from 'vitest'
import {
  goalAssignmentsDescription,
  goalRevisionDescription,
  goalRevisionReceipt,
  goalRevisionStartDate,
  type GoalChangeSource,
} from './goal-revision-start'

const SOFIA = 'Europe/Sofia'
const at = (iso: string) => new Date(iso)
// The first instants of Sofia's months, which are still the previous day in UTC.
const SOFIA_OCTOBER = at('2026-09-30T21:00:00.000Z')
const SOFIA_NOVEMBER = at('2026-10-31T22:00:00.000Z')
const SOFIA_DECEMBER = at('2026-11-30T22:00:00.000Z')
const SOFIA_JANUARY = at('2026-12-31T22:00:00.000Z')
const MID_OCTOBER = at('2026-10-15T09:00:00.000Z')

/** A goal counting October: its head version has the month open. */
const counting: GoalChangeSource = {
  program: { status: 'active' },
  version: { id: 'head', effectiveFrom: SOFIA_OCTOBER },
  results: [{ programVersionId: 'head', status: 'open', periodEnd: SOFIA_NOVEMBER }],
}

/** A goal set to start with December, with no month opened yet. */
const notStarted: GoalChangeSource = {
  program: { status: 'scheduled' },
  version: { id: 'head', effectiveFrom: SOFIA_DECEMBER },
  results: [],
}

// After the Property's timezone moves east, a change can start a month later
// than "next month", so the start is stated as a date. It is the first instant
// of a Property-local month, which is still the previous day in UTC.
const sofiaMay = {
  effectiveFrom: at('2026-04-30T21:00:00.000Z'),
  propertyTimezone: SOFIA,
}

describe('what a change dialog says before the change is saved', () => {
  it('says a revision applies from the month after the one still counting', () => {
    expect(goalRevisionDescription(counting, MID_OCTOBER, SOFIA)).toBe(
      'Applies from Nov 1.',
    )
  })

  it('says a change of subjects applies from the same month', () => {
    expect(goalAssignmentsDescription(counting, MID_OCTOBER, SOFIA)).toBe(
      'Changes apply from Nov 1.',
    )
  })

  it('keeps the start month of a goal that has not started', () => {
    expect(goalRevisionDescription(notStarted, MID_OCTOBER, SOFIA)).toBe(
      'Applies from Dec 1.',
    )
    expect(goalAssignmentsDescription(notStarted, MID_OCTOBER, SOFIA)).toBe(
      'Changes apply from Dec 1.',
    )
  })

  it('replaces a change still waiting for its month from that month', () => {
    // October is counting under the version before; the head starts in November.
    const waiting: GoalChangeSource = {
      program: { status: 'active' },
      version: { id: 'head', effectiveFrom: SOFIA_NOVEMBER },
      results: [
        { programVersionId: 'before', status: 'open', periodEnd: SOFIA_NOVEMBER },
      ],
    }

    expect(goalRevisionDescription(waiting, MID_OCTOBER, SOFIA)).toBe(
      'Applies from Nov 1.',
    )
  })

  it('prints the year of a start that falls in another year', () => {
    const december: GoalChangeSource = {
      program: { status: 'active' },
      version: { id: 'head', effectiveFrom: SOFIA_OCTOBER },
      results: [{ programVersionId: 'head', status: 'open', periodEnd: SOFIA_JANUARY }],
    }

    expect(goalRevisionDescription(december, at('2026-12-10T09:00:00.000Z'), SOFIA)).toBe(
      'Applies from Jan 1, 2027.',
    )
  })

  it('reads the month in the zone the new version is cut in', () => {
    // Half past midnight on 1 November in Sofia is still 31 October in UTC.
    // Sofia's November has begun, so a change there waits for December.
    const justAfterMidnight = at('2026-10-31T22:30:00.000Z')

    expect(goalRevisionDescription(counting, justAfterMidnight, SOFIA)).toBe(
      'Applies from Dec 1.',
    )
    expect(goalRevisionDescription(counting, justAfterMidnight, 'UTC')).toBe(
      'Applies from Nov 1.',
    )
  })
})

describe('the receipt of a saved revision', () => {
  it('says the change is saved and when it applies from, in which timezone', () => {
    expect(goalRevisionReceipt(sofiaMay, at('2026-03-20T12:00:00.000Z'))).toBe(
      'Change saved. Applies from May 1 (Europe/Sofia).',
    )
  })

  it('prints the year of a start outside the current one', () => {
    expect(goalRevisionReceipt(sofiaMay, at('2025-12-20T12:00:00.000Z'))).toBe(
      'Change saved. Applies from May 1, 2026 (Europe/Sofia).',
    )
  })
})

describe('goalRevisionStartDate', () => {
  it('dates the start in the Property timezone the version was cut in', () => {
    expect(goalRevisionStartDate(sofiaMay)).toBe('May 1, 2026')
  })
})
