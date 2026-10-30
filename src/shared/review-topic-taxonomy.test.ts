import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  REVIEW_TOPICS_V3,
  REVIEW_TOPIC_LABELS_V3,
  REVIEW_TOPIC_TAXONOMY_V3_DIGEST,
  REVIEW_TOPIC_TAXONOMY_VERSION,
  isReviewTopicV3,
  type ReviewTopicV3,
} from './review-topic-taxonomy'

describe('review topic taxonomy v3', () => {
  it('pins the twelve topics in annotation-guide order', () => {
    expect(REVIEW_TOPIC_TAXONOMY_VERSION).toBe('review-topic-taxonomy-v3')
    expect(REVIEW_TOPICS_V3).toEqual([
      'staff_service',
      'speed_waiting',
      'booking_arrival',
      'main_service',
      'food_drink',
      'cleanliness',
      'facilities_equipment',
      'price_billing',
      'atmosphere_noise',
      'location_access',
      'safety',
      'communication',
    ])
    expect(Object.isFrozen(REVIEW_TOPICS_V3)).toBe(true)
  })

  it('pins the display label for every topic', () => {
    expect(REVIEW_TOPIC_LABELS_V3).toEqual({
      staff_service: 'Staff and service',
      speed_waiting: 'Speed and waiting',
      booking_arrival: 'Booking and arrival',
      main_service: 'The main service',
      food_drink: 'Food and drink',
      cleanliness: 'Cleanliness',
      facilities_equipment: 'Facilities and equipment',
      price_billing: 'Price and billing',
      atmosphere_noise: 'Atmosphere and noise',
      location_access: 'Location and access',
      safety: 'Safety',
      communication: 'Communication',
    })
    expect(Object.isFrozen(REVIEW_TOPIC_LABELS_V3)).toBe(true)
  })

  it('recognises only governed topic identifiers', () => {
    const topic: string = 'cleanliness'
    expect(isReviewTopicV3(topic)).toBe(true)
    if (isReviewTopicV3(topic)) {
      const governed: ReviewTopicV3 = topic
      expect(governed).toBe('cleanliness')
    }
    expect(isReviewTopicV3('service')).toBe(false)
    expect(isReviewTopicV3(' Cleanliness ')).toBe(false)
  })

  it('pins the browser-safe taxonomy digest', () => {
    expect(REVIEW_TOPIC_TAXONOMY_V3_DIGEST).toBe(
      '6d69e3f14e8ca3ef34b6078db763ca719c4613f11ab9bf4a4d05391a50b30eb0',
    )
    expect(REVIEW_TOPIC_TAXONOMY_V3_DIGEST).toBe(
      createHash('sha256')
        .update('repkey-review-topic-taxonomy-v3\0', 'utf8')
        .update(canonicalizeRfc8785(REVIEW_TOPICS_V3), 'utf8')
        .digest('hex'),
    )
  })
})
