// A small guesthouse: about three reviews with text a month, so the page has chosen the
// whole year (36 reviews with text, 14 with only stars). The 12 months before the window
// hold too few reviews for the engine to judge a change, so no issue has a trend.
import type {
  FixFirstItem,
  GuestsLoveItem,
  GuestVoiceV2NotEnough,
  GuestVoiceV2Ready,
  InShortLine,
  ReviewTopicV3,
  TopicRow,
  WatchItem,
} from '#/contexts/ai/application/public-api'
import {
  issueStatistics,
  type StarCounts,
  type WindowFacts,
} from '#/contexts/ai/application/read-models/issue-statistics'
import { PROPERTY_ID, fixtureId, quoteOf } from './guest-voice-fixtures-build'

export const SMALL_WINDOW: WindowFacts = {
  textReviews: 36,
  allReviews: 50,
  stars: [4, 5, 7, 14, 20],
  baselineReviews: 12,
}

export const SMALL_CLEANLINESS_ID = fixtureId('a', 21)
const SPEED_ID = fixtureId('a', 22)
const STAFF_ID = fixtureId('a', 23)
const FOOD_ID = fixtureId('a', 24)

export const SMALL_CLEANLINESS = issueStatistics(SMALL_WINDOW, { stars: [2, 1, 1, 1, 0] })
const speed = issueStatistics(SMALL_WINDOW, { stars: [1, 1, 1, 0, 0] })
const staff = issueStatistics(SMALL_WINDOW, { stars: [0, 0, 1, 6, 13] })
const food = issueStatistics(SMALL_WINDOW, { stars: [0, 0, 1, 4, 7] })

const fixFirst: readonly FixFirstItem[] = [
  {
    issueId: SMALL_CLEANLINESS_ID,
    title: 'Cleanliness',
    topic: 'cleanliness',
    causes: ['Bathroom', 'Bedding'],
    urgentReason: null,
    statistics: SMALL_CLEANLINESS,
    quote: quoteOf({
      id: fixtureId('b', 21),
      rating: 2,
      reviewedAt: '2026-09-21',
      text: 'The room was cosy. The bathroom had not been cleaned and the sheets smelled of smoke.',
      cited: [2],
    }),
  },
  {
    issueId: SPEED_ID,
    title: 'Speed and waiting',
    topic: 'speed_waiting',
    causes: ['Breakfast'],
    urgentReason: null,
    statistics: speed,
    quote: null,
  },
]

const watch: readonly WatchItem[] = [
  {
    issueId: fixtureId('a', 25),
    title: 'Parking',
    topic: 'location_access',
    reviewCount: 1,
  },
  {
    issueId: fixtureId('a', 26),
    title: 'Wi-Fi',
    topic: 'facilities_equipment',
    reviewCount: 2,
  },
]

const guestsLove: readonly GuestsLoveItem[] = [
  {
    issueId: STAFF_ID,
    title: 'Staff and service',
    topic: 'staff_service',
    statistics: staff,
    quote: quoteOf({
      id: fixtureId('b', 22),
      rating: 5,
      reviewedAt: '2026-10-12',
      text: 'The owners treated us like family.',
      cited: [1],
    }),
  },
  {
    issueId: FOOD_ID,
    title: 'Food and drink',
    topic: 'food_drink',
    statistics: food,
    quote: null,
  },
]

const inShort: readonly InShortLine[] = [
  {
    kind: 'fix_first',
    issueId: SMALL_CLEANLINESS_ID,
    topic: 'cleanliness',
    text: `Cleanliness is the top problem: ${SMALL_CLEANLINESS.shareText} reviews, mostly the bathroom. Those reviews average ${SMALL_CLEANLINESS.mentionedAverage?.toFixed(1)}★.`,
  },
  {
    kind: 'protect',
    issueId: STAFF_ID,
    topic: 'staff_service',
    text: `Guests love your staff: ${staff.shareText} reviews praise them.`,
  },
]

type TopicSpec = Readonly<{
  topic: ReviewTopicV3
  praise: number
  complaints: number
  stars: StarCounts
}>

const TOPIC_SPECS: readonly TopicSpec[] = [
  { topic: 'staff_service', praise: 20, complaints: 1, stars: [0, 1, 1, 6, 13] },
  { topic: 'food_drink', praise: 12, complaints: 2, stars: [0, 1, 1, 4, 8] },
  { topic: 'location_access', praise: 6, complaints: 1, stars: [0, 0, 1, 2, 4] },
  { topic: 'cleanliness', praise: 2, complaints: 5, stars: [2, 1, 1, 2, 1] },
  { topic: 'price_billing', praise: 3, complaints: 1, stars: [1, 1, 0, 1, 1] },
  { topic: 'speed_waiting', praise: 1, complaints: 3, stars: [1, 1, 1, 1, 0] },
  { topic: 'communication', praise: 1, complaints: 0, stars: [0, 0, 0, 0, 1] },
]

const everyTopic: readonly TopicRow[] = TOPIC_SPECS.map((spec) => ({
  topic: spec.topic,
  praiseReviews: spec.praise,
  complaintReviews: spec.complaints,
  neutralReviews: 0,
  statistics: issueStatistics(SMALL_WINDOW, { stars: spec.stars }),
}))

/** Guest voice 2.0 for the guesthouse: counts and early signals, with no trend to claim. */
export const SMALL_READ: GuestVoiceV2Ready = {
  status: 'ready',
  readModelVersion: 'guest-voice-read-v2',
  statisticsVersion: 'guest-voice-statistics-v1',
  window: '365d',
  startLocalDate: '2025-10-30',
  endLocalDate: '2026-10-29',
  dataThroughLocalDate: '2026-10-29',
  provisional: false,
  basis: { textReviewCount: 36, starOnlyCount: 14 },
  inShort,
  urgent: [],
  fixFirst,
  guestsLove,
  staffPraise: { reviewCount: 2, inboxHref: `/inbox?propertyId=${PROPERTY_ID}` },
  watch,
  whatChanged: [],
  everyTopic,
}

/** A guesthouse with four reviews with text in a year: nothing to rank, so the latest. */
export const NOT_ENOUGH_READ: GuestVoiceV2NotEnough = {
  status: 'not_enough_reviews',
  readModelVersion: 'guest-voice-read-v2',
  textReviewCount: 4,
  latestReviews: [
    {
      inboxItemId: fixtureId('b', 31),
      reviewedAt: '2026-10-27',
      rating: 5,
      text: 'Quiet, clean and very friendly. We will be back.',
    },
    {
      inboxItemId: fixtureId('b', 32),
      reviewedAt: '2026-10-14',
      rating: 4,
      text: 'Breakfast could be a bit more varied, but the room was great.',
    },
    // Names a person, so the page shows its stars and day and the way to the Inbox.
    { inboxItemId: fixtureId('b', 33), reviewedAt: '2026-09-30', rating: 2, text: null },
    {
      inboxItemId: fixtureId('b', 34),
      reviewedAt: '2026-09-12',
      rating: 5,
      text: 'Perfect for a weekend away.',
    },
  ],
}
