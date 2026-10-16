import { describe, expect, it } from 'vitest'
import type { RatingGoalSetupInputs } from '#/contexts/reporting/application/dto/rating-goal-setup.types'
import { workOutRatingGoal } from '#/contexts/reporting/application/rating-goal-setup-plan'
import {
  backToAutomatic,
  backToRecommended,
  chooseChip,
  choicesOf,
  draftFromGoal,
  goToGoal,
  lowerGoal,
  raiseGoal,
  setUnit,
  takeFasterPace,
  toggleOwnAverage,
  toggleOwnPace,
  togglePopover,
  typeOwnAverage,
  typeOwnPace,
  type SetupDraft,
  type SetupPlan,
} from './rating-goal-setup-draft'
import { HARBORLINE, setupInputs } from './rating-goal-setup.stories.fixtures'

function planOf(
  draft: SetupDraft,
  inputs: RatingGoalSetupInputs = HARBORLINE,
): SetupPlan {
  const view = workOutRatingGoal(inputs, choicesOf(draft))
  if (view.kind !== 'plan') throw new Error(`expected a plan, got ${view.kind}`)
  return view
}

describe('the goal under − and +', () => {
  it('pins the goal one up, and lets go when − lands back on the recommendation', () => {
    const raised = raiseGoal({}, planOf({}))
    expect(raised.pin).toBe(42)
    const lowered = lowerGoal(raised, planOf(raised))
    expect(lowered.pin).toBeUndefined()
    expect(planOf(lowered).goal.targetTenths).toBe(41)
  })

  it('says why + does nothing at the highest goal, once, until the next change', () => {
    const top = { pin: 44 }
    const capped = raiseGoal(top, planOf(top))
    expect(capped).toMatchObject({ pin: 44, hint: 'cap' })
    expect(setUnit(capped, 'month').hint).toBeUndefined()
  })

  it('says why − does nothing at the lowest goal', () => {
    const bottom = { pin: 40 }
    expect(lowerGoal(bottom, planOf(bottom)).hint).toBe('low')
  })

  it('keeps the arrow keys, Home and End within the goals the average reaches', () => {
    expect(goToGoal({}, planOf({}), 49).pin).toBe(44)
    expect(goToGoal({}, planOf({}), 10).pin).toBe(40)
    expect(goToGoal({ pin: 43 }, planOf({ pin: 43 }), 41).pin).toBeUndefined()
  })

  it('goes back to the recommendation', () => {
    expect(backToRecommended({ pin: 43, hint: 'cap' })).toEqual({
      pin: undefined,
      hint: undefined,
    })
  })

  it('follows the recommendation when the pace changes, unless pinned', () => {
    expect(planOf(chooseChip({}, 2)).goal.targetTenths).toBe(42)
    expect(planOf(chooseChip({ pin: 41 }, 2)).goal.targetTenths).toBe(41)
  })
})

describe('the faster-pace link (D31)', () => {
  it('keeps the goal it named when the faster chip recommends another', () => {
    const faster = takeFasterPace({ pin: 43 }, 2, 43, 42)
    expect(faster).toMatchObject({ pace: { kind: 'chip', index: 2 }, pin: 43 })
    expect(planOf(faster).goal).toMatchObject({ targetTenths: 43, recommendedTenths: 42 })
  })

  it('follows the recommendation when the goal it named is the one recommended there', () => {
    expect(takeFasterPace({ pin: 42 }, 2, 42, 42).pin).toBeUndefined()
  })
})

