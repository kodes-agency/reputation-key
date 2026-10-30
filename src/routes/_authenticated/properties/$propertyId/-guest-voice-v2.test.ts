import { describe, expect, it } from 'vitest'
import type { GuestVoiceV2Read } from '#/contexts/ai/application/public-api'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import {
  guestVoiceGoalOf,
  guestVoiceReasonOf,
  guestVoiceV2PageOf,
  guestVoiceV2RangeOf,
  guestVoiceV2View,
} from './-guest-voice-v2'

const NOT_ENOUGH: GuestVoiceV2Read = {
  status: 'not_enough_reviews',
  checkInVersion: 'guest-voice-check-in-v1',
  context: {
    window: '365d',
    startLocalDate: '2025-10-30',
    endLocalDate: '2026-10-29',
    dataThroughLocalDate: '2026-10-29',
    provisional: false,
    basis: { textReviewCount: 4, starOnlyCount: 0, analysedTextReviewCount: 4 },
  },
  seriousConcerns: {
    items: [],
    groupCount: 0,
    reviewCount: 0,
    remainingGroupCount: 0,
    remainingReviewCount: 0,
    coverage: 'complete',
  },
  allReviewCount: 4,
  latestReviewCount: 0,
  readModelVersion: 'guest-voice-read-v2',
  textReviewCount: 4,
  latestReviews: [],
}

describe('guestVoiceV2PageOf', () => {
  it('draws 2.0 for a page, including the one that says there are too few reviews', () => {
    expect(guestVoiceV2PageOf(NOT_ENOUGH)).toBe(NOT_ENOUGH)
  })

  it.each(['disabled', 'preparing', 'not_v3'] as const)(
    'draws no page when the answer is %s',
    (status) => {
      expect(guestVoiceV2PageOf({ status })).toBeNull()
    },
  )

  it('draws no page when there is no answer', () => {
    expect(guestVoiceV2PageOf(undefined)).toBeNull()
  })
})

describe('guestVoiceReasonOf', () => {
  it('says AI is off when it is', () => {
    expect(guestVoiceReasonOf({ status: 'disabled' })).toBe('disabled')
  })

  // Nothing analysed under v3 yet is the replay not having reached the Property: the same
  // thing to a manager as an analysis still being prepared.
  it.each(['preparing', 'not_v3'] as const)(
    'says it is being prepared when %s',
    (status) => {
      expect(guestVoiceReasonOf({ status })).toBe('preparing')
    },
  )

  it('says nothing for a page, whatever it holds, and for no answer yet', () => {
    expect(guestVoiceReasonOf(NOT_ENOUGH)).toBeNull()
    expect(guestVoiceReasonOf(undefined)).toBeNull()
  })
})

describe('guestVoiceV2RangeOf', () => {
  it('reads a bookmark that still says "All time" as the automatic window', () => {
    expect(guestVoiceV2RangeOf('all')).toBe('auto')
  })

  it.each(['auto', '30d', '90d', '180d', '365d'] as const)('keeps %s', (range) => {
    expect(guestVoiceV2RangeOf(range)).toBe(range)
  })
})

describe('guestVoiceV2View', () => {
  it('has no drawer until the drawer has a read to show', () => {
    const view = guestVoiceV2View(NOT_ENOUGH)

    expect(view.read).toBe(NOT_ENOUGH)
    expect(view.drawer).toBeUndefined()
  })

  it('carries where the Google rating goal stands, and none by default', () => {
    expect(guestVoiceV2View(NOT_ENOUGH).ratingGoal).toBeNull()
    const goal = { mode: 'climb', target: 4.6, shows: 4.4, status: 'below_pace' } as const

    expect(guestVoiceV2View(NOT_ENOUGH, goal).ratingGoal).toBe(goal)
  })
})

describe('guestVoiceGoalOf', () => {
  const card = (over: Partial<RatingGoalCardView> = {}) =>
    ({
      state: 'active',
      mode: 'climb',
      target: 4.6,
      status: 'below_pace',
      google: {
        shows: 4.4,
        reviewCount: 120,
        asOf: '2026-10-30T06:00:00.000Z',
        current: true,
      },
      ...over,
    }) as RatingGoalCardView

  it('names an active goal by its target, Google’s number and its pace', () => {
    expect(guestVoiceGoalOf(card())).toEqual({
      mode: 'climb',
      target: 4.6,
      shows: 4.4,
      status: 'below_pace',
    })
  })

  it('names a goal Google shows no number for, without one', () => {
    expect(guestVoiceGoalOf(card({ google: null }))?.shows).toBeNull()
    expect(
      guestVoiceGoalOf(
        card({
          google: {
            shows: null,
            reviewCount: 0,
            asOf: '2026-10-30T06:00:00.000Z',
            current: false,
          },
        }),
      )?.shows,
    ).toBeNull()
  })

  it('names a keep goal as one', () => {
    expect(guestVoiceGoalOf(card({ mode: 'keep', status: 'holding' }))).toMatchObject({
      mode: 'keep',
      status: 'holding',
    })
  })

  it.each(['reached', 'ended'] as const)('says nothing of a goal that is %s', (state) => {
    expect(guestVoiceGoalOf(card({ state }))).toBeNull()
  })

  it('says nothing when the card could not be read', () => {
    expect(guestVoiceGoalOf(undefined)).toBeNull()
    expect(guestVoiceGoalOf(null)).toBeNull()
  })
})
