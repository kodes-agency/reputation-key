// "What moved you" (round 5, PLAN-D D-2, mock D3): this week first, Google's
// moves and the plan's changes newest first with their short dates, the set
// last, and no per-review value.
import { describe, expect, it } from 'vitest'
import { movedRows, thisWeekText } from './rating-goal-moved-view'
import {
  DETAIL_HARBORLINE,
  DETAIL_PLAN_CHANGED,
} from './rating-goal-detail.stories.fixtures'
import { FIXTURE_NOW, FIXTURE_TIMEZONE } from './rating-goal.stories.fixtures'

const context = {
  personName: (userId: string) => (userId === 'user-ana' ? 'Ana Petrova' : null),
  timezone: FIXTURE_TIMEZONE,
  now: new Date(FIXTURE_NOW),
}

describe('what moved you', () => {
  it('starts with this week, then Google’s move, and ends with the set', () => {
    expect(movedRows(DETAIL_HARBORLINE, context)).toEqual([
      { key: 'week', when: 'This week', text: '2 new reviews', tone: null },
      {
        key: 'google-2026-10-08T07:00:00.000Z',
        when: 'Oct 8',
        text: 'Google started showing 4.0',
        tone: 'positive',
      },
      {
        key: 'set',
        when: 'Sep 24',
        text: 'Ana Petrova set the goal: 4.1 at 1 a day',
        tone: null,
      },
    ])
  })

  it('names a change of plan with who made it, and the plan the goal was set with', () => {
    const rows = movedRows(DETAIL_PLAN_CHANGED, context)

    expect(rows.map((row) => row.text)).toEqual([
      '2 new reviews',
      'Google started showing 4.0',
      'Ana Petrova changed the plan: Pace 5 a week → 1 a day',
      'Ana Petrova set the goal: 4.1 at 5 a week',
    ])
    expect(rows[2]?.when).toBe('Oct 1')
  })

  it('puts the fields one manager changed at once in one row', () => {
    const at = '2026-10-10T08:00:00.000Z'
    const rows = movedRows(
      {
        ...DETAIL_HARBORLINE,
        changes: [
          {
            changedBy: 'user-bo',
            changedAt: at,
            field: 'target',
            oldValue: '41',
            newValue: '42',
          },
          {
            changedBy: 'user-bo',
            changedAt: at,
            field: 'pace',
            oldValue: '70',
            newValue: '140',
          },
        ],
      },
      context,
    )

    expect(rows[1]?.text).toBe(
      'A manager changed the plan: Target 4.1 → 4.2 · Pace 1 → 2 a day',
    )
  })

  it('says Google went back in the warning ink', () => {
    const rows = movedRows(
      {
        ...DETAIL_HARBORLINE,
        moved: {
          ...DETAIL_HARBORLINE.moved,
          shownChanges: [{ at: '2026-10-12T07:00:00.000Z', tenths: 39, up: false }],
        },
      },
      context,
    )

    expect(rows[1]).toMatchObject({ text: 'Google went back to 3.9', tone: 'warn' })
  })

  it('shows twelve rows at most, the newest, and keeps the set’s row last', () => {
    const shownChanges = Array.from({ length: 15 }, (_, day) => ({
      at: new Date(Date.UTC(2026, 8, 25 + day, 7)).toISOString(),
      tenths: day % 2 === 0 ? 40 : 39,
      up: day % 2 === 0,
    }))
    const rows = movedRows(
      { ...DETAIL_HARBORLINE, moved: { ...DETAIL_HARBORLINE.moved, shownChanges } },
      context,
    )

    expect(rows).toHaveLength(12)
    expect(rows[1]?.key).toBe(`google-${shownChanges[14]?.at}`)
    expect(rows.at(-1)?.key).toBe('set')
  })

  it('says a goal set to keep a number', () => {
    const rows = movedRows(
      {
        ...DETAIL_HARBORLINE,
        moved: {
          ...DETAIL_HARBORLINE.moved,
          initialTargetTenths: 48,
          initialPaceTenthsPerWeek: null,
        },
      },
      context,
    )

    expect(rows.at(-1)?.text).toBe('Ana Petrova set the goal: keep 4.8')
  })
})

describe('this week', () => {
  it('counts the new reviews, with no stars', () => {
    expect(thisWeekText(0)).toBe('No new reviews yet')
    expect(thisWeekText(1)).toBe('1 new review')
    expect(thisWeekText(3)).toBe('3 new reviews')
  })
})
