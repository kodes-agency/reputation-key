import { describe, expect, it } from 'vitest'
import type { GuestVoiceV2Read } from '#/contexts/ai/application/public-api'
import { guestVoiceV2PageOf, guestVoiceV2View } from './-guest-voice-v2'

const NOT_ENOUGH: GuestVoiceV2Read = {
  status: 'not_enough_reviews',
  readModelVersion: 'guest-voice-read-v2',
  textReviewCount: 4,
  latestReviews: [],
}

describe('guestVoiceV2PageOf', () => {
  it('draws 2.0 for a page, including the one that says there are too few reviews', () => {
    expect(guestVoiceV2PageOf(NOT_ENOUGH)).toBe(NOT_ENOUGH)
  })

  it.each(['disabled', 'preparing', 'not_v3'] as const)(
    'leaves today’s page to draw when the answer is %s',
    (status) => {
      expect(guestVoiceV2PageOf({ status })).toBeNull()
    },
  )

  it('leaves today’s page to draw when there is no answer', () => {
    expect(guestVoiceV2PageOf(undefined)).toBeNull()
  })
})

describe('guestVoiceV2View', () => {
  it('opens no drawer until the drawer has a read to show', () => {
    const view = guestVoiceV2View(NOT_ENOUGH)

    expect(view.read).toBe(NOT_ENOUGH)
    expect(view.openIssueId).toBeNull()
    expect(view.onOpenIssueChange('any')).toBeUndefined()
    expect(view.onNotRight).toBeUndefined()
  })
})
