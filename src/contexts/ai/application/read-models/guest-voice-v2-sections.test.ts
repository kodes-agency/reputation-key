import { describe, expect, it } from 'vitest'
import { assembleGuestVoiceV2 } from './guest-voice-v2-build'
import { OTHER, group, input, mention, review } from './guest-voice-v2.test-fixtures'

describe('section totals and summary populations', () => {
  it('preserves list caps and exposes exact eligible totals while topics deduplicate overlapping issues', () => {
    const groups = new Map(
      Array.from({ length: 30 }, (_, n) => [String(n), { ...group, id: String(n) }]),
    )
    const complaints = Array.from({ length: 9 }, (_, n) =>
      [0, 1, 2].map((k) =>
        review(n * 3 + k, { mentions: [mention({ issueGroupId: String(n) })] }),
      ),
    ).flat()
    const praise = Array.from({ length: 7 }, (_, n) =>
      [0, 1, 2].map((k) =>
        review(100 + n * 3 + k, {
          mentions: [mention({ issueGroupId: String(n + 9), polarity: 'positive' })],
        }),
      ),
    ).flat()
    const watch = Array.from({ length: 14 }, (_, n) =>
      review(200 + n, { mentions: [mention({ issueGroupId: String(n + 16) })] }),
    )
    const read = assembleGuestVoiceV2(
      input([...complaints, ...praise, ...watch], { groups }),
    ).read
    expect(read.sectionTotals).toEqual({ fixFirst: 9, guestsLove: 7, watch: 14 })
    expect(read.remainingCounts).toEqual({ fixFirst: 1, guestsLove: 2, watch: 2 })
    expect([read.fixFirst.length, read.guestsLove.length, read.watch.length]).toEqual([
      8, 5, 12,
    ])
    const overlap = review(300, {
      mentions: [
        mention(),
        mention({ issueGroupId: OTHER }),
        mention({ polarity: 'positive' }),
      ],
    })
    const topic = assembleGuestVoiceV2(input([overlap])).read.everyTopic.find(
      (t) => t.topic === 'cleanliness',
    )
    expect(topic).toMatchObject({
      complaintReviews: 1,
      praiseReviews: 1,
      assessment: { mentionedReviewCount: 1, mixedReviewCount: 1 },
    })
  })
  it('keeps happy-share ordering ahead of unjudged topics with taxonomy order breaking ties', () => {
    const current = Array.from({ length: 6 }, (_, n) =>
      review(n, {
        mentions: [
          mention({ topic: 'staff_service', polarity: 'positive' }),
          mention({ topic: 'price_billing', polarity: n < 3 ? 'positive' : 'negative' }),
          mention({ topic: 'food_drink', polarity: n < 4 ? 'positive' : 'negative' }),
          mention({ topic: 'cleanliness', polarity: 'negative' }),
        ],
      }),
    )
    expect(
      assembleGuestVoiceV2(input(current))
        .read.everyTopic.slice(0, 4)
        .map((t) => [t.topic, t.assessment.status]),
    ).toEqual([
      ['cleanliness', 'needs_attention'],
      ['price_billing', 'mixed'],
      ['food_drink', 'doing_well'],
      ['staff_service', 'great'],
    ])
  })
})
