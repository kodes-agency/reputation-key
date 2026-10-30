// How the legacy window's rows become the readers' types. Every mapper fails
// closed: a row that breaks any correlated invariant is an error, never a
// partial answer. Moved out of the aggregate store without changing, so that file
// can hold the v3 contribution beside the v2 one.

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
import type { DailyRow } from './ai-property-aggregate-contributions'

export function mapDaily(
  row: DailyRow,
  aspectCounts: readonly AiPropertyDailyAspectCount[],
): AiPropertyDailyAggregate {
  return {
    localDate: row.localDate,
    reviewCount: row.reviewCount,
    ratingSum: row.ratingSum,
    sentimentCounts: {
      positive: row.positiveCount,
      neutral: row.neutralCount,
      negative: row.negativeCount,
      mixed: row.mixedCount,
    },
    aspectCounts,
    attentionCounts: {
      urgent: row.urgentCount,
      high: row.highCount,
      medium: row.mediumCount,
      low: row.lowCount,
    },
  }
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
  // v1 analyses predate aspect extraction and remain current evidence until an
  // epoch bump retires them. Only that profile may legitimately have no children.
  const aspects =
    Array.isArray(row.aspects) &&
    row.aspects.length <= 5 &&
    (row.aspects.length >= 1 || row.analysisProfileVersion === 'review-analysis-v1') &&
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
