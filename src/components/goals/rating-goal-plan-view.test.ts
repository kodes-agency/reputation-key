// "Pick a plan" from the setup read: the three plans on the one shared quality,
// what that quality is and why, "Your plan" for a change, and how the picks move
// between a plan card and "Build your own" (round 2, R2-6 and R2-7).
import { describe, expect, it } from 'vitest'
import type { RatingGoalSetupView } from '#/contexts/reporting/application/dto/rating-goal.types'
import {
  closeOwn,
  openOwn,
  ownFrom,
  pickCard,
  planCards,
  currentPlanCard,
  qualityAssumption,
  resolvePlanDraft,
  starsToTenths,
  type PlanDraft,
} from './rating-goal-plan-view'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'
import { SETUP_BETA } from './rating-goal-plan.stories.fixtures'
import { CARD, CARD_KEEP, SETUP } from './rating-goal.stories.fixtures'

function planningOf(setup: RatingGoalSetupView) {
  if (setup.planning === null) throw new Error('the fixture plans')
  return setup.planning
}

const resolve = (
  draft: PlanDraft,
  intent: RatingGoalWizardIntent = { kind: 'climb' },
  setup: RatingGoalSetupView = SETUP_BETA,
) => {
  const resolved = resolvePlanDraft(setup, planningOf(setup), intent, draft)
  if (resolved === null) throw new Error('the fixture has plans')
  return resolved
}

const shown = (setup: RatingGoalSetupView) =>
  planCards(planningOf(setup), null).map(({ name, target, line, forecastText }) => ({
    name,
    target,
    line,
    forecastText,
  }))

describe('the plans', () => {
  it('open the beta property on 4.0 at its best year’s 4.5★, Ambitious on 4.2', () => {
    expect(shown(SETUP_BETA)).toEqual([
      {
        name: 'Cautious',
        target: '4.0',
        line: '1 a week · new reviews 4.5★ · 19 reviews',
        forecastText: 'Around Jan–Apr 2027',
      },
      {
        name: 'Recommended',
        target: '4.0',
        line: '2 a week · new reviews 4.5★ · 19 reviews',
        forecastText: 'Around Dec 2026 – Jan 2027',
      },
      {
        name: 'Ambitious',
        target: '4.2',
        line: '3 a week · new reviews 4.5★ · 178 reviews',
        forecastText: 'Around Aug 2027 – Jul 2028',
      },
    ])
  })

  it('open the healthy property on 4.4 at the recent 4.7★', () => {
    expect(shown(SETUP).map(({ name, line }) => [name, line])).toEqual([
      ['Cautious', '7 a week · new reviews 4.7★ · 93 reviews'],
      ['Recommended', '11 a week · new reviews 4.7★ · 93 reviews'],
      ['Ambitious', '14 a week · new reviews 4.7★ · 1,300 reviews'],
    ])
  })

  it('warn on a plan more than a year away at its own pace, and only there', () => {
    const cautions = (setup: RatingGoalSetupView) =>
      planCards(planningOf(setup), null).map(({ name, caution }) => [name, caution])

    // Ambitious: 178 reviews at 3 a week, and 1,300 at 14 a week.
    for (const setup of [SETUP_BETA, SETUP]) {
      expect(cautions(setup)).toEqual([
        ['Cautious', null],
        ['Recommended', null],
        ['Ambitious', 'More than a year'],
      ])
    }
  })

  it('say the quality they share and the evidence for it', () => {
    expect(qualityAssumption(planningOf(SETUP_BETA))).toBe(
      'Plans assume new reviews average 4.5★, like your best year (2024)',
    )
    expect(qualityAssumption(planningOf(SETUP))).toBe(
      'Plans assume new reviews average 4.7★, like your recent reviews',
    )
  })
})

describe('a change', () => {
  it('shows the goal’s own plan first, as "Your plan", and opens on it', () => {
    const resolved = resolve({}, { kind: 'change', goal: CARD }, SETUP)

    expect(resolved.cards.map((card) => card.key)).toEqual([
      'current',
      'cautious',
      'recommended',
      'ambitious',
    ])
    expect(resolved.checked).toBe('current')
    expect(resolved.cards[0]).toMatchObject({
      name: 'Your plan',
      target: '4.5',
      line: '11 a week · new reviews 4.7★ · 455 reviews',
      values: { targetTenths: 45, qualityTenths: 47, pacePerWeek: 11 },
    })
    expect(resolved.own).toEqual(ownFrom(resolved.cards[0]!.values))
  })

  it('has no "Your plan" for a goal that keeps a number, and opens on Recommended', () => {
    const intent: RatingGoalWizardIntent = { kind: 'change', goal: CARD_KEEP }

    expect(currentPlanCard(SETUP, intent)).toBeNull()
    expect(resolve({}, intent, SETUP).checked).toBe('recommended')
  })
})

describe('Build your own', () => {
  it('opens on the plan picked, and is the plan while it is open', () => {
    const closed = resolve({})
    const draft = openOwn({}, closed)
    const open = resolve(draft)

    expect(closed).toMatchObject({ checked: 'recommended', ownOpen: false })
    expect(open).toMatchObject({ checked: null, ownOpen: true })
    expect(open.own).toEqual({
      target: { own: false, value: 40 },
      quality: { own: false, value: 4.5 },
      pace: { own: false, value: 2 },
    })
    expect(resolve(closeOwn(draft))).toMatchObject({
      checked: 'recommended',
      ownOpen: false,
    })
  })

  it('keeps what it holds when a card is picked and it is opened again', () => {
    const built: PlanDraft = {
      ...openOwn({}, resolve({})),
      own: { ...resolve({}).own, pace: { own: true, value: 5 } },
    }
    const picked = pickCard(built, 'ambitious')

    expect(resolve(picked)).toMatchObject({ checked: 'ambitious', ownOpen: false })
    expect(resolve(openOwn(picked, resolve(picked))).own.pace).toEqual({
      own: true,
      value: 5,
    })
  })

  it('falls back to where the step opens when the card picked is gone', () => {
    expect(resolve({ selection: 'current', previous: 'current' }).checked).toBe(
      'recommended',
    )
  })
})

describe('an average typed in', () => {
  it('is a whole tenth of a star or nothing', () => {
    expect(starsToTenths(4.5)).toBe(45)
    expect(starsToTenths(4.1)).toBe(41)
    expect(starsToTenths(4.55)).toBeNaN()
    expect(starsToTenths(Number.NaN)).toBeNaN()
  })
})
