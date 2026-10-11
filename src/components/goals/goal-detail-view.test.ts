import { describe, expect, it } from 'vitest'
import {
  goalDay,
  goalMonthNotes,
  goalNoResultsText,
  goalStartLine,
  goalStartMonthHint,
  statusReasonLabel,
} from './goal-detail-view'

const ZONE = 'Europe/Sofia'
const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-22T09:00:00.000Z')
const OCTOBER = {
  start: at('2026-09-30T21:00:00.000Z'),
  end: at('2026-10-31T22:00:00.000Z'),
}
const NOVEMBER_START = OCTOBER.end

describe('goalDay', () => {
  it('prints a day on the Property calendar, with its year outside the current one', () => {
    const calendar = { timezone: ZONE, now: NOW }

    expect(goalDay(at('2026-10-11T08:00:00.000Z'), calendar)).toBe('Oct 11')
    expect(goalDay(at('2025-11-28T08:00:00.000Z'), calendar)).toBe('Nov 28, 2025')
  })

  it('says so when the day cannot be read', () => {
    expect(goalDay(new Date(Number.NaN), { timezone: ZONE, now: NOW })).toBe(
      'an unknown date',
    )
  })
})

describe('goalStartLine', () => {
  const SEPTEMBER_START = at('2026-08-31T21:00:00.000Z')
  const month = (periodStart: Date) => ({ periodStart })

  it('says which month a started goal counts from and when it was set', () => {
    const line = goalStartLine({
      ended: false,
      months: [month(OCTOBER.start)],
      countsFrom: OCTOBER.start,
      setAt: at('2026-10-11T08:00:00.000Z'),
      timezone: ZONE,
      now: NOW,
    })

    expect(line).toBe('Counts from Oct 1 · set on Oct 11')
  })

  it('says when a goal whose first month is still ahead will start', () => {
    const line = goalStartLine({
      ended: false,
      months: [],
      countsFrom: NOVEMBER_START,
      setAt: at('2026-10-21T08:00:00.000Z'),
      timezone: ZONE,
      now: NOW,
    })

    expect(line).toBe('Starts on Nov 1 · set on Oct 21')
  })

  it('counts from the first instant of the month, not after it', () => {
    const line = goalStartLine({
      ended: false,
      months: [],
      countsFrom: NOVEMBER_START,
      setAt: at('2026-10-21T08:00:00.000Z'),
      timezone: ZONE,
      now: NOVEMBER_START,
    })

    expect(line).toBe('Counts from Nov 1 · set on Oct 21')
  })

  it('never says a goal ended before its first month counts from it', () => {
    const line = goalStartLine({
      ended: true,
      months: [],
      countsFrom: NOVEMBER_START,
      setAt: at('2026-10-21T08:00:00.000Z'),
      timezone: ZONE,
      now: at('2026-11-15T09:00:00.000Z'),
    })

    expect(line).toBe('Never started · set on Oct 21')
  })

  it('never says a goal that is counting starts later because its target changes', () => {
    // September and October counted against 400. On the 12th the target was
    // changed to 500 from November: October is still running under 400.
    const line = goalStartLine({
      ended: false,
      months: [month(SEPTEMBER_START), month(OCTOBER.start)],
      countsFrom: NOVEMBER_START,
      setAt: at('2026-10-12T08:00:00.000Z'),
      timezone: ZONE,
      now: at('2026-10-12T09:00:00.000Z'),
    })

    expect(line).toBe('Target applies from Nov 1 · set on Oct 12')
  })

  it('counts from the month a changed target applies to once that month begins', () => {
    const facts = {
      ended: false,
      countsFrom: NOVEMBER_START,
      setAt: at('2026-10-12T08:00:00.000Z'),
      timezone: ZONE,
    }

    // The first instant of November, before its result has been opened.
    expect(
      goalStartLine({
        ...facts,
        months: [month(SEPTEMBER_START), month(OCTOBER.start)],
        now: NOVEMBER_START,
      }),
    ).toBe('Counts from Nov 1 · set on Oct 12')
    expect(
      goalStartLine({
        ...facts,
        months: [month(SEPTEMBER_START), month(OCTOBER.start), month(NOVEMBER_START)],
        now: at('2026-11-15T09:00:00.000Z'),
      }),
    ).toBe('Counts from Nov 1 · set on Oct 12')
  })

  it('says a target changed on a goal that ended before it applied never did', () => {
    // Ending closes the goal with the month it had open, so November never opens.
    const facts = {
      ended: true,
      months: [month(SEPTEMBER_START), month(OCTOBER.start)],
      countsFrom: NOVEMBER_START,
      setAt: at('2026-10-12T08:00:00.000Z'),
      timezone: ZONE,
    }

    expect(goalStartLine({ ...facts, now: at('2026-10-20T09:00:00.000Z') })).toBe(
      'Target never applied · set on Oct 12',
    )
    // Not "Counts from Nov 1" once the month it was planned for has come.
    expect(goalStartLine({ ...facts, now: at('2026-11-15T09:00:00.000Z') })).toBe(
      'Target never applied · set on Oct 12',
    )
  })

  it('keeps what an ended goal counted from when its target stood', () => {
    const line = goalStartLine({
      ended: true,
      months: [month(SEPTEMBER_START), month(OCTOBER.start)],
      countsFrom: SEPTEMBER_START,
      setAt: at('2026-08-20T08:00:00.000Z'),
      timezone: ZONE,
      now: at('2026-11-15T09:00:00.000Z'),
    })

    expect(line).toBe('Counts from Sep 1 · set on Aug 20')
  })

  it('prints the year of a goal set in an earlier year', () => {
    const line = goalStartLine({
      ended: false,
      months: [month(at('2025-11-30T22:00:00.000Z'))],
      countsFrom: at('2025-11-30T22:00:00.000Z'),
      setAt: at('2025-11-28T08:00:00.000Z'),
      timezone: ZONE,
      now: NOW,
    })

    expect(line).toBe('Counts from Dec 1, 2025 · set on Nov 28, 2025')
  })
})

