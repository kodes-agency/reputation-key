import { describe, expect, it } from 'vitest'
import type { RatingGoalSetupInputs } from '#/contexts/reporting/application/dto/rating-goal-setup.types'
import { workOutRatingGoal } from '#/contexts/reporting/application/rating-goal-setup-plan'
import {
  chooseChip,
  choicesOf,
  raiseGoal,
  type SetupDraft,
  type SetupPlan,
} from './rating-goal-setup-draft'
import { goalAriaLabels, goalSay, statusParts } from './rating-goal-setup-status'
import {
  EDGE_46,
  GOOGLE_LAGS,
  HARBORLINE,
  OLIVE_TREE,
  SEAVIEW,
  TAVOLA,
} from './rating-goal-setup.stories.fixtures'

function planOf(inputs: RatingGoalSetupInputs, draft: SetupDraft = {}): SetupPlan {
  const view = workOutRatingGoal(inputs, choicesOf(draft))
  if (view.kind !== 'plan') throw new Error(`expected a plan, got ${view.kind}`)
  return view
}

const words = (inputs: RatingGoalSetupInputs, draft: SetupDraft = {}) =>
  statusParts(planOf(inputs, draft), draft, 'day').map((part) => part.text)

describe('the status under a recommended goal', () => {
  it.each([
    ['Harborline', HARBORLINE, '4.2 possible in about 6 months'],
    ['Olive Tree', OLIVE_TREE, '4.5 possible in about 4 months'],
    ['Seaview', SEAVIEW, '4.5 possible in about 9 months'],
    ['Tavola', TAVOLA, '4.7 possible in about 9 months'],
  ] as const)('names the next goal up and when (%s)', (_name, inputs, reason) => {
    expect(words(inputs)).toEqual(['Recommended', reason])
  })

  it('says it is the next step up when nothing is within six months', () => {
    expect(words(EDGE_46)).toEqual(['Recommended', 'the next step up from 4.6'])
  })

  it('says it is the highest when the average reaches nothing above it', () => {
    const plan = { ...planOf(HARBORLINE), nextUp: null }
    expect(statusParts(plan, {}, 'day').map((part) => part.text)).toEqual([
      'Recommended',
      'the highest at this average',
    ])
  })
})

describe('the status of a pinned goal', () => {
  it('offers the way back to the recommendation in place of the tag', () => {
    const parts = statusParts(planOf(HARBORLINE, { pin: 42 }), { pin: 42 }, 'day')
    expect(parts).toEqual([
      { kind: 'link', text: 'Back to 4.1, recommended', action: { kind: 'recommended' } },
    ])
  })

  it('says a pin the average no longer reaches, and keeps the way back', () => {
    expect(words(HARBORLINE, { pin: 46 })).toEqual([
      '4.6 needs a higher average than planned, so we show 4.4',
      'Back to 4.1, recommended',
    ])
  })
})

describe('the faster pace', () => {
  const fewAWeek = chooseChip({}, 0)

  it('comes before the tag, and the reason is dropped', () => {
    const parts = statusParts(planOf(EDGE_46, fewAWeek), fewAWeek, 'day')
    expect(parts).toEqual([
      {
        kind: 'link',
        text: 'At 1 a day, about 5 months',
        action: { kind: 'faster', chipIndex: 1, pinTenths: 47 },
      },
      { kind: 'tag', text: 'Recommended' },
    ])
  })

  it('reads the chip in the unit shown', () => {
    const parts = statusParts(planOf(EDGE_46, fewAWeek), fewAWeek, 'month')
    expect(parts[0]?.text).toBe('At 30 a month, about 5 months')
  })

  it('is not offered while a hint is said', () => {
    const capped = raiseGoal(fewAWeek, planOf(EDGE_46, fewAWeek))
    expect(words(EDGE_46, capped)).toEqual([
      '4.8 needs new reviews above 4.8 stars, more than planned',
      'Recommended',
    ])
  })
})

describe('the hints', () => {
  it('say nothing at + when the next goal would be 5.0, so the faster pace shows', () => {
    const top = { ownAverageTenths: 50, pin: 49 }
    const capped = raiseGoal(top, planOf(HARBORLINE, top))
    expect(capped.hint).toBe('cap')
    expect(words(HARBORLINE, capped)).toEqual([
      'At 5 a day, about 11 months',
      'Back to 4.3, recommended',
    ])
  })

  it('say − is at the lowest goal', () => {
    expect(words(HARBORLINE, { pin: 40, hint: 'low' })).toEqual([
      '4.0 is the lowest goal, one step up from 3.9',
      'Back to 4.1, recommended',
    ])
  })
})

describe('while Google lags behind the cache', () => {
  it('says Google should show the earned tenth soon, first', () => {
    expect(words(GOOGLE_LAGS)).toEqual(['Google should show 4.0 soon', 'Recommended'])
  })
})

describe('the numeral for a screen reader', () => {
  it('names − and + by where they go', () => {
    expect(goalAriaLabels(planOf(HARBORLINE))).toEqual({
      lower: 'Lower the goal to 4.0',
      raise: 'Raise the goal to 4.2',
      atLowest: false,
      atHighest: false,
    })
  })

  it('names them by why they stop at the ends', () => {
    const top = goalAriaLabels(planOf(HARBORLINE, { pin: 44 }))
    expect(top).toMatchObject({
      raise: '4.4 is the highest goal at this average',
      atHighest: true,
    })
    const bottom = goalAriaLabels(planOf(HARBORLINE, { pin: 40 }))
    expect(bottom).toMatchObject({ lower: '4.0 is the lowest goal', atLowest: true })
  })

  it('says the goal in one sentence', () => {
    expect(goalSay(planOf(HARBORLINE), 'day')).toBe(
      'Goal 4.1: 81 new reviews, in about 3 months at 1 a day',
    )
    expect(goalSay(planOf(TAVOLA), 'month')).toBe(
      'Goal 4.6: 252 new reviews, in about 5 weeks at 210 a month',
    )
  })
})
