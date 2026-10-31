// Entirely synthetic, dated populations. Page and detail figures use production builders.
import type {
  GuestVoiceDetailTarget,
  GuestVoiceV2NotEnough,
} from '#/contexts/ai/application/public-api'
import {
  assembleGuestVoiceV2,
  guestVoiceWindowContext,
  type GuestVoiceBuildInput,
} from '#/contexts/ai/application/read-models/guest-voice-v2-build'
import { buildGuestVoiceDetail } from '#/contexts/ai/application/read-models/guest-voice-v2-details'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceReview,
  GuestVoiceMention,
} from '#/contexts/ai/application/read-models/guest-voice-v2-facts'
import { ratingCountsOf } from '#/contexts/ai/application/aspect-review-evidence'
import { addDays } from '#/contexts/ai/application/local-date'
import { reviewId } from '#/shared/domain/ids'
import { PROPERTY_ID, fixtureId, quoteOf } from './guest-voice-fixtures-build'

const definitions: readonly [GuestVoiceIssueGroup['topic'], string, string, boolean][] = [
  ['cleanliness', 'room', 'musty smell', false],
  ['facilities_equipment', 'room', 'worn furniture', false],
  ['price_billing', 'parking', 'unexpected charge', false],
  ['booking_arrival', 'arrival', 'booking not ready', false],
  ['staff_service', 'team', 'friendly and helpful', true],
  ['location_access', 'location', 'easy to reach', true],
  ['food_drink', 'breakfast', 'varied choices', true],
  ['atmosphere_noise', 'atmosphere', 'peaceful', true],
  ['main_service', 'experience', 'well organised', true],
  ['communication', 'information', 'unclear directions', false],
  ['speed_waiting', 'service', 'long wait', false],
  ['safety', 'parking', 'reported break-in', false],
]
const groups = new Map(
  definitions.map(([topic, thing], index) => {
    const id = fixtureId('a', index + 1)
    return [
      id,
      { id, topic, canonicalThing: thing, displayName: null, hidden: false },
    ] as const
  }),
)
function mention(index: number, ordinal: number): GuestVoiceMention {
  const d = definitions[index]
  if (!d) throw new Error('Unknown synthetic issue')
  return {
    mentionOrdinal: ordinal,
    topic: d[0],
    thing: d[1],
    cause: d[2],
    issueGroupId: fixtureId('a', index + 1),
    polarity: d[3] ? 'positive' : 'negative',
    strength: 'clear',
    namesPerson: null,
  }
}
// Inclusive review-index ranges, in mention order. Quiet populations omit complaints.
const issuePopulations = [
  { issue: 0, start: 0, end: 8, quiet: false },
  { issue: 1, start: 9, end: 17, quiet: false },
  { issue: 2, start: 18, end: 25, quiet: false },
  { issue: 3, start: 26, end: 30, quiet: false },
  { issue: 4, start: 70, end: Infinity, quiet: true },
  { issue: 5, start: 90, end: 111, quiet: true },
  { issue: 6, start: 100, end: 119, quiet: true },
  { issue: 7, start: 115, end: 126, quiet: true },
  { issue: 8, start: 126, end: Infinity, quiet: true },
  { issue: 9, start: 40, end: 40, quiet: false },
  { issue: 10, start: 41, end: 41, quiet: false },
  { issue: 11, start: 3, end: 4, quiet: false },
] as const

function syntheticMentions(index: number, quiet: boolean): GuestVoiceMention[] {
  return issuePopulations
    .filter(
      (population) =>
        index >= population.start &&
        index <= population.end &&
        (!quiet || population.quiet),
    )
    .map((population, ordinal) => mention(population.issue, ordinal))
    .map((m) =>
      index === 70 && m.topic === 'staff_service'
        ? { ...m, namesPerson: 'team_member' }
        : m,
    )
}

function syntheticReviewDate(index: number, quiet: boolean): string {
  if (index < 31 && !quiet) return addDays('2026-09-01', index % 28)
  if (index < 92) return addDays('2025-10-02', Math.floor((index * 270) / 92))
  return addDays('2026-07-04', Math.floor(((index - 92) * 89) / 39))
}

function syntheticUrgentReason(
  index: number,
  quiet: boolean,
): GuestVoiceReview['urgentReason'] {
  if (quiet) return null
  if (index < 3) return 'health'
  if (index < 5) return 'safety'
  return null
}

