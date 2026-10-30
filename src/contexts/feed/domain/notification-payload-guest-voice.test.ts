import { describe, expect, it } from 'vitest'
import { parseNotificationPayload } from './notification-payload'

const LINE = {
  kind: 'fix_first',
  topic: 'facilities_equipment',
  reviewCount: 19,
  textReviewCount: 128,
  upToHundredths: 20,
} as const

describe('the Guest voice summary payload', () => {
  it('keeps the kind, the window and the lines of the page', () => {
    const lines = [
      LINE,
      { kind: 'protect', topic: 'staff_service', reviewCount: 61, textReviewCount: 128 },
      {
        kind: 'change',
        topic: 'cleanliness',
        reviewCount: 12,
        textReviewCount: 128,
        change: 'falling',
        polarity: 'complaint',
      },
    ]

    expect(
      parseNotificationPayload({
        guestVoiceKind: 'monthly',
        guestVoiceWindow: '180d',
        guestVoiceLines: lines,
      }),
    ).toEqual({
      guestVoiceKind: 'monthly',
      guestVoiceWindow: '180d',
      guestVoiceLines: lines,
    })
  })

  it('drops what it does not recognise, a line at a time', () => {
    const parsed = parseNotificationPayload({
      guestVoiceKind: 'daily',
      guestVoiceWindow: '7d',
      guestVoiceLines: [
        LINE,
        { ...LINE, topic: 'a_made_up_topic' },
        { ...LINE, kind: 'quote' },
        { ...LINE, reviewCount: -1 },
        { ...LINE, textReviewCount: 1.5 },
        'a sentence of a review',
        null,
      ],
    })

    expect(parsed).toEqual({ guestVoiceLines: [LINE] })
  })

  it('keeps at most three lines', () => {
    const parsed = parseNotificationPayload({
      guestVoiceLines: [LINE, LINE, LINE, LINE, LINE],
    })

    expect(parsed.guestVoiceLines).toHaveLength(3)
  })

  it('keeps a figure only on the line it is for', () => {
    const parsed = parseNotificationPayload({
      guestVoiceLines: [
        { ...LINE, kind: 'protect', change: 'rising', polarity: 'praise' },
        {
          kind: 'change',
          topic: 'cleanliness',
          reviewCount: 3,
          textReviewCount: 40,
          upToHundredths: 15,
          change: 'rising',
          polarity: 'praise',
        },
      ],
    })

    expect(parsed.guestVoiceLines).toEqual([
      {
        kind: 'protect',
        topic: 'facilities_equipment',
        reviewCount: 19,
        textReviewCount: 128,
      },
      {
        kind: 'change',
        topic: 'cleanliness',
        reviewCount: 3,
        textReviewCount: 40,
        change: 'rising',
        polarity: 'praise',
      },
    ])
  })

  it('refuses a figure that is not a plausible worth in stars', () => {
    const parsed = parseNotificationPayload({
      guestVoiceLines: [{ ...LINE, upToHundredths: 501 }],
    })

    expect(parsed.guestVoiceLines).toEqual([
      {
        kind: 'fix_first',
        topic: 'facilities_equipment',
        reviewCount: 19,
        textReviewCount: 128,
      },
    ])
  })

  it('carries nothing a line might smuggle in beside its facts', () => {
    const parsed = parseNotificationPayload({
      guestVoiceLines: [
        {
          ...LINE,
          issueTitle: 'air conditioning not working',
          quote: 'the aircon broke',
          reviewId: '61ed98fc-9cf8-44e9-b49d-cd25e744fd6c',
        },
      ],
    })

    expect(Object.keys(parsed.guestVoiceLines?.[0] ?? {}).sort()).toEqual([
      'kind',
      'reviewCount',
      'textReviewCount',
      'topic',
      'upToHundredths',
    ])
  })
})

describe('the topics a Guest voice summary states', () => {
  it('are the twelve of review analysis v3, in its order, named as the page names them', async () => {
    // Feed's domain restates the taxonomy (it reads nothing outside shared/domain), so
    // this is what keeps the two from drifting apart.
    const { REVIEW_TOPICS_V3, REVIEW_TOPIC_LABELS_V3 } =
      await import('#/shared/review-topic-taxonomy')
    const { NOTIFICATION_GUEST_VOICE_TOPICS } =
      await import('./notification-payload-guest-voice')
    const { GUEST_VOICE_TOPIC_LABELS } =
      await import('./notification-templates-guest-voice')

    expect([...NOTIFICATION_GUEST_VOICE_TOPICS]).toEqual([...REVIEW_TOPICS_V3])
    expect(GUEST_VOICE_TOPIC_LABELS).toEqual(REVIEW_TOPIC_LABELS_V3)
  })
})
