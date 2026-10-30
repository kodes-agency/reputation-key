import { describe, expect, it } from 'vitest'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import { assembleGuestVoiceV2 } from './guest-voice-v2-build'
import { tallyTopics } from './guest-voice-v2-tally'
import { input, mention, review } from './guest-voice-v2.test-fixtures'

describe('topic tally', () => {
  it('partitions unique mentioning reviews into four disjoint categories and emits all twelve topics', () => {
    const current = [
      review(1, {
        mentions: [mention({ polarity: 'positive' }), mention({ polarity: 'positive' })],
      }),
      review(2),
      review(3, { mentions: [mention(), mention({ polarity: 'positive' })] }),
      review(4, { mentions: [mention({ polarity: 'neutral' })] }),
      review(5),
      review(6),
    ]
    expect(tallyTopics(current).get('cleanliness')?.assessment).toEqual({
      status: 'needs_attention',
      mentionedReviewCount: 6,
      happyReviewCount: 1,
      mixedReviewCount: 1,
      unhappyReviewCount: 3,
      neutralOnlyReviewCount: 1,
      happyShare: 1 / 6,
    })
    const read = assembleGuestVoiceV2(input(current)).read
    expect(read.everyTopic.map((t) => t.topic).sort()).toEqual(
      [...REVIEW_TOPICS_V3].sort(),
    )
    expect(read.everyTopic[0]?.topic).toBe('cleanliness')
  })
})
