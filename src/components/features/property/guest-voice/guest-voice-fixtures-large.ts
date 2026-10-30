// A hotel that gets about 128 reviews with text in 90 days (and 96 with only stars):
// the shape of the largest beta hotel, with invented guests. The figures come from the
// engine through `issueStatistics`; the quotes are invented.
import type {
  ChangedItem,
  FixFirstItem,
  GuestsLoveItem,
  GuestVoiceV2Ready,
  InShortLine,
  WatchItem,
} from '#/contexts/ai/application/public-api'
import {
  issueStatistics,
  type WindowFacts,
} from '#/contexts/ai/application/read-models/issue-statistics'
import { PROPERTY_ID, fixtureId, quoteOf } from './guest-voice-fixtures-build'
import { largeTopicRows } from './guest-voice-fixtures-large-topics'

export const LARGE_WINDOW: WindowFacts = {
  textReviews: 128,
  allReviews: 224,
  stars: [12, 14, 20, 60, 118],
  baselineReviews: 480,
}

export const FACILITIES_ID = fixtureId('a', 1)
const CLEANLINESS_ID = fixtureId('a', 2)
const SPEED_ID = fixtureId('a', 3)
const PRICE_ID = fixtureId('a', 4)
const STAFF_ID = fixtureId('a', 5)
const LOCATION_ID = fixtureId('a', 6)
const FOOD_ID = fixtureId('a', 7)

const facilities = issueStatistics(LARGE_WINDOW, { stars: [7, 6, 4, 2, 0], before: 36 })
const cleanliness = issueStatistics(LARGE_WINDOW, { stars: [5, 5, 6, 4, 1], before: 84 })
const speed = issueStatistics(LARGE_WINDOW, { stars: [2, 3, 4, 3, 1], before: 90 })
const price = issueStatistics(LARGE_WINDOW, { stars: [1, 2, 0, 0, 0], before: 5 })
const staff = issueStatistics(LARGE_WINDOW, { stars: [0, 1, 3, 26, 64], before: 340 })
const location = issueStatistics(LARGE_WINDOW, { stars: [0, 0, 2, 12, 26], before: 150 })
const food = issueStatistics(LARGE_WINDOW, { stars: [0, 1, 2, 10, 18], before: 110 })

export const LARGE_STATISTICS = { facilities, cleanliness, speed, price, staff }

const facilitiesQuote = quoteOf({
  id: fixtureId('b', 1),
  rating: 2,
  reviewedAt: '2026-10-18',
  text: "Great location and a lovely room. But the air conditioning didn't work for two nights and nobody came to fix it. Breakfast was excellent.",
  cited: [2],
})

const fixFirst: readonly FixFirstItem[] = [
  {
    issueId: FACILITIES_ID,
    title: 'Facilities and equipment',
    topic: 'facilities_equipment',
    causes: ['Air conditioning', 'Shower', 'Furniture', 'Lift'],
    urgentReason: null,
    statistics: facilities,
    quote: facilitiesQuote,
  },
  {
    issueId: CLEANLINESS_ID,
    title: 'Cleanliness',
    topic: 'cleanliness',
    causes: ['Bathroom', 'Bedding', 'Floors', 'Smell'],
    urgentReason: null,
    statistics: cleanliness,
    quote: quoteOf({
      id: fixtureId('b', 2),
      rating: 2,
      reviewedAt: '2026-10-11',
      text: 'Check-in was quick. Hair in the shower and stained towels, not what you expect at this price. The staff were apologetic.',
      cited: [2],
    }),
  },
  {
    issueId: SPEED_ID,
    title: 'Speed and waiting',
    topic: 'speed_waiting',
    causes: ['Breakfast', 'Check-in queue', 'Room service'],
    urgentReason: null,
    statistics: speed,
    quote: quoteOf({
      id: fixtureId('b', 3),
      rating: 3,
      reviewedAt: '2026-10-02',
      text: 'We waited forty minutes for breakfast and nobody said sorry. The food itself was fine.',
      cited: [1],
    }),
  },
  {
    issueId: PRICE_ID,
    title: 'Price and billing',
    topic: 'price_billing',
    causes: ['Deposit', 'Checkout charges'],
    urgentReason: null,
    statistics: price,
    quote: quoteOf({
      id: fixtureId('b', 4),
      rating: 1,
      reviewedAt: '2026-10-24',
      text: "They took a deposit nobody told us about and it still hasn't been returned.",
      cited: [1],
    }),
  },
]

