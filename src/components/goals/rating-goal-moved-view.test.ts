// "What moved you" (round 5, PLAN-D D-2 and D-2b, mock D3): this week first
// with its stars, Google's moves, the plan's changes and the low reviews
// newest first with their short dates, the set last.
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
      { key: 'week', when: 'This week', text: '2 new reviews, both 5★', tone: null },
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
      '2 new reviews, both 5★',
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
  const week = (count: number, allStars: number | null, averageTenths: number | null) =>
    thisWeekText({ count, allStars, averageTenths })

  it('says how many new reviews came and their stars', () => {
    expect(week(0, null, null)).toBe('No new reviews yet')
    expect(week(1, 4, 40)).toBe('1 new review, 4★')
    expect(week(2, 5, 50)).toBe('2 new reviews, both 5★')
    expect(week(3, 5, 50)).toBe('3 new reviews, all 5★')
    expect(week(3, null, 47)).toBe('3 new reviews, average 4.7★')
  })
})

describe('the low reviews since the set', () => {
  const lowReview = (
    at: string,
    stars: number,
    setBack: number | null,
    inboxItemId: string | null,
  ) => ({ at, stars, setBack, inboxItemId })
  const withLow = (lowReviews: ReturnType<typeof lowReview>[]) => ({
    ...DETAIL_HARBORLINE,
    moved: { ...DETAIL_HARBORLINE.moved, shownChanges: [], lowReviews },
  })

  it('says what each set the goal back, with the Inbox item that opens it, newest first', () => {
    const rows = movedRows(
      withLow([
        lowReview('2026-10-12T15:00:00.000Z', 1, 1, null),
        lowReview('2026-10-06T16:20:00.000Z', 2, 5, 'item-2'),
      ]),
      context,
    )

    expect(rows.slice(1, 3)).toEqual([
      {
        key: 'low-0',
        when: 'Oct 12',
        text: '1★ review',
        tone: 'warn',
        detail: 'set you back about 1 new review',
        inboxItemId: null,
        linkLabel: 'Open the 1★ review of Oct 12 in the inbox',
      },
      {
        key: 'low-1',
        when: 'Oct 6',
        text: '2★ review',
        tone: 'warn',
        detail: 'set you back about 5 new reviews',
        inboxItemId: 'item-2',
        linkLabel: 'Open the 2★ review of Oct 6 in the inbox',
      },
    ])
  })

  it('names a review without a setback while no count reaches the goal', () => {
    const rows = movedRows(
      withLow([lowReview('2026-10-12T15:00:00.000Z', 1, null, 'item-1')]),
      context,
    )

    expect(rows[1]).toMatchObject({
      text: '1★ review',
      detail: null,
      inboxItemId: 'item-1',
    })
  })

  it('sorts the low reviews among the other events by date', () => {
    const rows = movedRows(
      {
        ...withLow([lowReview('2026-10-06T16:20:00.000Z', 2, 5, 'item-2')]),
        moved: {
          ...DETAIL_HARBORLINE.moved,
          lowReviews: [lowReview('2026-10-06T16:20:00.000Z', 2, 5, 'item-2')],
        },
      },
      context,
    )

    expect(rows.map((row) => row.key)).toEqual([
      'week',
      'google-2026-10-08T07:00:00.000Z',
      'low-0',
      'set',
    ])
  })
})
