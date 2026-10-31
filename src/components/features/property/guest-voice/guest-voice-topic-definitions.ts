import type { ReviewTopicV3 } from '#/contexts/ai/application/public-api'

/** Product copy only: never import provider prompts into a browser. */
export const TOPIC_DEFINITIONS: Readonly<Record<ReviewTopicV3, string>> = {
  staff_service: 'How the team treats and helps guests.',
  speed_waiting: 'Waiting times and how quickly service happens.',
  booking_arrival: 'Booking, arrival and getting started.',
  main_service: 'The core experience guests came for.',
  food_drink: 'The food and drinks guests receive.',
  cleanliness: 'How clean and fresh the property feels.',
  facilities_equipment: 'The condition and availability of spaces and equipment.',
  price_billing: 'Prices, charges, payments and value.',
  atmosphere_noise: 'The atmosphere, comfort and noise.',
  location_access: 'The location and how easily guests can reach it.',
  safety: 'How safe guests feel and the risks they report.',
  communication: 'The clarity and accuracy of information guests receive.',
}
