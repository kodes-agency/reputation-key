import { FIXTURE_WINDOW_CONTEXT } from './guest-voice-fixtures-build'
// The drawers the stories open: the hotel's Facilities and equipment (the agreed design's
// own example), an Urgent review, and the guesthouse's Cleanliness, which has more
// reviews than it can quote.
import type { IssueDrawer } from '#/contexts/ai/application/public-api'
import { fixtureId, quoteOf } from './guest-voice-fixtures-build'
import { FACILITIES_ID, LARGE_STATISTICS } from './guest-voice-fixtures-large'
import {
  RAILING_ISSUE,
  RAILING_QUOTE,
  RAILING_STATISTICS,
} from './guest-voice-fixtures-states'
import { SMALL_CLEANLINESS, SMALL_CLEANLINESS_ID } from './guest-voice-fixtures-small'

/** The 12 months to Oct 2026, oldest first. */
const MONTHS = [
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
] as const

const series = (complaints: readonly number[], texts: readonly number[]) =>
  MONTHS.map((month, index) => ({
    month,
    startLocalDate: `${month}-01`,
    endLocalDate: `${month}-28`,
    partialStart: false,
    partialEnd: true,
    reviewCount: complaints[index] ?? 0,
    complaintReviews: complaints[index] ?? 0,
    textReviews: texts[index] ?? 0,
  }))

const TOPIC_DEFINITION =
  'Something the guest used was broken, worn or missing: air conditioning, heating, plumbing, lifts, furniture, equipment, Wi-Fi, TV, pool, gym kit. A working room that is only uncomfortable belongs to The main service, and dirt to Cleanliness. The same topic for every kind of business.'

export const FACILITIES_DRAWER: IssueDrawer = {
  issueId: FACILITIES_ID,
  title: 'Facilities and equipment',
  topic: 'facilities_equipment',
  kind: 'issue',
  sense: 'complaint',
  context: FIXTURE_WINDOW_CONTEXT,
  lastMentionedLocalDate: '2026-10-29',
  commentComparison: {
    population: 'current_analysed_comments',
    mentionedCount: 0,
    otherCount: 0,
    mentionedAverage: null,
    othersAverage: null,
  },
  linkedConcerns: [],
  historyCoverage: 'twelve_months',
  matchingReviews: {
    startLocalDate: '2025-10-30',
    endLocalDate: '2026-10-29',
    issueId: null,
    sense: 'complaint',
  },
  definition: TOPIC_DEFINITION,
  hidden: false,
  statistics: LARGE_STATISTICS.facilities,
  // The last three months are the 19 reviews of the 90-day window.
  twelveMonthSeries: series(
    [2, 1, 2, 2, 2, 3, 3, 3, 4, 5, 6, 8],
    [38, 35, 36, 40, 37, 41, 39, 42, 44, 43, 41, 44],
  ),
  causes: [
    { cause: 'Air conditioning', reviewCount: 7 },
    { cause: 'Shower', reviewCount: 5 },
    { cause: 'Furniture', reviewCount: 4 },
    { cause: 'Lift', reviewCount: 3 },
  ],
  liveEvidence: [
    quoteOf({
      id: fixtureId('b', 1),
      rating: 2,
      reviewedAt: '2026-10-18',
      text: "Great location and a lovely room. But the air conditioning didn't work for two nights and nobody came to fix it. Breakfast was excellent.",
      cited: [2],
    }),
    quoteOf({
      id: fixtureId('b', 11),
      rating: 3,
      reviewedAt: '2026-10-09',
      text: 'Our AC was blowing warm air the whole stay, reception said a technician was coming tomorrow. The beds were comfortable.',
      cited: [1],
    }),
    quoteOf({
      id: fixtureId('b', 12),
      rating: 3,
      reviewedAt: '2026-09-27',
      text: 'Great location, but the air con in 214 is noisy and barely cools.',
      cited: [1],
    }),
  ],
}

