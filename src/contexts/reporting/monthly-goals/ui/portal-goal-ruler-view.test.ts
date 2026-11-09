import { describe, expect, it } from 'vitest'
import type {
  PortalGoalCardView,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { portalGoalRuler } from './portal-goal-ruler-view'
import {
  CARD_FIRST_DAYS,
  CARD_LAST_DAY,
  CARD_NOT_JUDGED,
  CARD_PASSED,
  CARD_RUNNING,
  CARD_UNREADABLE,
} from './portal-goal-running.stories.fixtures'

/** The running month a story's card draws. */
function monthOf(card: PortalGoalCardView): PortalGoalRunningMonth {
  if (card.state !== 'goal' || card.goal.month === null) {
    throw new Error('expected a card with a running month')
  }
  return card.goal.month
}

/** Nov 22, 23 of 40 with 22 of 30 days gone. */
const RUNNING = monthOf(CARD_RUNNING)

const rulerOf = (month: PortalGoalRunningMonth) => {
  const ruler = portalGoalRuler(month)
  if (ruler === null) throw new Error('expected a ruler')
  return ruler
}

describe('the running month on the goal ruler', () => {
  it('has no ruler when the figure cannot be read: it is never a zero', () => {
    expect(portalGoalRuler(monthOf(CARD_UNREADABLE))).toBeNull()
  })

  it('runs from none on the 1st to the month’s number, with where the month stands', () => {
    const ruler = rulerOf(RUNNING)

    expect(ruler).toMatchObject({
      from: { value: '0', note: 'Nov 1' },
      to: { value: '40', note: 'your number' },
      at: 23 / 40,
      now: '23 so far',
      reached: false,
    })
  })

  it('names the month’s first day in its own month', () => {
    expect(rulerOf({ ...RUNNING, key: '2026-12' }).from).toEqual({
      value: '0',
      note: 'Dec 1',
    })
  })

  it('stops where a steady month would be today: its figure and its share of the month', () => {
    const { stops } = rulerOf(RUNNING)

    // 22 of 30 days gone: 40 × 22 / 30 is 29.3, said as 29.
    expect(stops).toEqual([
      {
        key: 'steady',
        at: 22 / 30,
        value: '29',
        note: 'steady pace',
        noteWideOnly: false,
        reached: false,
        align: 'center',
      },
    ])
  })

  it('has reached the steady stop when the month is ahead of it', () => {
    const { stops } = rulerOf({ ...RUNNING, value: 30 })

    expect(stops.map(({ value, reached }) => ({ value, reached }))).toEqual([
      { value: '29', reached: true },
    ])
  })

  it('shows a steady stop of a small number of ratings at the day it stands on', () => {
    // 10 over 14 of 30 days is 4.7, said as 5; nothing yet counted.
    const ruler = rulerOf({ ...RUNNING, target: 10, value: 0, elapsedDays: 14 })

    expect(ruler.stops).toMatchObject([{ at: 14 / 30, value: '5' }])
    expect(ruler).toMatchObject({ at: 0, nowAlign: 'start', startDot: false })
  })

  it('has no steady stop in the quiet first days', () => {
    const ruler = rulerOf(monthOf(CARD_FIRST_DAYS))

    expect(ruler.stops).toEqual([])
    expect(ruler.reached).toBe(false)
  })

  it('has no steady stop once the number is passed', () => {
    const ruler = rulerOf(monthOf(CARD_PASSED))

    expect(ruler.stops).toEqual([])
  })

  it('has reached the number once it is passed, and the way stops at the end', () => {
    const passed = rulerOf(monthOf(CARD_PASSED))
    const exactly = rulerOf({ ...RUNNING, value: 40 })
    const one = rulerOf({ ...RUNNING, value: 39 })

    // 41 of 40 fills the ruler and no more.
    expect(passed).toMatchObject({ reached: true, at: 1, now: '41 so far' })
    expect(exactly).toMatchObject({ reached: true, at: 1 })
    expect(one.reached).toBe(false)
  })

  it('late in the month the stop’s words end at it, and the number’s note makes room', () => {
    // 27 of 30 days gone: 40 × 27 / 30 is 36.
    const ruler = rulerOf({ ...RUNNING, value: 30, elapsedDays: 27, daysAfterToday: 3 })

    expect(ruler.stops).toMatchObject([{ at: 27 / 30, value: '36', align: 'end' }])
    expect(ruler.to).toEqual({ value: '40', note: null })
  })

  it('draws the last days’ stop without words, where they would not fit', () => {
    // The last day: a steady month is at the number, and the end says it.
    const ruler = rulerOf(monthOf(CARD_LAST_DAY))

    expect(ruler.stops).toMatchObject([{ at: 1, value: null, note: null }])
    expect(ruler.label).toBe(
      '23 of 40 private ratings so far. A steady month would be at about 40 by today.',
    )
  })
})

describe('the ruler’s sentence for a screen reader', () => {
  it('says the figure so far and where a steady month would be today', () => {
    expect(rulerOf(RUNNING).label).toBe(
      '23 of 40 private ratings so far. A steady month would be at about 29 by today.',
    )
  })

  it('says only the figure in the quiet first days and once the number is passed', () => {
    expect(rulerOf(monthOf(CARD_FIRST_DAYS)).label).toBe(
      '1 of 40 private ratings so far.',
    )
    expect(rulerOf(monthOf(CARD_PASSED)).label).toBe('41 of 40 private ratings so far.')
  })

  it('says the month’s own unit: one is singular, scans are scans', () => {
    // A goal of 1 private rating, 20 of 30 days gone.
    expect(rulerOf({ ...RUNNING, target: 1, value: 0, elapsedDays: 20 }).label).toBe(
      '0 of 1 private rating so far. A steady month would be at about 1 by today.',
    )
    expect(
      rulerOf({ ...RUNNING, measure: 'qualified_scans', target: 55, value: 43 }).label,
    ).toBe('43 of 55 scans so far. A steady month would be at about 40 by today.')
  })

  it('groups a large number', () => {
    expect(
      rulerOf({ ...RUNNING, measure: 'qualified_scans', target: 1200, value: 1050 })
        .label,
    ).toBe('1,050 of 1,200 scans so far. A steady month would be at about 880 by today.')
  })

  it('names the steady stop for the pace it stands for, never for a judgement', () => {
    const ruler = rulerOf(RUNNING)

    expect(ruler.stops.map(({ note }) => note)).toEqual(['steady pace'])
    expect(ruler.label).not.toMatch(/behind|ahead|below|on pace/iu)
  })

  it('does not change with the pace the pill judged', () => {
    const behind = rulerOf({ ...RUNNING, belowPace: true })

    expect(rulerOf({ ...RUNNING, belowPace: false })).toEqual(behind)
    expect(rulerOf({ ...RUNNING, belowPace: null })).toEqual(behind)
  })

  it('has the not-judged month of 4 still stop on the day', () => {
    // 4 × 29 / 30 is 3.9, said as 4; too near the end for its words.
    const ruler = rulerOf(monthOf(CARD_NOT_JUDGED))

    expect(ruler.label).toBe(
      '1 of 4 private ratings so far. A steady month would be at about 4 by today.',
    )
    expect(ruler.stops).toMatchObject([{ value: null }])
  })
})
