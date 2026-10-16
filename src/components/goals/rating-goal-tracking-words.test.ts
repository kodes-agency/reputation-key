// What the round 5 card says about the climb (PLAN-D D-1, mocks D2/D4).
import { describe, expect, it } from 'vitest'
import {
  firstStepText,
  goalLineText,
  headlineText,
  ladderLabel,
  reviewCountText,
  rungsOf,
  slotCount,
  slotsLabel,
  soonText,
  thisWeekOf,
} from './rating-goal-tracking-words'
import {
  CARD_ACTUAL_PACE,
  CARD_FAR_GOAL,
  CARD_GETTING_STARTED,
  CARD_GOOGLE_SOURCE,
  CARD_HARBORLINE,
  CARD_HARBORLINE_JUST_SET,
  CARD_LAGS,
  CARD_LAGS_MIDDLE,
} from './rating-goal-tracking.stories.fixtures'
import { CARD_KEEP } from './rating-goal.stories.fixtures'

describe('the headline', () => {
  it('counts the new reviews to the next number Google can show', () => {
    expect(headlineText(CARD_HARBORLINE)).toBe('18 new reviews to 4.1')
    expect(headlineText(CARD_FAR_GOAL)).toBe('31 new reviews to 4.4')
  })

  it('says one review in the singular, and "about" under Google’s own figure', () => {
    const one = { ...CARD_HARBORLINE.next!, reviewsNeeded: 1 }

    expect(headlineText({ ...CARD_HARBORLINE, next: one })).toBe('1 new review to 4.1')
    expect(headlineText(CARD_GOOGLE_SOURCE)).toBe('about 18 new reviews to 4.1')
    expect(reviewCountText(212, true)).toBe('about 212 new reviews')
  })

  it('skips a tenth Google should show soon, and says that beside it', () => {
    expect(headlineText(CARD_LAGS_MIDDLE)).toBe('180 new reviews to 4.5')
    expect(soonText(CARD_LAGS_MIDDLE)).toBe('Google should show 4.4 soon')
    expect(soonText(CARD_HARBORLINE)).toBeNull()
  })

  it('says Google should show the goal soon once the reviews have earned it', () => {
    expect(headlineText(CARD_LAGS)).toBe('Google should show 4.1 soon')
  })

  it('has nothing to count for a goal that keeps a number', () => {
    expect(headlineText(CARD_KEEP)).toBeNull()
  })
})

describe('the goal’s own total', () => {
  it('is said only when the headline counts to a nearer number', () => {
    expect(goalLineText(CARD_FAR_GOAL)).toBe('212 new reviews to your goal, 4.5.')
    expect(goalLineText(CARD_HARBORLINE)).toBeNull()
    expect(goalLineText(CARD_LAGS_MIDDLE)).toBeNull()
  })
})

describe('the squares', () => {
  it('draws one per review the headline counts, up to 30', () => {
    expect(slotCount(CARD_HARBORLINE)).toBe(18)
    expect(slotCount(CARD_FAR_GOAL)).toBe(0)
    expect(
      slotCount({
        ...CARD_FAR_GOAL,
        next: { ...CARD_FAR_GOAL.next!, reviewsNeeded: 30 },
      }),
    ).toBe(30)
  })

  it('draws none under Google’s own figure, nor once Google should show the goal', () => {
    expect(slotCount(CARD_GOOGLE_SOURCE)).toBe(0)
    expect(slotCount(CARD_LAGS)).toBe(0)
  })

  it('names what the squares stand for', () => {
    expect(slotsLabel(18)).toBe('18 empty squares, one for each new review still needed')
    expect(slotsLabel(1)).toBe('1 empty square for the new review still needed')
  })
})

describe('the ladder', () => {
  it('climbs from where the goal started to the number possible after it', () => {
    const rungs = rungsOf(CARD_HARBORLINE)

    expect(rungs).toEqual([
      { tenths: 39, tag: 'start' },
      { tenths: 40, tag: 'today' },
      { tenths: 41, tag: 'goal' },
      { tenths: 42, tag: 'possible' },
    ])
    expect(ladderLabel(rungs)).toBe(
      'Started at 3.9. Google shows 4.0 now. Your goal is 4.1. 4.2 is possible after that.',
    )
  })

  it('leaves the start out while Google still shows it', () => {
    expect(rungsOf(CARD_GETTING_STARTED).map((rung) => rung.tag)).toEqual([
      'today',
      'next',
      'goal',
      'possible',
    ])
  })

  it('names the next number when it is not the goal, and a tenth that is coming soon', () => {
    expect(rungsOf(CARD_FAR_GOAL).map((rung) => rung.tag)).toEqual([
      'today',
      'next',
      'goal',
    ])
    expect(ladderLabel(rungsOf(CARD_LAGS_MIDDLE))).toBe(
      'Google shows 4.3 now. Google should show 4.4 soon. Your goal is 4.5. 4.6 is possible after that.',
    )
  })

  it('shows five numbers at most, dropping the start first', () => {
    const six = {
      ...CARD_LAGS_MIDDLE,
      baseline: { ...CARD_LAGS_MIDDLE.baseline, googleShows: 4.2 },
      targetTenths: 46,
      next: { targetTenths: 45, target: 4.5, reviewsNeeded: 180 },
      nextUp: { targetTenths: 47, reviewsBeyondGoal: 300, days: { num: 500, den: 1 } },
    }

    expect(rungsOf(six).map((rung) => rung.tag)).toEqual([
      'today',
      'soon',
      'next',
      'goal',
      'possible',
    ])
  })
})

describe('this week', () => {
  it('counts the week against the plan, on its day', () => {
    expect(thisWeekOf(CARD_HARBORLINE)).toEqual({
      kind: 'week',
      count: 2,
      target: 7,
      value: '2 of 7',
      valueText: '2 of 7 new reviews this week',
      foot: 'It’s Tuesday',
    })
  })

  it('adds the last four weeks once the goal works at its actual pace', () => {
    expect(thisWeekOf(CARD_ACTUAL_PACE)).toMatchObject({
      foot: 'It’s Tuesday · 1 a day over the last 4 weeks',
    })
  })

  it('asks for a pace a day while the goal is new, and nothing for a goal to keep', () => {
    expect(thisWeekOf(CARD_HARBORLINE_JUST_SET)).toEqual({
      kind: 'aim',
      text: 'Aim for about 1 new review a day',
    })
    expect(thisWeekOf(CARD_KEEP)).toBeNull()
  })
})

describe('the first step', () => {
  it('is told once Google shows more than when the goal was set', () => {
    expect(firstStepText(CARD_HARBORLINE)).toBe(
      'Google shows 4.0 now, up from 3.9 when you started.',
    )
    expect(firstStepText(CARD_GETTING_STARTED)).toBeNull()
  })
})
