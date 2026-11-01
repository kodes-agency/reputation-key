// What the Google rating goal card says about the climb (2026-11-01): the new reviews to
// the next number Google can show, the goal's own total, and this week against the plan.
import { describe, expect, it } from 'vitest'
import {
  goalLineText,
  headlineText,
  reviewCountText,
  soonText,
  thisWeekOf,
  weekdayName,
} from './rating-goal-tracking-words'
import {
  CARD_ACTUAL_PACE,
  CARD_FAR_GOAL,
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
    expect(headlineText(CARD_GOOGLE_SOURCE)).toBe('About 18 new reviews to 4.1')
    expect(reviewCountText(212, true)).toBe('About 212 new reviews')
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
    expect(goalLineText({ ...CARD_FAR_GOAL, exactAverageSource: 'google' })).toBe(
      'About 212 new reviews to your goal, 4.5.',
    )
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

describe('the day of the Property’s week', () => {
  it.each([
    [1, 'Monday'],
    [2, 'Tuesday'],
    [3, 'Wednesday'],
    [4, 'Thursday'],
    [5, 'Friday'],
    [6, 'Saturday'],
    [7, 'Sunday'],
  ])('names day %i %s', (weekday, name) => {
    expect(weekdayName(weekday)).toBe(name)
  })
})