describe('statusReasonLabel', () => {
  it('says when a goal waiting for its month starts', () => {
    expect(statusReasonLabel('awaiting_first_full_month', 'Nov 1')).toBe(
      'Starts on Nov 1',
    )
  })

  it('says a goal is waiting for its metric source', () => {
    expect(statusReasonLabel('metric_source_not_active', 'Nov 1')).toBe(
      'Waiting for the metric source',
    )
  })

  it('says a goal was paused because its organization is closing', () => {
    expect(statusReasonLabel('organization_closure_fence', 'Nov 1')).toBe(
      'Paused while the organization is being closed',
    )
  })

  it('prints a manager’s note as it was written', () => {
    expect(statusReasonLabel('Closed for works', 'Nov 1')).toBe('Closed for works')
    expect(statusReasonLabel('Renovation, see plan_2027 (rooms 1-40)', 'Nov 1')).toBe(
      'Renovation, see plan_2027 (rooms 1-40)',
    )
  })

  // Before the note became optional the page sent one of these with every
  // status change. No manager wrote them and they repeat the status badge, so
  // a goal changed back then must not read "Status note: Goal active".
  it('says nothing for the reasons the page used to send by default', () => {
    expect(statusReasonLabel('Goal paused', 'Nov 1')).toBeNull()
    expect(statusReasonLabel('Goal active', 'Nov 1')).toBeNull()
    expect(statusReasonLabel('Ended by manager', 'Nov 1')).toBeNull()
  })

  it('prints a note that only resembles one of those defaults', () => {
    expect(statusReasonLabel('Goal paused until the lobby reopens', 'Nov 1')).toBe(
      'Goal paused until the lobby reopens',
    )
  })

  it('prints a code it has no sentence for as words, never as a code', () => {
    expect(statusReasonLabel('some_new_reason', 'Nov 1')).toBe('some new reason')
  })

  it('says nothing when there is no reason', () => {
    expect(statusReasonLabel(null, 'Nov 1')).toBeNull()
    expect(statusReasonLabel('   ', 'Nov 1')).toBeNull()
  })
})