describe('the pace the manager types', () => {
  it('opens on the pace shown and goes back to the chip it left', () => {
    const own = toggleOwnPace(chooseChip({}, 3), planOf(chooseChip({}, 3)))
    expect(own).toMatchObject({ pace: { kind: 'own', tenthsPerWeek: 210 }, lastChip: 3 })
    expect(toggleOwnPace(own, planOf(own)).pace).toEqual({ kind: 'chip', index: 3 })
  })

  it('takes a month as typed and words it back', () => {
    expect(typeOwnPace({}, 'month', '20')).toMatchObject({
      pace: { kind: 'own', tenthsPerWeek: 46 },
      paceMessage: undefined,
    })
  })

  it('says what it used when the typed pace is out of range', () => {
    expect(typeOwnPace({}, 'day', '80').paceMessage).toBe(
      'We plan with up to 50 a day, so we used 50 a day.',
    )
    expect(typeOwnPace({}, 'day', '0,1').paceMessage).toBe(
      'We plan with at least 1.4 a week, so we used 1.4 a week.',
    )
    expect(typeOwnPace({}, 'month', 'many').paceMessage).toBe(
      'We plan with at least 6 a month, so we used 6 a month.',
    )
  })
})

describe('the average the manager types', () => {
  it('opens on the average shown, and closes back to automatic', () => {
    const open = toggleOwnAverage({}, planOf({}))
    expect(open.ownAverageTenths).toBe(45)
    expect(toggleOwnAverage(open, planOf(open)).ownAverageTenths).toBeUndefined()
  })

  it('takes a comma or a point', () => {
    expect(typeOwnAverage({}, planOf({}), '4,7')).toMatchObject({
      ownAverageTenths: 47,
      averageMessage: undefined,
    })
  })

  it('says what it used below the floor', () => {
    expect(typeOwnAverage({}, planOf({}), '4.0')).toMatchObject({
      ownAverageTenths: 41,
      averageMessage: 'We plan with 4.1 to 5.0, so we used 4.1.',
    })
  })

  it('says it plans with 5.0 where 5.0 is the floor (a shown 4.8)', () => {
    const shows48 = setupInputs({ reviewCount: 500, displayedTenths: 48 }, 2400)
    expect(typeOwnAverage({}, planOf({}, shows48), '4.9').averageMessage).toBe(
      'We plan with 5.0, so we used 5.0.',
    )
  })

  it('drops a typed and a kept average on Back to automatic', () => {
    expect(
      backToAutomatic({ ownAverageTenths: 47, keptAverageTenths: 46 }),
    ).toMatchObject({
      ownAverageTenths: undefined,
      keptAverageTenths: undefined,
    })
  })
})

describe('the popovers', () => {
  it('open one at a time and close again', () => {
    const why = togglePopover({}, 'why')
    expect(why.open).toBe('why')
    expect(togglePopover(why, 'ask').open).toBe('ask')
    expect(togglePopover(why, 'why').open).toBeUndefined()
  })
})

describe('Change plan', () => {
  it('opens on the goal’s own target and its pace chip', () => {
    const draft = draftFromGoal(HARBORLINE, {
      mode: 'climb',
      targetTenths: 42,
      qualityTenths: 45,
      paceTenthsPerWeek: 70,
    })
    expect(draft).toMatchObject({ pace: { kind: 'chip', index: 1 }, pin: 42 })
    expect(draft.keptAverageTenths).toBeUndefined()
  })

  it('keeps an average that is not today’s automatic one, as the plan’s earlier one (D30)', () => {
    const draft = draftFromGoal(HARBORLINE, {
      mode: 'climb',
      targetTenths: 41,
      qualityTenths: 47,
      paceTenthsPerWeek: 105,
    })
    expect(draft).toMatchObject({
      pace: { kind: 'own', tenthsPerWeek: 105 },
      keptAverageTenths: 47,
      pin: 41,
    })
    expect(planOf(draft).average.source).toBe('earlier')
  })

  it('follows the recommendation when the goal is the one recommended', () => {
    const draft = draftFromGoal(HARBORLINE, {
      mode: 'climb',
      targetTenths: 41,
      qualityTenths: 45,
      paceTenthsPerWeek: 70,
    })
    expect(draft.pin).toBeUndefined()
  })

  it('opens a goal to keep as recommended', () => {
    expect(
      draftFromGoal(HARBORLINE, {
        mode: 'keep',
        targetTenths: 39,
        qualityTenths: null,
        paceTenthsPerWeek: null,
      }),
    ).toEqual({})
  })
})
