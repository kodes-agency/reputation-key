import { describe, expect, it } from 'vitest'
import { goalMonthNotes } from './goal-detail-view'

const ZONE = 'Europe/Sofia'
const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-22T09:00:00.000Z')
const OCTOBER = {
  start: at('2026-09-30T21:00:00.000Z'),
  end: at('2026-10-31T22:00:00.000Z'),
}

describe('goalMonthNotes', () => {
  const live = { kind: 'live', value: 412, sampleCount: 412 } as const
  const running = { status: 'open', periodStart: OCTOBER.start } as const
  const nobody = () => null
  const people = (id: string) => (id === 'marco' ? 'Marco' : null)
  const changed = {
    changedAt: at('2026-10-20T08:00:00.000Z'),
    changedBy: 'marco',
    startTarget: 400,
    changeCount: 1,
  }

  it('shows the figure so far on the month still running', () => {
    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: running,
      setAt: at('2026-09-12T08:00:00.000Z'),
      progress: { period: OCTOBER, reading: live },
      marker: null,
      personName: nobody,
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
      marker: null,
      personName: nobody,
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
      marker: null,
      personName: nobody,
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
      marker: null,
      personName: nobody,
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
      marker: null,
      personName: nobody,
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
      marker: null,
      personName: nobody,
      timezone: ZONE,
      now: NOW,
    })

    expect(notes).toEqual([])
  })

  it('a changed month names the person who changed it and the target it started at', () => {
    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: running,
      setAt: at('2026-09-12T08:00:00.000Z'),
      progress: { period: OCTOBER, reading: live },
      marker: changed,
      personName: people,
      timezone: ZONE,
      now: NOW,
    })

    expect(notes).toEqual(['412 so far', 'Changed by Marco on Oct 20, started at 400'])
  })

  it('keeps the marker on a month that has closed', () => {
    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: { status: 'closed', periodStart: OCTOBER.start },
      setAt: at('2026-09-12T08:00:00.000Z'),
      progress: null,
      marker: { ...changed, changeCount: 2 },
      personName: people,
      timezone: ZONE,
      now: at('2026-11-15T09:00:00.000Z'),
    })

    expect(notes).toEqual(['Changed by Marco on Oct 20 (2 changes), started at 400'])
  })

  it('says who changed the target in place of when the goal was set', () => {
    // Set on the 11th at 400 and changed on the 20th: the month is judged
    // against the changed target, so the line is about that one.
    const notes = goalMonthNotes({
      metric: 'portal_rating_count',
      result: running,
      setAt: at('2026-10-11T08:00:00.000Z'),
      progress: null,
      marker: changed,
      personName: people,
      timezone: ZONE,
      now: NOW,
    })

    expect(notes).toEqual(['Changed by Marco on Oct 20, started at 400'])
  })
})
