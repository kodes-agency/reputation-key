// What the Google rating goal wizard offers and says, from the setup read:
// where the slider opens, what each stop reads as, the paces, a pace typed in,
// and what is sent when the manager saves.
import { describe, expect, it } from 'vitest'
import {
  currentPaceLine,
  howWeWorkItOut,
  openingPace,
  openingTarget,
  outOfReachWarning,
  paceCards,
  paceChoicePerWeek,
  customPaceProblem,
  resolveClimbDraft,
  stopValueText,
  targetLine,
  wizardReceipt,
  wizardSubmission,
  choiceForecast,
} from './rating-goal-wizard-view'
import {
  CARD,
  CARD_KEEP,
  FIXTURE_PROPERTY_ID,
  SETUP,
  SETUP_STOPS,
} from './rating-goal.stories.fixtures'

const stop = (tenths: number) => SETUP_STOPS.find((each) => each.targetTenths === tenths)!

describe('where the slider opens', () => {
  it('opens on the setup’s preselected stop', () => {
    expect(openingTarget(SETUP, { kind: 'climb' })).toBe(44)
  })

  it('opens on the next tenth when asked for it, and on the current target for a change', () => {
    expect(openingTarget(SETUP, { kind: 'climb', preselectTenths: 45 })).toBe(45)
    expect(
      openingTarget(SETUP, { kind: 'change', goal: { ...CARD, targetTenths: 46 } }),
    ).toBe(46)
  })

  it('falls back to the preselected stop when the one asked for is not offered', () => {
    expect(openingTarget(SETUP, { kind: 'climb', preselectTenths: 50 })).toBe(44)
    expect(openingTarget({ ...SETUP, stops: [] }, { kind: 'climb' })).toBeNull()
  })
})

describe('what the two steps hold', () => {
  it('opens where the wizard opens until something is picked', () => {
    expect(resolveClimbDraft(SETUP, { kind: 'climb' }, {})).toEqual({
      stop: stop(44),
      choice: { kind: 'preset', key: 'faster' },
      customPace: 11,
    })
  })

  it('keeps what was picked, and falls back from a target no longer offered', () => {
    const picked = { choice: { kind: 'preset', key: 'steady' }, customPace: 30 } as const

    expect(
      resolveClimbDraft(SETUP, { kind: 'climb' }, { ...picked, target: 46 }),
    ).toEqual({
      stop: stop(46),
      ...picked,
    })
    expect(resolveClimbDraft(SETUP, { kind: 'climb' }, { target: 50 }).stop).toEqual(
      stop(44),
    )
  })
})

describe('what a stop reads as', () => {
  it('says the reviews it needs, or that the recent mix never gets there', () => {
    expect(targetLine(stop(44), SETUP.recentMix)).toBe('About 93 more reviews')
    expect(targetLine(stop(46), SETUP.recentMix)).toBe('About 1,300 more reviews')
    // Each stop is worked out at its own recommended quality: 4.8 at 5.0★.
    expect(targetLine(stop(48), SETUP.recentMix)).toBe('About 1,430 more reviews')
    expect(targetLine({ ...stop(48), reviewsNeeded: null }, SETUP.recentMix)).toBe(
      'Not reachable at your recent 4.7★ mix',
    )
  })

  it('reads as the value of the slider, with its label', () => {
    expect(stopValueText(stop(44), SETUP.recentMix)).toBe(
      '4.4, realistic, about 93 more reviews',
    )
    expect(stopValueText(stop(48), SETUP.recentMix)).toBe(
      '4.8, out of reach, about 1,430 more reviews',
    )
  })

  it('warns about an out-of-reach stop and only then', () => {
    expect(outOfReachWarning(stop(45), SETUP)).toBeNull()
    expect(outOfReachWarning(stop(46), SETUP)).toBe(
      'Out of reach: even at 11 new reviews a week this takes more than a year. You can still pick it.',
    )
    expect(outOfReachWarning({ ...stop(48), reviewsNeeded: null }, SETUP)).toBe(
      'You can still pick it.',
    )
  })

  it('explains the working in three sentences, and says when the numbers are approximate', () => {
    expect(howWeWorkItOut(SETUP, stop(45))).toEqual([
      'We start from Google’s own rating and review count: 4.3 from 812 reviews.',
      'We expect new reviews to keep your last 90 days’ star mix, 4.7★.',
      'Google shows 4.5 once the exact average reaches 4.45.',
    ])
    expect(
      howWeWorkItOut(
        {
          ...SETUP,
          exactAverageSource: 'google',
          recentMix: { average: 3.92, reviewCount: 25, basis: 'most_recent' },
        },
        stop(45),
      ).slice(1),
    ).toEqual([
      'We expect new reviews to keep the star mix of your 25 most recent reviews, 3.92★.',
      'Google shows 4.5 once the exact average reaches 4.45.',
      'RepKey doesn’t hold every review Google counts yet, so these numbers are approximate.',
    ])
  })
})

