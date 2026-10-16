// What the Google rating goal wizard sends when the manager saves, and what its
// done screen says. What the setup screen offers is in the rating-goal-setup-*
// tests.
import { describe, expect, it } from 'vitest'
import {
  keepFirstSentence,
  wizardReceipt,
  wizardSubmission,
} from './rating-goal-wizard-view'
import { CARD, CARD_KEEP, FIXTURE_PROPERTY_ID } from './rating-goal.stories.fixtures'

describe('what is saved', () => {
  it('sets a goal to climb with its pace in tenths a week, or a goal to keep with none', () => {
    expect(wizardSubmission({ kind: 'climb' }, FIXTURE_PROPERTY_ID, 44, 105, 47)).toEqual(
      {
        kind: 'set',
        data: {
          propertyId: FIXTURE_PROPERTY_ID,
          mode: 'climb',
          targetTenths: 44,
          qualityTenths: 47,
          paceTenthsPerWeek: 105,
        },
      },
    )
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
      wizardSubmission({ kind: 'change', goal: CARD }, FIXTURE_PROPERTY_ID, 45, 140, 47),
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
        70,
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
        paceTenthsPerWeek: 70,
      },
    })
  })

  it('has nothing to send when a change changes nothing', () => {
    expect(
      wizardSubmission({ kind: 'change', goal: CARD }, FIXTURE_PROPERTY_ID, 45, 110, 47),
    ).toBeNull()
  })
})

describe('what the done screen says', () => {
  it('says the target, the pace a day and the time the setup showed', () => {
    expect(
      wizardReceipt({
        mode: 'climb',
        targetTenths: 41,
        paceTenthsPerWeek: 70,
        days: { num: 5670, den: 70 },
        likely: { fast: { num: 462_000, den: 7700 }, slow: { num: 721_000, den: 6300 } },
      }),
    ).toEqual({
      headline: '4.1 on Google',
      pace: 'About 1 a day · about 7 a week',
      forecast: 'In about 3 months, likely 9 weeks to 4 months.',
    })
  })

  it('says a goal far away the way the setup did', () => {
    expect(
      wizardReceipt({
        mode: 'climb',
        targetTenths: 47,
        paceTenthsPerWeek: 30,
        days: { num: 11_690, den: 3 },
        likely: { fast: { num: 2121, den: 1 }, slow: null },
      }).forecast,
    ).toBe('More than 3 years away, likely more than 3 years.')
  })

  it('says only what is kept for a goal to keep', () => {
    expect(
      wizardReceipt({
        mode: 'keep',
        targetTenths: 49,
        paceTenthsPerWeek: null,
        days: null,
        likely: null,
      }),
    ).toEqual({ headline: 'Keeping 4.9 on Google', pace: null, forecast: null })
  })
})

describe('Keep first at 4.7 and 4.8 (X1)', () => {
  it('says why keeping is suggested, where a climb is still possible', () => {
    expect(keepFirstSentence(47)).toBe(
      '4.8 needs new reviews averaging 4.9★ or more, so we suggest keeping 4.7.',
    )
    expect(keepFirstSentence(48)).toBe(
      '4.9 needs every new review to be 5★, so we suggest keeping 4.8.',
    )
  })

  it('says nothing where there is no higher number', () => {
    expect(keepFirstSentence(49)).toBeNull()
    expect(keepFirstSentence(50)).toBeNull()
  })
})
