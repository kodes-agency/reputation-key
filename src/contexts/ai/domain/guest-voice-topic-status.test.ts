import { describe, expect, it } from 'vitest'
import { guestVoiceTopicStatus } from './guest-voice-topic-status'

describe('guestVoiceTopicStatus', () => {
  it.each([0, 1, 3, 5])(
    'withholds judgement below six unique mentions (%i)',
    (mentionedReviews) => {
      expect(
        guestVoiceTopicStatus({ mentionedReviews, happyReviews: mentionedReviews }),
      ).toEqual({ status: 'unjudged', happyShare: null })
    },
  )
  it.each([
    [44, 'needs_attention'],
    [45, 'mixed'],
    [64, 'mixed'],
    [65, 'doing_well'],
    [79, 'doing_well'],
    [80, 'great'],
    [100, 'great'],
  ] as const)('uses the unrounded happy share at %i percent', (happyReviews, status) => {
    expect(guestVoiceTopicStatus({ mentionedReviews: 100, happyReviews })).toEqual({
      status,
      happyShare: happyReviews / 100,
    })
  })
  it('judges exactly six mentions', () => {
    expect(guestVoiceTopicStatus({ mentionedReviews: 6, happyReviews: 5 }).status).toBe(
      'great',
    )
  })
})