function syntheticReview(index: number, quiet = false): GuestVoiceReview {
  return {
    reviewId: fixtureId('b', index + 1),
    sourceEpoch: 1,
    sourceRevision: 1,
    analysisSequence: index + 1,
    localDate: syntheticReviewDate(index, quiet),
    rating: index < 92 ? (index % 2 ? 3 : 2) : 5,
    urgentReason: syntheticUrgentReason(index, quiet),
    namesAPerson: index === 70,
    mentions: syntheticMentions(index, quiet),
  }
}
function build(
  reviews: readonly GuestVoiceReview[],
  provisional = false,
): GuestVoiceBuildInput {
  return {
    propertyId: PROPERTY_ID,
    window: '365d',
    startLocalDate: '2025-10-02',
    endLocalDate: '2026-10-01',
    provisional,
    groups,
    current: reviews,
    baseline: Array.from({ length: 50 }, (_, index) => ({
      ...syntheticReview(index, true),
      reviewId: fixtureId('b', index + 500),
      localDate: '2025-08-01',
      mentions: [],
    })),
    currentPopulation: reviews.map((r) => ({
      reviewId: reviewId(r.reviewId),
      sourceRevision: 1,
      analysisSequence: r.analysisSequence,
      localDate: r.localDate,
      rating: r.rating,
      hasText: true,
    })),
    population: { textReviews: reviews.length, stars: ratingCountsOf(reviews) },
  }
}
export const CHECK_IN_INPUT = build(
  Array.from({ length: 132 }, (_, index) => syntheticReview(index)),
)
export const HAMPTON_READ = assembleGuestVoiceV2(CHECK_IN_INPUT).read
export const QUIET_READ = assembleGuestVoiceV2(
  build(Array.from({ length: 132 }, (_, index) => syntheticReview(index, true))),
).read
export const CHECK_IN_PROVISIONAL = assembleGuestVoiceV2(
  build(CHECK_IN_INPUT.current, true),
).read
export function checkInDetail(
  target: GuestVoiceDetailTarget,
  input: GuestVoiceBuildInput = CHECK_IN_INPUT,
  missingQuote = false,
) {
  const result = buildGuestVoiceDetail({
    build: input,
    history: input.current,
    historyStartLocalDate: input.startLocalDate,
    target,
  })?.read
  if (!result || result.drawer.kind !== 'issue')
    return result ?? { status: 'not_found' as const }
  const isRoom =
    target.kind === 'issue' &&
    target.issueId === fixtureId('a', 1) &&
    target.sense === 'complaint'
  const isTeam =
    target.kind === 'issue' &&
    target.issueId === fixtureId('a', 5) &&
    target.sense === 'praise'
  if (!isRoom && !isTeam) return result
  // Invented words only; the review-wide names rule is exercised by backend tests.
  return {
    ...result,
    drawer: {
      ...result.drawer,
      definition: isRoom
        ? 'A musty smell in guest rooms.'
        : 'Guests describe the team as friendly and helpful.',
      liveEvidence: missingQuote
        ? []
        : [
            quoteOf({
              id: fixtureId('b', 1),
              rating: 2,
              reviewedAt: CHECK_IN_INPUT.current[0]?.localDate ?? '2026-09-01',
              text: isRoom
                ? 'The room had a musty smell. The window opened onto a quiet courtyard.'
                : 'The team was friendly and helpful. Arrival was easy.',
              cited: [1],
            }),
          ],
    },
  }
}
const smallInput = build(
  CHECK_IN_INPUT.current
    .slice(0, 6)
    .map((r, index) => ({ ...r, urgentReason: index === 0 ? 'health' : null })),
)
export const CHECK_IN_SMALL_CONCERN: GuestVoiceV2NotEnough = {
  status: 'not_enough_reviews',
  readModelVersion: 'guest-voice-read-v2',
  checkInVersion: 'guest-voice-check-in-v1',
  context: guestVoiceWindowContext(smallInput),
  seriousConcerns: assembleGuestVoiceV2(smallInput).read.seriousConcerns,
  allReviewCount: 6,
  textReviewCount: 6,
  latestReviewCount: 3,
  latestReviews: smallInput.current
    .slice(-3)
    .reverse()
    .map((r, index) => ({
      inboxItemId: r.reviewId,
      reviewedAt: r.localDate,
      rating: r.rating,
      text:
        index === 2
          ? null
          : 'A made-up guest review. The room overlooked the courtyard, and arrival was straightforward.',
    })),
}
export const CHECK_IN_SMALL: GuestVoiceV2NotEnough = {
  ...CHECK_IN_SMALL_CONCERN,
  seriousConcerns: {
    items: [],
    groupCount: 0,
    reviewCount: 0,
    remainingGroupCount: 0,
    remainingReviewCount: 0,
    coverage: 'complete',
  },
}

export const CHECK_IN_STEADY = assembleGuestVoiceV2(
  build(CHECK_IN_INPUT.current.map((r) => ({ ...r, rating: 4 }))),
).read
export const CHECK_IN_SLIPPING = assembleGuestVoiceV2(
  build(
    CHECK_IN_INPUT.current.map((r) => ({
      ...r,
      rating: r.localDate < '2026-07-04' ? 5 : 2,
    })),
  ),
).read
export const CHECK_IN_INSUFFICIENT = assembleGuestVoiceV2(
  build(CHECK_IN_INPUT.current.slice(0, 25)),
).read

export const CHECK_IN_ORDINARY = assembleGuestVoiceV2(
  build(CHECK_IN_INPUT.current.map((r) => ({ ...r, urgentReason: null }))),
).read

export const CHECK_IN_RENAMED_INPUT: GuestVoiceBuildInput = {
  ...CHECK_IN_INPUT,
  groups: new Map(
    [...CHECK_IN_INPUT.groups].map(([id, group]) => [
      id,
      id === fixtureId('a', 1)
        ? {
            ...group,
            displayName:
              'The guest rooms in the east wing — a deliberately long manager label that must wrap on a narrow phone',
          }
        : group,
    ]),
  ),
}
export const CHECK_IN_RENAMED = assembleGuestVoiceV2(CHECK_IN_RENAMED_INPUT).read
