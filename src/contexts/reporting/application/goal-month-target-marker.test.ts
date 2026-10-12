import { describe, expect, it } from 'vitest'
import type { GoalMonthTargetChange } from './ports/goal-program.repository'
import { monthTargetHistory, monthTargetMarker } from './goal-month-target-marker'

const OCT_10 = new Date('2026-10-10T09:00:00.000Z')
const OCT_20 = new Date('2026-10-20T09:00:00.000Z')
const OCT_31 = new Date('2026-10-31T09:00:00.000Z')

const version = { targetValue: 400 }

type Change = Pick<
  GoalMonthTargetChange,
  'monthlyResultId' | 'previousTargetValue' | 'createdAt' | 'createdBy'
>

const change = (
  monthlyResultId: string,
  previousTargetValue: number,
  createdAt: Date,
  createdBy = 'manager-1',
): Change => ({ monthlyResultId, previousTargetValue, createdAt, createdBy })

describe('monthTargetMarker', () => {
  it('a month that was never changed has no marker', () => {
    const october = { id: 'october', targetValue: null }

    expect(monthTargetMarker({ targetChanges: [] }, october, version)).toBeNull()
    expect(monthTargetHistory({ targetChanges: [] }, october, version)).toEqual({
      effectiveTarget: 400,
      startTarget: 400,
      changeCount: 0,
      lastChange: null,
    })
  })

  it('a changed month names the person who changed it, when, and the target it started with', () => {
    const october = { id: 'october', targetValue: 300 }
    const changes = [change('october', 400, OCT_20, 'marco')]

    expect(monthTargetMarker({ targetChanges: changes }, october, version)).toEqual({
      changedAt: OCT_20,
      changedBy: 'marco',
      startTarget: 400,
      changeCount: 1,
    })
  })

  it('two changes in one month report the starting target, the last change and a count of two', () => {
    const october = { id: 'october', targetValue: 250 }
    // Given newest first: the order of the log is not relied on.
    const changes = [
      change('october', 300, OCT_31, 'marco'),
      change('october', 400, OCT_10, 'elena'),
    ]

    expect(monthTargetMarker({ targetChanges: changes }, october, version)).toEqual({
      changedAt: OCT_31,
      changedBy: 'marco',
      startTarget: 400,
      changeCount: 2,
    })
  })

  it('a change back to the starting target shows no marker, and still counts the changes', () => {
    // The month went 400 → 300 → 400, and stores no target of its own again.
    const october = { id: 'october', targetValue: null }
    const changes = [change('october', 400, OCT_10), change('october', 300, OCT_20)]

    expect(monthTargetMarker({ targetChanges: changes }, october, version)).toBeNull()
    expect(monthTargetHistory({ targetChanges: changes }, october, version)).toEqual({
      effectiveTarget: 400,
      startTarget: 400,
      changeCount: 2,
      lastChange: { at: OCT_20, by: 'manager-1' },
    })
  })

  it('reads only the changes of the month asked about', () => {
    const october = { id: 'october', targetValue: null }
    const changes = [
      change('september', 400, OCT_10),
      change('other-subject', 400, OCT_20),
    ]

    expect(monthTargetMarker({ targetChanges: changes }, october, version)).toBeNull()
  })

  it('a Program read without its change log has no marker', () => {
    // The maintenance read does not carry the log.
    expect(monthTargetMarker({}, { id: 'october', targetValue: 300 }, version)).toBeNull()
  })
})
