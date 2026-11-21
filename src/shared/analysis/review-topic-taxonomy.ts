// Browser-safe public contract: keep the digest literal and verify it in Node tests.
export const REVIEW_TOPIC_TAXONOMY_VERSION = 'review-topic-taxonomy-v3' as const
export const REVIEW_TOPIC_TAXONOMY_V3_DIGEST =
  '6d69e3f14e8ca3ef34b6078db763ca719c4613f11ab9bf4a4d05391a50b30eb0' as const

export const REVIEW_TOPICS_V3 = Object.freeze([
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
] as const)

export type ReviewTopicV3 = (typeof REVIEW_TOPICS_V3)[number]

export const REVIEW_TOPIC_LABELS_V3: Readonly<Record<ReviewTopicV3, string>> =
  Object.freeze({
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

const REVIEW_TOPIC_SET = new Set<string>(REVIEW_TOPICS_V3)

export function isReviewTopicV3(value: string): value is ReviewTopicV3 {
  return REVIEW_TOPIC_SET.has(value)
}
