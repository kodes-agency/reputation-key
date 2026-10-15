// "Build your own" from the setup read: each row's options (one Recommended)
// and "Own", what the average row says the target needs, the plain words for a
// number that cannot be set, and the live total, all from the engine's own
// planning (round 2, R2-6 to R2-9).
import { describe, expect, it } from 'vitest'
import type { RatingGoalForecastInputs } from '#/contexts/reporting/application/dto/rating-goal.types'
import {
  ownPreview,
  ownTotal,
  paceOptions,
  pickFromRadio,
  qualityFloorStars,
  qualityHint,
  qualityOptions,
  rowChecked,
  rowProblems,
  targetOptions,
} from './rating-goal-build-own-view'
import type { OwnPlan } from './rating-goal-plan-view'
import { SETUP_BETA } from './rating-goal-plan.stories.fixtures'
import { SETUP } from './rating-goal.stories.fixtures'

function inputsOf(setup: typeof SETUP): RatingGoalForecastInputs {
  if (setup.forecastInputs === null) throw new Error('the fixture has inputs')
  return setup.forecastInputs
}

const BETA = inputsOf(SETUP_BETA)
const BETA_PLANNING = SETUP_BETA.planning!

/** The beta property's Recommended plan, as "Build your own" opens on it. */
const OWN: OwnPlan = {
  target: { own: false, value: 40 },
  quality: { own: false, value: 4.5 },
  pace: { own: false, value: 2 },
}

describe('the rows', () => {
  it('offer the target row with its labels, the recommendation marked', () => {
    expect(
      targetOptions(BETA_PLANNING).map(({ title, chip, recommended }) => [
        title,
        chip?.label,
        recommended,
      ]),
    ).toEqual([
      ['4.0', 'Realistic', true],
      ['4.1', 'Stretch', false],
      ['4.2', 'Out of reach', false],
    ])
  })

  it('offer the averages the evidence gives, each with its cost for the target', () => {
    expect(
      qualityOptions(BETA, 40).map(({ title, detail, recommended }) => [
        title,
        detail,
        recommended,
      ]),
    ).toEqual([
      ['4.3★', 'A step above what 4.0 needs · about 29 reviews', false],
      ['4.5★', 'Like your best year (2024) · about 19 reviews', true],
      ['4.8★', 'Excellent · about 12 reviews', false],
    ])
    expect(qualityOptions(inputsOf(SETUP), 44).map(({ detail }) => detail)).toEqual([
      'Like now · about 93 reviews',
      'Excellent · about 73 reviews',
    ])
  })

  it('offer Steady, Faster (recommended) and Push', () => {
    expect(
      paceOptions(SETUP_BETA, BETA_PLANNING).map(({ title, detail, recommended }) => [
        title,
        detail,
        recommended,
      ]),
    ).toEqual([
      ['Steady', '1 a week', false],
      ['Faster', '2 a week', true],
      ['Push', '3 a week', false],
    ])
  })

  it('check "Own" when it was chosen or no option holds the value', () => {
    const options = qualityOptions(BETA, 40)

    expect(rowChecked({ own: false, value: 4.5 }, options)).toBe('4.5')
    expect(rowChecked({ own: true, value: 4.5 }, options)).toBe('own')
    expect(rowChecked({ own: false, value: 4.6 }, options)).toBe('own')
    expect(pickFromRadio('own', { own: false, value: 4.5 }, options)).toEqual({
      own: true,
      value: 4.5,
    })
    expect(pickFromRadio('4.8', { own: true, value: 4.6 }, options)).toEqual({
      own: false,
      value: 4.8,
    })
  })

  it('say what the target needs and what recent reviews averaged', () => {
    expect(qualityHint(SETUP_BETA, 40)).toBe(
      'For 4.0 on Google, new reviews need to average above 3.95★. Your last 25 averaged 3.92★.',
    )
    expect(qualityHint(SETUP, 44)).toBe(
      'For 4.4 on Google, new reviews need to average above 4.35★. Your last 90 days averaged 4.7★.',
    )
    expect(qualityFloorStars(BETA, 40)).toBe(4.1)
  })
})

describe('the live total', () => {
  it('is the reviews it takes and when, as the engine works it out', () => {
    expect(ownTotal(ownPreview(BETA, OWN), OWN)).toBe(
      '19 more reviews · around Dec 2026 – Jan 2027',
    )
  })

  it('cautions above twice the pace there is now', () => {
    const fast = { ...OWN, pace: { own: true, value: 30 } }

    expect(ownPreview(BETA, fast)).toMatchObject({ valid: true, surgeCaution: true })
    expect(ownPreview(BETA, OWN)).toMatchObject({ valid: true, surgeCaution: false })
  })

  it('names what cannot be set in plain words, the average held to the target’s floor', () => {
    const tooLow = { ...OWN, quality: { own: true, value: 4 } }
    const notATenth = { ...OWN, quality: { own: true, value: 4.55 } }
    const noPace = { ...OWN, pace: { own: true, value: 0 } }

    expect(rowProblems(ownPreview(BETA, tooLow), tooLow).quality).toBe(
      'For 4.0, pick 4.1★ or more: any nearer 3.95★ and the reviews needed climb very fast.',
    )
    expect(rowProblems(ownPreview(BETA, notATenth), notATenth).quality).toBe(
      'Enter an average up to 5.0★, in steps of 0.1.',
    )
    expect(rowProblems(ownPreview(BETA, noPace), noPace)).toEqual({
      target: null,
      quality: null,
      pace: 'Enter a whole number from 1 to 200.',
    })
    expect(ownTotal(ownPreview(BETA, noPace), noPace)).toBe(
      'Fix the number marked above to see what this plan takes.',
    )
  })
})