const watch: readonly WatchItem[] = [
  {
    issueId: fixtureId('a', 8),
    title: 'Noise',
    topic: 'atmosphere_noise',
    reviewCount: 2,
  },
  {
    issueId: fixtureId('a', 9),
    title: 'Parking',
    topic: 'location_access',
    reviewCount: 1,
  },
  {
    issueId: fixtureId('a', 10),
    title: 'Wi-Fi',
    topic: 'facilities_equipment',
    reviewCount: 1,
  },
]

const guestsLove: readonly GuestsLoveItem[] = [
  {
    issueId: STAFF_ID,
    title: 'Staff and service',
    topic: 'staff_service',
    statistics: staff,
    quote: quoteOf({
      id: fixtureId('b', 5),
      rating: 5,
      reviewedAt: '2026-10-20',
      text: 'The front desk team went out of their way to help us.',
      cited: [1],
    }),
  },
  {
    issueId: LOCATION_ID,
    title: 'Location and access',
    topic: 'location_access',
    statistics: location,
    quote: quoteOf({
      id: fixtureId('b', 6),
      rating: 5,
      reviewedAt: '2026-10-15',
      text: "Five minutes' walk to everything, lovely views.",
      cited: [1],
    }),
  },
  {
    issueId: FOOD_ID,
    title: 'Food and drink',
    topic: 'food_drink',
    statistics: food,
    quote: quoteOf({
      id: fixtureId('b', 7),
      rating: 4,
      reviewedAt: '2026-10-09',
      text: 'Great breakfast with fresh pastries every morning.',
      cited: [1],
    }),
  },
]

const whatChanged: readonly ChangedItem[] = [
  {
    issueId: FACILITIES_ID,
    title: 'Facilities and equipment',
    topic: 'facilities_equipment',
    change: 'rising',
    evidenceLevel: 'likely',
    statistics: facilities,
    polarity: 'complaint',
  },
  {
    issueId: SPEED_ID,
    title: 'Speed and waiting',
    topic: 'speed_waiting',
    change: 'falling',
    evidenceLevel: 'likely',
    statistics: speed,
    polarity: 'complaint',
  },
]

const inShort: readonly InShortLine[] = [
  {
    kind: 'fix_first',
    issueId: FACILITIES_ID,
    topic: 'facilities_equipment',
    text: `Facilities and equipment is the top problem: ${facilities.shareText} reviews, mostly air conditioning and the shower. Those reviews average ${facilities.mentionedAverage?.toFixed(1)}★.`,
  },
  {
    kind: 'protect',
    issueId: STAFF_ID,
    topic: 'staff_service',
    text: `Guests love your staff: ${staff.shareText} reviews praise them, most often at check-in.`,
  },
  {
    kind: 'change',
    issueId: FACILITIES_ID,
    topic: 'facilities_equipment',
    text: `Facilities and equipment is rising: ${facilities.shareText} reviews now, more than in the 12 months before.`,
  },
]

/** Guest voice 2.0 for the hotel: 128 reviews with text in the 90 days the page chose. */
export const LARGE_READ: GuestVoiceV2Ready = {
  status: 'ready',
  readModelVersion: 'guest-voice-read-v2',
  statisticsVersion: 'guest-voice-statistics-v2',
  window: '90d',
  startLocalDate: '2026-07-31',
  endLocalDate: '2026-10-29',
  dataThroughLocalDate: '2026-10-29',
  provisional: false,
  basis: { textReviewCount: 128, starOnlyCount: 96 },
  inShort,
  urgent: [],
  fixFirst,
  guestsLove,
  staffPraise: { reviewCount: 4, inboxHref: `/inbox?propertyId=${PROPERTY_ID}` },
  watch,
  whatChanged,
  everyTopic: largeTopicRows(LARGE_WINDOW),
}
