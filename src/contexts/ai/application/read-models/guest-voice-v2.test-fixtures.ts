import { reviewId } from '#/shared/domain/ids'
import { ratingCountsOf } from '../aspect-review-evidence'
import type { GuestVoiceBuildInput } from './guest-voice-v2-build'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceMention,
  GuestVoiceReview,
} from './guest-voice-v2-facts'

export const ISSUE = 'a0000000-0000-4000-8000-000000000001'
export const OTHER = 'a0000000-0000-4000-8000-000000000002'
export const group: GuestVoiceIssueGroup = {
  id: ISSUE,
  topic: 'cleanliness',
  canonicalThing: 'room',
  displayName: null,
  hidden: false,
}
export const groups = new Map([
  [ISSUE, group],
  [OTHER, { ...group, id: OTHER }],
])
export const mention = (over: Partial<GuestVoiceMention> = {}): GuestVoiceMention => ({
  mentionOrdinal: 0,
  topic: 'cleanliness',
  polarity: 'negative',
  strength: 'clear',
  thing: 'room',
  cause: 'musty smell',
  issueGroupId: ISSUE,
  namesPerson: null,
  ...over,
})
export const review = (
  n: number,
  over: Partial<GuestVoiceReview> = {},
): GuestVoiceReview => ({
  reviewId: `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  sourceEpoch: 1,
  sourceRevision: 1,
  analysisSequence: n,
  localDate: '2026-10-15',
  rating: 2,
  urgentReason: null,
  namesAPerson: false,
  mentions: [mention()],
  ...over,
})
export function population(reviews: readonly GuestVoiceReview[]) {
  return reviews.map((r) => ({
    reviewId: reviewId(r.reviewId),
    sourceRevision: r.sourceRevision,
    analysisSequence: r.analysisSequence,
    localDate: r.localDate,
    rating: r.rating,
    hasText: true,
  }))
}
export function input(
  current: readonly GuestVoiceReview[],
  over: Partial<GuestVoiceBuildInput> = {},
): GuestVoiceBuildInput {
  return {
    propertyId: 'property',
    window: '90d',
    startLocalDate: '2026-08-02',
    endLocalDate: '2026-10-30',
    provisional: false,
    current,
    baseline: [],
    currentPopulation: population(current),
    population: { textReviews: current.length, stars: ratingCountsOf(current) },
    groups,
    ...over,
  }
}
