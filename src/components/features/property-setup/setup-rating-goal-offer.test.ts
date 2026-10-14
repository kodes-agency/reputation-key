import { describe, expect, it } from 'vitest'
import {
  SETUP,
  SETUP_FEW_REVIEWS,
  SETUP_KEEP_FIRST,
} from '#/components/goals/rating-goal.stories.fixtures'
import {
  importRatingGoalOffer,
  ratingGoalImportProperty,
  waitsForGoogle,
} from './setup-rating-goal-offer'

const property = (n: number) => ({
  propertyId: `00000000-0000-4000-8000-00000000000${n}`,
  propertyName: `Property ${n}`,
})

describe('ratingGoalImportProperty', () => {
  it('names the Property of a single-Property import', () => {
    expect(ratingGoalImportProperty([property(1)])).toBe(property(1).propertyId)
  })

  it('names none for a multi-Property import: the setup strip reminds each', () => {
    expect(ratingGoalImportProperty([property(1), property(2)])).toBeNull()
    expect(ratingGoalImportProperty([])).toBeNull()
  })
})

describe('importRatingGoalOffer', () => {
  it('offers the wizard when Google’s numbers are in and a goal can be set', () => {
    expect(importRatingGoalOffer(SETUP)).toEqual({
      kind: 'offer',
      intent: { kind: 'climb' },
    })
  })

  it('offers keeping the number when nothing higher is in reach', () => {
    expect(importRatingGoalOffer(SETUP_KEEP_FIRST)).toEqual({
      kind: 'offer',
      intent: { kind: 'keep', targetTenths: 50 },
    })
  })

  it('says nothing while Google’s numbers are not in yet', () => {
    const waiting = {
      ...SETUP,
      eligibility: { eligible: false, reason: 'waiting_for_google' },
    } as const
    expect(importRatingGoalOffer(waiting)).toEqual({ kind: 'nothing' })
    expect(importRatingGoalOffer(undefined)).toEqual({ kind: 'nothing' })
  })

  it('says nothing below ten Google reviews, or when a goal is already set', () => {
    expect(importRatingGoalOffer(SETUP_FEW_REVIEWS)).toEqual({ kind: 'nothing' })
    expect(importRatingGoalOffer({ ...SETUP, hasActiveGoal: true })).toEqual({
      kind: 'nothing',
    })
  })
})

describe('waitsForGoogle', () => {
  it('waits until the setup is read and while Google’s numbers are not in', () => {
    expect(waitsForGoogle(undefined)).toBe(true)
    expect(
      waitsForGoogle({
        ...SETUP,
        eligibility: { eligible: false, reason: 'waiting_for_google' },
      }),
    ).toBe(true)
  })

  it('stops once there is an answer: an offer, or a reason no goal can be set', () => {
    expect(waitsForGoogle(SETUP)).toBe(false)
    expect(waitsForGoogle(SETUP_FEW_REVIEWS)).toBe(false)
  })
})