/** One review, a long one: a cited sentence in the middle of a story, to be quoted in part. */
export const LONG_REVIEW_DRAWER: IssueDrawer = {
  ...FACILITIES_DRAWER,
  liveEvidence: [
    quoteOf({
      id: fixtureId('b', 13),
      rating: 2,
      reviewedAt: '2026-10-05',
      text: [
        'We booked three nights for our anniversary and the first evening could not have gone better.',
        'The porter carried our bags up, the receptionist remembered our names and the restaurant found us a table by the window without a reservation.',
        'The trouble started at bedtime, when the lift stopped between the second and third floor for twenty minutes with the two of us inside.',
        'It was fixed the next morning, and then the shower lost its pressure.',
        'Breakfast was lovely both mornings and the walk along the harbour in the evening made up for a good deal.',
        'We would stay again if the building were looked after.',
      ].join(' '),
      cited: [3, 4],
    }),
  ],
}

export const HIDDEN_DRAWER: IssueDrawer = { ...FACILITIES_DRAWER, hidden: true }

export const URGENT_DRAWER: IssueDrawer = {
  issueId: RAILING_ISSUE.issueId,
  title: 'Balcony railing',
  topic: 'safety',
  kind: 'issue',
  sense: 'complaint',
  context: FIXTURE_WINDOW_CONTEXT,
  lastMentionedLocalDate: '2026-10-29',
  commentComparison: {
    population: 'current_analysed_comments',
    mentionedCount: 0,
    otherCount: 0,
    mentionedAverage: null,
    othersAverage: null,
  },
  linkedConcerns: [],
  historyCoverage: 'twelve_months',
  matchingReviews: {
    startLocalDate: '2025-10-30',
    endLocalDate: '2026-10-29',
    issueId: null,
    sense: 'complaint',
  },
  definition:
    'Physical safety and security: injuries, hazards, theft, feeling safe or unsafe. A guest who felt safe is praise. The same topic for every kind of business.',
  hidden: false,
  statistics: RAILING_STATISTICS,
  twelveMonthSeries: series(
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [38, 35, 36, 40, 37, 41, 39, 42, 44, 43, 41, 44],
  ),
  causes: [{ cause: 'Loose', reviewCount: 1 }],
  liveEvidence: [RAILING_QUOTE],
}

/** Five reviews name it and three can be quoted: two name a person, so they are not. */
export const SMALL_DRAWER: IssueDrawer = {
  issueId: SMALL_CLEANLINESS_ID,
  title: 'Cleanliness',
  topic: 'cleanliness',
  kind: 'issue',
  sense: 'complaint',
  context: FIXTURE_WINDOW_CONTEXT,
  lastMentionedLocalDate: '2026-10-29',
  commentComparison: {
    population: 'current_analysed_comments',
    mentionedCount: 0,
    otherCount: 0,
    mentionedAverage: null,
    othersAverage: null,
  },
  linkedConcerns: [],
  historyCoverage: 'twelve_months',
  matchingReviews: {
    startLocalDate: '2025-10-30',
    endLocalDate: '2026-10-29',
    issueId: null,
    sense: 'complaint',
  },
  definition:
    'Dirt, hygiene, smells from dirt, stains, pests, unclean equipment. Something broken belongs to Facilities and equipment. The same topic for every kind of business.',
  hidden: false,
  statistics: SMALL_CLEANLINESS,
  twelveMonthSeries: series(
    [0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 2, 0],
    [2, 3, 3, 4, 2, 3, 3, 4, 3, 3, 3, 3],
  ),
  causes: [
    { cause: 'Bathroom', reviewCount: 3 },
    { cause: 'Bedding', reviewCount: 2 },
  ],
  liveEvidence: [
    quoteOf({
      id: fixtureId('b', 21),
      rating: 2,
      reviewedAt: '2026-09-21',
      text: 'The room was cosy. The bathroom had not been cleaned and the sheets smelled of smoke.',
      cited: [2],
    }),
    quoteOf({
      id: fixtureId('b', 23),
      rating: 1,
      reviewedAt: '2026-09-02',
      text: 'Hair in the shower drain and a dusty windowsill. Not what the photos showed.',
      cited: [1],
    }),
    quoteOf({
      id: fixtureId('b', 24),
      rating: 3,
      reviewedAt: '2026-06-17',
      text: 'Comfortable bed, but the bathroom floor was sticky when we arrived.',
      cited: [1],
    }),
  ],
}