describe('the paces', () => {
  it('says the pace there is now', () => {
    expect(currentPaceLine(7)).toBe('You get about 7 a week now')
    expect(currentPaceLine(0.25)).toBe('You get fewer than one a week now')
  })

  it('offers Steady, Faster and Push with the forecast for the chosen goal', () => {
    expect(paceCards(SETUP, stop(45))).toEqual([
      {
        key: 'steady',
        name: 'Steady',
        perWeek: '7 a week',
        perMonthAndDay: '30 a month · 1 a day',
        forecast: 'Around Aug 2027 – Feb 2029',
      },
      {
        key: 'faster',
        name: 'Faster',
        perWeek: '11 a week',
        perMonthAndDay: '48 a month · 1.6 a day',
        forecast: 'Around Apr 2027 – Apr 2028',
      },
      {
        key: 'push',
        name: 'Push',
        perWeek: '14 a week',
        perMonthAndDay: '61 a month · 2 a day',
        forecast: 'Around Mar–Dec 2027',
      },
    ])
  })

  it('opens on Faster, or on the pace a goal being changed has', () => {
    expect(openingPace(SETUP, { kind: 'climb' })).toEqual({
      kind: 'preset',
      key: 'faster',
    })
    expect(
      openingPace(SETUP, { kind: 'change', goal: { ...CARD, pacePerWeek: 14 } }),
    ).toEqual({ kind: 'preset', key: 'push' })
    expect(openingPace(SETUP, { kind: 'change', goal: CARD })).toEqual({
      kind: 'preset',
      key: 'faster',
    })
    expect(
      openingPace(SETUP, { kind: 'change', goal: { ...CARD, pacePerWeek: 9 } }),
    ).toEqual({ kind: 'custom', perWeek: 9 })
  })

  it('reads the weekly number of a choice', () => {
    expect(paceChoicePerWeek(SETUP, { kind: 'preset', key: 'push' })).toBe(14)
    expect(paceChoicePerWeek(SETUP, { kind: 'custom', perWeek: 30 })).toBe(30)
  })

  it('takes a whole number from 1 to 200 a week as its own pace', () => {
    expect(customPaceProblem(1)).toBeNull()
    expect(customPaceProblem(200)).toBeNull()
    for (const wrong of [0, 201, 2.5, Number.NaN]) {
      expect(customPaceProblem(wrong)).toBe('Enter a whole number from 1 to 200.')
    }
  })
})

describe('what is saved', () => {
  it('sets a goal to climb with its pace, or a goal to keep with none', () => {
    expect(wizardSubmission({ kind: 'climb' }, FIXTURE_PROPERTY_ID, 44, 11, 47)).toEqual({
      kind: 'set',
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        mode: 'climb',
        targetTenths: 44,
        qualityTenths: 47,
        pacePerWeek: 11,
      },
    })
    expect(
      wizardSubmission(
        { kind: 'keep', targetTenths: 49 },
        FIXTURE_PROPERTY_ID,
        49,
        null,
        null,
      ),
    ).toEqual({
      kind: 'set',
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        mode: 'keep',
        targetTenths: 49,
        qualityTenths: null,
        pacePerWeek: null,
      },
    })
  })

  it('changes only what differs, against the version the wizard opened on', () => {
    expect(
      wizardSubmission({ kind: 'change', goal: CARD }, FIXTURE_PROPERTY_ID, 45, 14, 47),
    ).toEqual({
      kind: 'change',
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        goalId: CARD.goalId,
        expectedVersion: 3,
        pacePerWeek: 14,
      },
    })
    expect(
      wizardSubmission(
        { kind: 'change', goal: CARD_KEEP },
        FIXTURE_PROPERTY_ID,
        44,
        11,
        47,
      ),
    ).toEqual({
      kind: 'change',
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        goalId: CARD_KEEP.goalId,
        expectedVersion: 3,
        mode: 'climb',
        targetTenths: 44,
        qualityTenths: 47,
        pacePerWeek: 11,
      },
    })
  })

  it('has nothing to send when a change changes nothing', () => {
    expect(
      wizardSubmission({ kind: 'change', goal: CARD }, FIXTURE_PROPERTY_ID, 45, 11, 47),
    ).toBeNull()
  })
})

describe('what the done screen says', () => {
  it('says the target, the pace and the forecast of a goal to climb', () => {
    expect(
      wizardReceipt({
        mode: 'climb',
        targetTenths: 44,
        pacePerWeek: 11,
        forecast: choiceForecast(SETUP, stop(44), { kind: 'preset', key: 'faster' }),
      }),
    ).toEqual({
      headline: '4.4 on Google',
      pace: 'About 11 new reviews a week',
      forecast: 'Expected around Nov 2026 – Jan 2027',
    })
  })

  it('works out the forecast of a pace typed in, and none for a pace that is not one', () => {
    expect(choiceForecast(SETUP, stop(44), { kind: 'custom', perWeek: 11 })).toEqual({
      kind: 'range',
      fromMonth: '2026-11',
      toMonth: '2027-01',
    })
    expect(choiceForecast(SETUP, stop(44), { kind: 'custom', perWeek: 0 })).toBeNull()
  })

  it('says only what is kept for a goal to keep', () => {
    expect(
      wizardReceipt({
        mode: 'keep',
        targetTenths: 49,
        pacePerWeek: null,
        forecast: null,
      }),
    ).toEqual({ headline: 'Keeping 4.9 on Google', pace: null, forecast: null })
  })
})
