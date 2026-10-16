// What the Google rating goal wizard sends when the manager saves, and what its
// done screen says. What "Pick a plan" offers is in rating-goal-plan-view.test.ts
// and rating-goal-build-own-view.test.ts.
import { describe, expect, it } from 'vitest'
import { wizardReceipt, wizardSubmission } from './rating-goal-wizard-view'
import {
  CARD,
  CARD_KEEP,
  FIXTURE_PROPERTY_ID,
  SETUP,
} from './rating-goal.stories.fixtures'

const recommended = SETUP.planning?.plans.find((plan) => plan.key === 'recommended')

describe('what is saved', () => {
  it('sets a goal to climb with its pace, or a goal to keep with none', () => {
    expect(wizardSubmission({ kind: 'climb' }, FIXTURE_PROPERTY_ID, 44, 11, 47)).toEqual({
      kind: 'set',
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        mode: 'climb',
        targetTenths: 44,
        qualityTenths: 47,
        // "Pick a plan" works in whole reviews a week; the goal stores tenths.
        paceTenthsPerWeek: 110,
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
        paceTenthsPerWeek: null,
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
        paceTenthsPerWeek: 140,
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
        paceTenthsPerWeek: 110,
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
  it('says the target, the pace and the forecast of the plan set', () => {
    expect(
      wizardReceipt({
        mode: 'climb',
        targetTenths: 44,
        pacePerWeek: 11,
        forecast: recommended?.forecast ?? null,
      }),
    ).toEqual({
      headline: '4.4 on Google',
      pace: 'About 11 new reviews a week',
      forecast: 'Expected around Nov 2026 – Jan 2027',
    })
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
