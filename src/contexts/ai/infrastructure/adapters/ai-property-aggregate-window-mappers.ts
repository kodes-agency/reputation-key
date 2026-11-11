// Legacy window evidence is validated before deriving day counts. A broken
// correlated invariant is an error, never a partial answer.

import { reviewId } from '#/shared/domain/ids'
import { isAspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import { isAiIssueLabel } from '#/shared/ai-issue-label'
import type {
  AiPropertyAnalyzedReview,
  AiPropertyDailyAggregate,
  AiPropertyDailyAspectCount,
  AiPropertyUnavailableReview,
} from '../../application/ports/ai-property-aggregate-store.port'
import { safeSequence } from './ai-property-aggregate-head'
/** Legacy reads derive their day counts from the same current evidence rows. */
export function dailyCountsFromReviews(
  reviews: readonly AiPropertyAnalyzedReview[],
): readonly AiPropertyDailyAggregate[] {
  const days = new Map<
    string,
    {
      localDate: string
      reviewCount: number
      ratingSum: number
      sentimentCounts: Record<AiPropertyAnalyzedReview['sentiment'], number>
      attentionCounts: Record<AiPropertyAnalyzedReview['attention'], number>
      aspectCounts: AiPropertyDailyAspectCount[]
    }
  >()
  for (const review of reviews) {
    const day = days.get(review.localDate) ?? {
      localDate: review.localDate,
      reviewCount: 0,
      ratingSum: 0,
      sentimentCounts: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
      attentionCounts: { urgent: 0, high: 0, medium: 0, low: 0 },
      aspectCounts: [],
    }
    day.reviewCount += 1
    day.ratingSum += review.rating
    day.sentimentCounts[review.sentiment] += 1
    day.attentionCounts[review.attention] += 1
    for (const aspect of review.aspects) {
      const count = day.aspectCounts.find(
        (value) => value.aspect === aspect.aspect && value.polarity === aspect.polarity,
      )
      if (count) {
        day.aspectCounts[day.aspectCounts.indexOf(count)] = {
          ...count,
          count: count.count + 1,
        }
      } else {
        day.aspectCounts.push({
          aspect: aspect.aspect,
          polarity: aspect.polarity,
          count: 1,
        })
      }
    }
    days.set(review.localDate, day)
  }
  return [...days.values()]
    .sort((a, b) => a.localDate.localeCompare(b.localDate))
    .map((day) => ({
      ...day,
      aspectCounts: day.aspectCounts.sort(
        (a, b) =>
          a.aspect.localeCompare(b.aspect) || a.polarity.localeCompare(b.polarity),
      ),
    }))
}

const SENTIMENT_VALUES: Readonly<Record<AiPropertyAnalyzedReview['sentiment'], true>> =
  Object.freeze({
    positive: true,
    neutral: true,
    negative: true,
    mixed: true,
  })
const ATTENTION_VALUES: Readonly<Record<AiPropertyAnalyzedReview['attention'], true>> =
  Object.freeze({
    urgent: true,
    high: true,
    medium: true,
    low: true,
  })

function isAnalyzedReviewAspect(
  value: unknown,
): value is AiPropertyAnalyzedReview['aspects'][number] {
  if (typeof value !== 'object' || value === null) return false
  const aspect = Reflect.get(value, 'aspect')
  const polarity = Reflect.get(value, 'polarity')
  const intensity = Reflect.get(value, 'intensity')
  if (
    typeof aspect !== 'string' ||
    !isAspectTaxonomyV1Id(aspect) ||
    (polarity !== 'positive' && polarity !== 'neutral' && polarity !== 'negative') ||
    typeof intensity !== 'number' ||
    !Number.isInteger(intensity)
  ) {
    return false
  }
  return (
    (polarity === 'positive' && intensity >= 20 && intensity <= 100) ||
    (polarity === 'neutral' && intensity >= -19 && intensity <= 19) ||
    (polarity === 'negative' && intensity >= -100 && intensity <= -20)
  )
}

// This fail-closed row boundary keeps every correlated evidence field in one
// validation decision so an invalid projection can never be partially accepted.
// fallow-ignore-next-line complexity
export function mapAnalyzedReview(
  row: Readonly<{
    reviewId: string
    sourceRevision: number | string
    analysisSequence: number | string
    localDate: string
    rating: number
    sentiment: string | null
    attention: string | null
    aspects: unknown
    issueLabel: string | null
    analysisProfileVersion: string
    providerDeploymentProfileVersion: string
    modelSnapshot: string
  }>,
): AiPropertyAnalyzedReview {
  // Aspect rows are no longer read, so stored v1 and v2 analyses carry none.
  const aspects =
    Array.isArray(row.aspects) &&
    row.aspects.length <= 5 &&
    row.aspects.every(isAnalyzedReviewAspect)
      ? row.aspects
      : null
  const sourceRevision = safeSequence(row.sourceRevision)
  const analysisSequence = safeSequence(row.analysisSequence)
  if (
    sourceRevision === null ||
    sourceRevision < 1 ||
    analysisSequence === null ||
    analysisSequence < 1 ||
    aspects === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.localDate) ||
    !Number.isInteger(row.rating) ||
    row.rating < 1 ||
    row.rating > 5 ||
    typeof row.sentiment !== 'string' ||
    !Object.hasOwn(SENTIMENT_VALUES, row.sentiment) ||
    typeof row.attention !== 'string' ||
    !Object.hasOwn(ATTENTION_VALUES, row.attention) ||
    (row.issueLabel !== null && !isAiIssueLabel(row.issueLabel)) ||
    row.analysisProfileVersion.length === 0 ||
    row.providerDeploymentProfileVersion.length === 0 ||
    row.modelSnapshot.length === 0
  ) {
    throw new Error('Property analyzed Review evidence is invalid')
  }
  return Object.freeze({
    reviewId: reviewId(row.reviewId),
    sourceRevision,
    analysisSequence,
    localDate: row.localDate,
    rating: row.rating,
    sentiment: row.sentiment as AiPropertyAnalyzedReview['sentiment'],
    attention: row.attention as AiPropertyAnalyzedReview['attention'],
    aspects: Object.freeze(aspects.map((aspect) => Object.freeze({ ...aspect }))),
    issueLabel: row.issueLabel,
    analysisProfileVersion: row.analysisProfileVersion,
    providerDeploymentProfileVersion: row.providerDeploymentProfileVersion,
    modelSnapshot: row.modelSnapshot,
  })
}

export function mapUnavailableReview(
  row: Readonly<{
    reviewId: string
    sourceRevision: number | string
    analysisSequence: number | string
    localDate: string
    rating: number
    unavailableReason: string | null
  }>,
): AiPropertyUnavailableReview {
  const sourceRevision = safeSequence(row.sourceRevision)
  const analysisSequence = safeSequence(row.analysisSequence)
  if (
    sourceRevision === null ||
    sourceRevision < 1 ||
    analysisSequence === null ||
    analysisSequence < 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.localDate) ||
    !Number.isInteger(row.rating) ||
    row.rating < 1 ||
    row.rating > 5 ||
    row.unavailableReason !== 'language_not_supported'
  ) {
    throw new Error('Property unavailable Review evidence is invalid')
  }
  return Object.freeze({
    reviewId: reviewId(row.reviewId),
    sourceRevision,
    analysisSequence,
    localDate: row.localDate,
    rating: row.rating,
    reason: row.unavailableReason,
  })
}