describe('goalStartMonthHint', () => {
  const HINT = 'To change the start month, end this goal and set it again.'

  it('tells the manager of a goal that has not started how to move its start', () => {
    expect(goalStartMonthHint({ status: 'scheduled', resultCount: 0 })).toBe(HINT)
  })

  it('says nothing once a month has opened', () => {
    expect(goalStartMonthHint({ status: 'active', resultCount: 1 })).toBeNull()
    expect(goalStartMonthHint({ status: 'paused', resultCount: 2 })).toBeNull()
  })

  it('says nothing for a goal that ended before it started', () => {
    expect(goalStartMonthHint({ status: 'ended', resultCount: 0 })).toBeNull()
  })
})

describe('goalNoResultsText', () => {
  it('says when the results of a scheduled goal start', () => {
    const text = goalNoResultsText({
      scheduled: true,
      statusReason: 'awaiting_first_full_month',
      startsOn: 'Nov 1',
    })

    expect(text).toBe('Results start on Nov 1.')
  })

  it('says a goal is waiting for its metric source, not for a date', () => {
    const text = goalNoResultsText({
      scheduled: true,
      statusReason: 'metric_source_not_active',
      startsOn: 'Oct 1',
    })

    expect(text).toBe('Results start when the metric source is ready.')
  })

  it('says a goal that is not scheduled has none', () => {
    const text = goalNoResultsText({
      scheduled: false,
      statusReason: null,
      startsOn: 'Oct 1',
    })

    expect(text).toBe('This goal has no monthly results.')
  })
})

describe('goalMonthNotes', () => {
  const live = { kind: 'live', value: 412, sampleCount: 412 } as const
  const running = { status: 'open', periodStart: OCTOBER.start } as const

  it('shows the figure so far on the month still running', () => {
    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: running,
      setAt: at('2026-09-12T08:00:00.000Z'),
      progress: { period: OCTOBER, reading: live },
      timezone: ZONE,
      now: NOW,
    })

    expect(notes).toEqual(['412 so far'])
  })

  it('says when a goal was set during the month it counts', () => {
    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: running,
      setAt: at('2026-10-20T08:00:00.000Z'),
      progress: { period: OCTOBER, reading: live },
      timezone: ZONE,
      now: NOW,
    })

    expect(notes).toEqual(['412 so far', 'Set on Oct 20'])
  })

  it('keeps the set-on note on a month that has closed', () => {
    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: { status: 'closed', periodStart: OCTOBER.start },
      setAt: at('2026-10-20T08:00:00.000Z'),
      progress: null,
      timezone: ZONE,
      now: at('2026-11-15T09:00:00.000Z'),
    })

    expect(notes).toEqual(['Set on Oct 20'])
  })

  it('says nothing for a month whose target was set before it began', () => {
    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: { status: 'closed', periodStart: OCTOBER.start },
      setAt: at('2026-09-12T08:00:00.000Z'),
      progress: null,
      timezone: ZONE,
      now: NOW,
    })

    expect(notes).toEqual([])
  })

  it('never puts this month’s figure on another month', () => {
    const september = { status: 'open', periodStart: at('2026-08-31T21:00:00.000Z') }

    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: september,
      setAt: at('2026-08-12T08:00:00.000Z'),
      progress: { period: OCTOBER, reading: live },
      timezone: ZONE,
      now: NOW,
    })

    expect(notes).toEqual([])
  })

  it('never puts a live figure on a month that is being reconciled', () => {
    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: { status: 'reconciling', periodStart: OCTOBER.start },
      setAt: at('2026-09-12T08:00:00.000Z'),
      progress: { period: OCTOBER, reading: live },
      timezone: ZONE,
      now: NOW,
    })

    expect(notes).toEqual([])
  })
})
