// A drawer for any issue on a fixture page, so that every title a story shows opens
// something. The hand-written drawers (the agreed design's own example, the Urgent
// review) come first; the rest are worked out from the card they open from.
import type {
  GuestVoiceV2Ready,
  IssueDrawer,
  ReviewTopicV3,
} from '#/contexts/ai/application/public-api'
import {
  issueStatistics,
  type WindowFacts,
} from '#/contexts/ai/application/read-models/issue-statistics'
import {
  FACILITIES_DRAWER,
  SMALL_DRAWER,
  URGENT_DRAWER,
} from './guest-voice-fixtures-drawers'

/** What each topic includes, as the annotation guide words it. */
const DEFINITIONS: Readonly<Record<ReviewTopicV3, string>> = {
  staff_service:
    'How people behaved and performed: friendly, rude, helpful, professional, skilled, attentive. Waiting time belongs to Speed and waiting.',
  speed_waiting:
    'Waiting, queues, slow service, delays, how fast requests were handled. The broken thing itself belongs to Facilities and equipment.',
  booking_arrival:
    'Reservations, appointments, scheduling, check-in and check-out, arrival and departure, cancellations, overbooking.',
  main_service:
    'Quality of the core thing the business sells, apart from food: the room and bed, the haircut, the treatment, the boat or trip.',
  food_drink:
    'Taste, freshness, temperature, portions, menu, breakfast, bar, drinks, dietary options. Prices belong to Price and billing.',
  cleanliness:
    'Dirt, hygiene, smells from dirt, stains, pests, unclean equipment. Something broken belongs to Facilities and equipment.',
  facilities_equipment:
    'Something broken, worn, missing or outdated: air conditioning, plumbing, lifts, furniture, Wi-Fi, TV, pool.',
  price_billing:
    'Price level, value for money, charges, fees, deposits, refunds, billing errors, payment.',
  atmosphere_noise: 'Ambience, decor, music, crowding, noise, vibe, views from inside.',
  location_access:
    'Location, surroundings, parking, getting there, signage, accessibility for wheelchairs or prams.',
  safety:
    'Physical safety and security: injuries, hazards, theft, feeling safe or unsafe. A guest who felt safe is praise.',
  communication:
    'Accuracy of information and listings, replies to messages, language barriers, follow-up after a complaint, clarity of rules.',
}

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

/** A year of mentions with the reviews of the window in its last three months. */
function yearOf(total: number, textReviewsPerMonth: number) {
  const third = Math.floor(total / 3)
  const recent = [third, third, total - 2 * third]
  return MONTHS.map((month, index) => ({
    month,
    complaintReviews: index >= 9 ? (recent[index - 9] ?? 0) : index % 4 === 0 ? 1 : 0,
    textReviews: textReviewsPerMonth,
  }))
}

/** Splits a count over named causes, the first the most: 4, 3, 2, 1 of ten. */
function causesOf(names: readonly string[], total: number) {
  const weights = [0.4, 0.3, 0.2, 0.1]
  const counts = names.map((_, index) => Math.floor(total * (weights[index] ?? 0.1)))
  const left = total - counts.reduce((sum, count) => sum + count, 0)
  return names.map((cause, index) => ({
    cause,
    reviewCount: (counts[index] ?? 0) + (index === 0 ? left : 0),
  }))
}

const KNOWN: readonly IssueDrawer[] = [FACILITIES_DRAWER, URGENT_DRAWER, SMALL_DRAWER]

/**
 * The drawer of one issue of a fixture page, or undefined where the page has no such
 * issue. `window` is what that page's figures were worked out over.
 */
export function drawerForIssue(
  read: GuestVoiceV2Ready,
  issueId: string,
  window: WindowFacts,
): IssueDrawer | undefined {
  const known = KNOWN.find((drawer) => drawer.issueId === issueId)
  if (known !== undefined) return known
  const problem = [...read.urgent, ...read.fixFirst].find(
    (item) => item.issueId === issueId,
  )
  const card = problem ?? read.guestsLove.find((item) => item.issueId === issueId)
  if (card !== undefined) {
    const causes = problem?.causes ?? []
    return {
      issueId,
      title: card.title,
      topic: card.topic,
      definition: DEFINITIONS[card.topic],
      hidden: false,
      statistics: card.statistics,
      twelveMonthSeries: yearOf(
        card.statistics.reviewCount,
        Math.round(window.textReviews / 3),
      ),
      causes: causesOf(causes, card.statistics.reviewCount),
      liveEvidence: card.quote == null ? [] : [card.quote],
    }
  }
  const watched = read.watch.find((item) => item.issueId === issueId)
  if (watched === undefined) return undefined
  const stars =
    watched.reviewCount === 1 ? ([0, 1, 0, 0, 0] as const) : ([0, 1, 1, 0, 0] as const)
  return {
    issueId,
    title: watched.title,
    topic: watched.topic,
    definition: DEFINITIONS[watched.topic],
    hidden: false,
    statistics: issueStatistics(window, { stars }),
    twelveMonthSeries: yearOf(watched.reviewCount, Math.round(window.textReviews / 3)),
    causes: [],
    liveEvidence: [],
  }
}
