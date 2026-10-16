// What the card and the detail say about when a goal arrives: durations from
// today in the setup's words, never a month (round 5, PLAN-D E1).
import { describe, expect, it } from 'vitest'
import {
  arrivalLine,
  arrivalSentence,
  possibleSentence,
  shortArrival,
} from './rating-goal-arrival-words'
import { CARD, CARD_KEEP } from './rating-goal.stories.fixtures'

/** Harborline at the set: 81 reviews at 1 a day; 60 at the fast end, 103 at the slow one. */
const HARBORLINE_ARRIVAL = {
  kind: 'days',
  central: { num: 81 * 7000, den: 7000 },
  fast: { num: 60 * 7700, den: 7700 },
  slow: { num: 103 * 7000, den: 70 * 90 },
} as const

const HARBORLINE_CARD = {
  ...CARD,
  targetTenths: 41,
  target: 4.1,
  paceTenthsPerWeek: 70,
  forecast: HARBORLINE_ARRIVAL,
  forecastBasis: 'chosen_pace' as const,
}

const AVERAGE = 'at your plan’s 4.5★'

describe('when the card says the goal arrives', () => {
  it('says the setup’s words at the chosen pace (Harborline: about 3 months, 9 weeks to 4 months)', () => {
    expect(arrivalSentence(HARBORLINE_CARD, AVERAGE)).toBe(
      '4.1 in about 3 months at your 1 a day, likely 9 weeks to 4 months.',
    )
  })

  it('names the last 4 weeks once the goal works at its actual pace', () => {
    expect(
      arrivalSentence({ ...HARBORLINE_CARD, forecastBasis: 'actual_pace' }, AVERAGE),
    ).toBe(
      '4.1 in about 3 months at your pace of the last 4 weeks, likely 9 weeks to 4 months.',
    )
  })

  it('leaves the likely range open when 0.1★ less never gets there', () => {
    const open = { ...HARBORLINE_ARRIVAL, slow: null }

    expect(arrivalSentence({ ...HARBORLINE_CARD, forecast: open }, AVERAGE)).toBe(
      '4.1 in about 3 months at your 1 a day, likely 9 weeks or more.',
    )
  })

  it('says only that a goal past three years is that far away', () => {
    const far = {
      kind: 'days',
      central: { num: 1200, den: 1 },
      fast: { num: 900, den: 1 },
      slow: null,
    } as const

    expect(arrivalSentence({ ...HARBORLINE_CARD, forecast: far }, AVERAGE)).toBe(
      '4.1 is more than 3 years away at this pace.',
    )
  })

  it('says why there is no time to give', () => {
    expect(
      arrivalSentence({ ...HARBORLINE_CARD, forecast: { kind: 'no_pace' } }, AVERAGE),
    ).toBe('No new reviews in the last 4 weeks to work out when.')
    expect(
      arrivalSentence(
        { ...HARBORLINE_CARD, forecast: { kind: 'unreachable' } },
        'at the new reviews’ average',
      ),
    ).toBe('No pace reaches 4.1 at the new reviews’ average.')
    expect(arrivalSentence(CARD_KEEP, AVERAGE)).toBeNull()
  })
})

describe('an arrival on a line of its own', () => {
  it('starts with a capital and stops', () => {
    expect(arrivalLine(HARBORLINE_ARRIVAL, 4.1, AVERAGE)).toBe(
      'In about 3 months, likely 9 weeks to 4 months.',
    )
    expect(arrivalLine({ kind: 'earned' }, 4.1, AVERAGE)).toBe(
      'Google should show 4.1 soon.',
    )
  })
})

describe('the narrow card’s short arrival (D4)', () => {
  it('names the goal and when, without the pace or the range', () => {
    expect(shortArrival(HARBORLINE_CARD)).toBe('4.1 in about 3 months')
  })

  it('says more than 3 years away past three years', () => {
    const far = { num: 1200, den: 1 }

    expect(
      shortArrival({
        ...HARBORLINE_CARD,
        forecast: { ...HARBORLINE_ARRIVAL, central: far, fast: far, slow: far },
      }),
    ).toBe('4.1 is more than 3 years away')
  })

  it('has none without a time: the full sentence says why', () => {
    expect(shortArrival({ ...HARBORLINE_CARD, forecast: { kind: 'no_pace' } })).toBeNull()
    expect(shortArrival(CARD_KEEP)).toBeNull()
  })
})

describe('the number above the goal', () => {
  it('is possible in about N (R4-4: Harborline’s 4.2 in about 6 months)', () => {
    const nextUp = { targetTenths: 42, reviewsBeyondGoal: 97, days: { num: 178, den: 1 } }

    expect(possibleSentence({ nextUp, status: 'on_pace' })).toBe(
      '4.2 is possible in about 6 months.',
    )
  })

  it('is not said past three years, nor without one', () => {
    const far = { targetTenths: 42, reviewsBeyondGoal: 900, days: { num: 1100, den: 1 } }

    expect(possibleSentence({ nextUp: far, status: 'on_pace' })).toBeNull()
    expect(possibleSentence({ nextUp: null, status: 'on_pace' })).toBeNull()
  })

  it('is not said while the card waits for Google’s latest numbers', () => {
    const nextUp = { targetTenths: 42, reviewsBeyondGoal: 97, days: { num: 178, den: 1 } }

    expect(possibleSentence({ nextUp, status: 'waiting_for_google' })).toBeNull()
  })
})
