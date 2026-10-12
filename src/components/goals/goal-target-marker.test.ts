import { describe, expect, it } from 'vitest'
import type { GoalMonthTargetMarker } from '#/contexts/reporting/application/goal-month-target-marker'
import {
  goalPersonNames,
  goalTargetMarkerLine,
  goalTargetMarkerNote,
} from './goal-target-marker'

const ZONE = 'Europe/Sofia'
const NOW = new Date('2026-10-22T09:00:00.000Z')
const people = (id: string) => (id === 'marco' ? 'Marco' : null)
const frame = { timezone: ZONE, now: NOW, personName: people }

const marker = (patch: Partial<GoalMonthTargetMarker> = {}): GoalMonthTargetMarker => ({
  changedAt: new Date('2026-10-20T08:00:00.000Z'),
  changedBy: 'marco',
  startTarget: 400,
  changeCount: 1,
  ...patch,
})

describe('goalTargetMarkerLine', () => {
  it('a changed month names the person who changed it, the day and the target it started at', () => {
    expect(goalTargetMarkerLine('qualified_scans', marker(), frame)).toBe(
      'Changed by Marco on Oct 20, started at 400',
    )
  })

  it('says how many times the target changed once it changed more than once', () => {
    const twice = marker({
      changedAt: new Date('2026-10-31T08:00:00.000Z'),
      changeCount: 2,
    })

    expect(goalTargetMarkerLine('qualified_scans', twice, frame)).toBe(
      'Changed by Marco on Oct 31 (2 changes), started at 400',
    )
  })

  it('leaves the person out when the directory cannot name them', () => {
    expect(
      goalTargetMarkerLine('qualified_scans', marker({ changedBy: 'unknown' }), frame),
    ).toBe('Changed on Oct 20, started at 400')
  })

  it('prints the starting target of an average to one decimal', () => {
    expect(
      goalTargetMarkerLine('portal_rating_average', marker({ startTarget: 4 }), frame),
    ).toBe('Changed by Marco on Oct 20, started at 4.0')
  })

  it('reads the day on the Property calendar, with the year once it is another one', () => {
    // 21:30 UTC on 19 October is already the 20th in Sofia.
    const late = marker({ changedAt: new Date('2026-10-19T21:30:00.000Z') })
    const lastYear = marker({ changedAt: new Date('2025-12-05T08:00:00.000Z') })

    expect(goalTargetMarkerLine('qualified_scans', late, frame)).toBe(
      'Changed by Marco on Oct 20, started at 400',
    )
    expect(goalTargetMarkerLine('qualified_scans', lastYear, frame)).toBe(
      'Changed by Marco on Dec 5, 2025, started at 400',
    )
  })
})

describe('goalTargetMarkerNote', () => {
  it('is the marker for a line among other facts: the day and the starting target', () => {
    expect(goalTargetMarkerNote('qualified_scans', marker(), frame)).toBe(
      'changed Oct 20, started at 400',
    )
  })

  it('keeps the count of changes', () => {
    expect(
      goalTargetMarkerNote('qualified_scans', marker({ changeCount: 3 }), frame),
    ).toBe('changed Oct 20 (3 changes), started at 400')
  })
})

describe('goalPersonNames', () => {
  const members = [
    { userId: 'marco', name: 'Marco Rossi' },
    { userId: 'elena', name: 'Elena Petrova' },
  ]

  it('names a member of the organization', () => {
    expect(goalPersonNames(members)('marco')).toBe('Marco Rossi')
  })

  it('says a former member for someone the directory no longer lists', () => {
    expect(goalPersonNames(members)('someone-who-left')).toBe('a former member')
  })

  it('names nobody while the directory has not been read', () => {
    // Not read is not the same as not listed: nobody is called a former member
    // because the list is still loading, failed, or is not this reader's to see.
    expect(goalPersonNames(undefined)('marco')).toBeNull()
  })
})
