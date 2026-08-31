import type {
  PortalAnalyticsData,
  PortalMetricEvidence,
  PortalResponseIntegritySummary,
} from '../../domain/types'
import type { GetPortalAnalyticsInput } from './get-portal-analytics'
import type { PortalLifetimeMetricAggregate } from '../ports/portal-lifetime-metrics.port'

function roundedRating(value: number): number {
  return Math.round(value * 10) / 10
}

function lifetimeEvidence(
  definitionVersionId: string,
  sampleCount: number,
  aggregate: PortalLifetimeMetricAggregate,
  computedAt: Date,
  insufficientWhenEmpty = false,
): PortalMetricEvidence {
  const awaitingReconciliation = aggregate.lastRebuiltAt === null
  return {
    basis: 'anonymous_lifetime',
    definitionVersionId,
    state: awaitingReconciliation
      ? 'updating'
      : insufficientWhenEmpty && sampleCount === 0
        ? 'insufficient_data'
        : 'ready',
    // A reconciliation time is not a business watermark. The dedicated
    // lifetime block below exposes it without relabelling it as data time.
    verifiedThrough: null,
    // Exact activity time is deliberately absent from the anonymous lifetime
    // projection; retaining it would defeat the source-fact expiry design.
    latestActivity: null,
    computedAt,
    completeness: awaitingReconciliation ? 0 : 1,
    availabilityReason: awaitingReconciliation ? 'lifetime_reconciliation_pending' : null,
    correctionHead: null,
    sampleCount,
  }
}

function missingEvidence(computedAt: Date): PortalMetricEvidence {
  return {
    basis: 'anonymous_lifetime',
    definitionVersionId: null,
    state: 'updating',
    verifiedThrough: null,
    latestActivity: null,
    computedAt,
    completeness: 0,
    availabilityReason: 'lifetime_projection_missing',
    correctionHead: null,
    sampleCount: 0,
  }
}

export function portalLifetimeAnalyticsData(
  input: GetPortalAnalyticsInput,
  aggregate: PortalLifetimeMetricAggregate | null,
  responseIntegrity: PortalResponseIntegritySummary,
): PortalAnalyticsData {
  if (aggregate === null) {
    const evidence = missingEvidence(input.endDate)
    return {
      period: {
        startAt: input.startDate,
        endAt: input.endDate,
        timezone: input.propertyTimezone,
      },
      lifetimeReconciliation: {
        state: 'not_initialized',
        projectionRevision: null,
        sealedThroughLocalDate: null,
        lastRebuiltAt: null,
        lastSealedAt: null,
      },
      kpis: {
        scans: { value: null, priorValue: null, trend: null, evidence },
        avgRating: {
          value: null,
          priorValue: null,
          comparison: null,
          sampleCount: 0,
          priorSampleCount: 0,
          evidence,
        },
        feedback: { value: null, priorValue: null, trend: null, evidence },
        reviewLinkClicks: {
          value: null,
          priorValue: null,
          trend: null,
          evidence,
        },
      },
      engagementFunnel: null,
      ratingDistribution: [],
      ratingTrend: [],
      responseIntegrity,
    }
  }

  const values = aggregate.values
  const destinationSelectionCount =
    values.googleReviewSelectionCount + values.secondaryLinkSelectionCount
  const ratingValue =
    values.privateRatingCount === 0
      ? null
      : roundedRating(values.privateRatingSum / values.privateRatingCount)
  const evidence = {
    scans: lifetimeEvidence(
      aggregate.definitionVersionIds.qualifiedScans,
      values.qualifiedScanCount,
      aggregate,
      input.endDate,
    ),
    ratings: lifetimeEvidence(
      aggregate.definitionVersionIds.privateRatings,
      values.privateRatingCount,
      aggregate,
      input.endDate,
      true,
    ),
    feedback: lifetimeEvidence(
      aggregate.definitionVersionIds.privateFeedback,
      values.privateFeedbackCount,
      aggregate,
      input.endDate,
    ),
    destinations: lifetimeEvidence(
      aggregate.definitionVersionIds.destinationSelections,
      destinationSelectionCount,
      aggregate,
      input.endDate,
    ),
  }

  return {
    period: {
      startAt: input.startDate,
      endAt: input.endDate,
      timezone: input.propertyTimezone,
    },
    lifetimeReconciliation: {
      state:
        aggregate.lastRebuiltAt === null ? 'awaiting_first_reconciliation' : 'reconciled',
      projectionRevision: aggregate.projectionRevision,
      sealedThroughLocalDate: aggregate.sealedThroughLocalDate,
      lastRebuiltAt: aggregate.lastRebuiltAt,
      lastSealedAt: aggregate.lastSealedAt,
    },
    kpis: {
      scans: {
        value: values.qualifiedScanCount,
        priorValue: null,
        trend: null,
        evidence: evidence.scans,
      },
      avgRating: {
        value: ratingValue,
        priorValue: null,
        comparison: null,
        sampleCount: values.privateRatingCount,
        priorSampleCount: 0,
        evidence: evidence.ratings,
      },
      feedback: {
        value: values.privateFeedbackCount,
        priorValue: null,
        trend: null,
        evidence: evidence.feedback,
      },
      reviewLinkClicks: {
        value: destinationSelectionCount,
        priorValue: null,
        trend: null,
        evidence: evidence.destinations,
      },
    },
    engagementFunnel: {
      scans: values.qualifiedScanCount,
      ratings: values.privateRatingCount,
      reviewLinkClicks: destinationSelectionCount,
    },
    ratingDistribution: [
      { stars: 1, count: values.privateRating1Count },
      { stars: 2, count: values.privateRating2Count },
      { stars: 3, count: values.privateRating3Count },
      { stars: 4, count: values.privateRating4Count },
      { stars: 5, count: values.privateRating5Count },
    ],
    // An anonymous total has no daily points. Deriving a chart from it would
    // invent time semantics the lifetime projection intentionally does not own.
    ratingTrend: [],
    responseIntegrity,
  }
}
