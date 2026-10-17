import { describe, expect, it } from 'vitest'
import type {
  RatingGoalCardView,
  RatingGoalRecapView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { CARD } from './rating-goal.stories.fixtures'
import { recapToasts, recapWords } from './rating-goal-recap-view'

const RECAP: RatingGoalRecapView = {
  weekStart: '2026-10-05',
  count: 8,
  averageTenths: null,
  plannedLastWeek: 7,
  raiseToTenths: 140,
  easeToTenths: 30,
}

const card = (
  recap: Partial<RatingGoalRecapView> | null,
  paceTenthsPerWeek = 70,
): RatingGoalCardView => ({
  ...CARD,
  paceTenthsPerWeek,
  recap: recap === null ? null : { ...RECAP, ...recap },
})

describe('what the Monday check-in says (Q4, PLAN-D §5.5)', () => {
  it('compares last week with the plan, more, fewer or as planned', () => {
    expect(recapWords(card({}))?.headline).toBe(
      '8 new Google reviews, 1 more than planned.',
    )
    expect(recapWords(card({ count: 5 }))?.headline).toBe(
      '5 new Google reviews, 2 fewer than planned.',
    )
    expect(recapWords(card({ count: 7 }))?.headline).toBe(
      '7 new Google reviews, as planned.',
    )
    expect(recapWords(card({ count: 1, plannedLastWeek: 3 }))?.headline).toBe(
      '1 new Google review, 2 fewer than planned.',
    )
  })

  it('names last week’s average only when the card carries it (ten reviews or more)', () => {
    expect(recapWords(card({ count: 12, averageTenths: 46 }))?.headline).toBe(
      '12 new Google reviews at 4.6★, 5 more than planned.',
    )
  })

  it('states the count alone after a pace change during last week', () => {
    expect(recapWords(card({ plannedLastWeek: null }))?.headline).toBe(
      '8 new Google reviews last week.',
    )
  })

  it('says when there were none, and the plan when there was one', () => {
    expect(recapWords(card({ count: 0 }))?.headline).toBe(
      'No new Google reviews last week. The plan was 7.',
    )
    expect(recapWords(card({ count: 0, plannedLastWeek: null }))?.headline).toBe(
      'No new Google reviews last week.',
    )
  })

  it('reads the plan per day, or per week under one a day', () => {
    expect(recapWords(card({}))).toMatchObject({
      label: 'Last week',
      sub: 'Your plan is 1 a day, about 7 a week. Keep it for this week, or change it.',
      note: 'Nothing changes unless you choose.',
      keep: { label: 'Keep 1 a day', paceTenthsPerWeek: 70 },
      raise: { label: 'Raise to 2 a day', paceTenthsPerWeek: 140 },
      ease: { label: 'Ease to 3 a week', paceTenthsPerWeek: 30 },
    })
    expect(
      recapWords(card({ raiseToTenths: 70, easeToTenths: 10, plannedLastWeek: 3 }, 30))
        ?.sub,
    ).toBe('Your plan is 3 a week. Keep it for this week, or change it.')
  })

  it('offers no Raise at 50 a day and no Ease at 1 a week', () => {
    expect(recapWords(card({ raiseToTenths: null }, 3500))?.raise).toBeNull()
    expect(recapWords(card({ easeToTenths: null }, 10))?.ease).toBeNull()
  })

  it('says nothing while no check-in is due, or for a goal with no pace', () => {
    expect(recapWords(card(null))).toBeNull()
    expect(recapWords({ ...card({}), paceTenthsPerWeek: null })).toBeNull()
  })
})

describe('what the check-in says once it is answered', () => {
  it('confirms a kept pace, and a new one starting afresh (Q3)', () => {
    expect(recapToasts.kept(70)).toBe('Kept 1 a day for this week.')
    expect(recapToasts.changed(140)).toBe(
      'Pace changed to 2 a day. Getting started again for 2 weeks.',
    )
  })
})
