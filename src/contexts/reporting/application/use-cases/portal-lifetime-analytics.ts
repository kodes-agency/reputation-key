import {
  averageWithholdReason,
  isAverageShowable,
} from '../../domain/portal-results-thresholds'
import type {
  PortalAnalyticsData,
  PortalMetricEvidence,
  PortalResponseIntegritySummary,
} from '../../domain/dashboard-types'
import type { GetPortalAnalyticsInput } from './get-portal-analytics'
import type { PortalLifetimeAggregate } from '../ports/portal-lifetime-aggregate.port'

function roundedRating(value: number): number {
  return Math.round(value * 10) / 10
}

function lifetimeEvidence(
  definitionVersionId: string,
  sampleCount: number,
  aggregate: PortalLifetimeAggregate,
  computedAt: Date,
  /** An average is insufficient below its sample floor; a count never is. */
  isAverage = false,
): PortalMetricEvidence {
  const awaitingReconciliation = aggregate.lastRebuiltAt === null
  const withheld = isAverage && !isAverageShowable(sampleCount)
  return {
    basis: 'anonymous_lifetime',
    definitionVersionId,
    state: awaitingReconciliation ? 'updating' : withheld ? 'insufficient_data' : 'ready',
    // A reconciliation time is not a business watermark. The dedicated
    // lifetime block below exposes it without relabelling it as data time.
    verifiedThrough: null,
    // Exact activity time is deliberately absent from the anonymous lifetime
    // projection; retaining it would defeat the source-fact expiry design.
    latestActivity: null,
    computedAt,
    completeness: awaitingReconciliation ? 0 : 1,
    availabilityReason: awaitingReconciliation
      ? 'lifetime_reconciliation_pending'
      : withheld
        ? averageWithholdReason(sampleCount)
        : null,
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
  aggregate: PortalLifetimeAggregate | null,
  responseIntegrity: PortalResponseIntegritySummary,
  qualifiedScansSince: Date,
): PortalAnalyticsData {
  if (aggregate === null) {
    const evidence = missingEvidence(input.endDate)
    return {
      period: {
        startAt: input.startDate,
        endAt: input.endDate,
        timezone: input.propertyTimezone,
      },
      qualifiedScansSince,
      lifetimeReconciliation: {
        state: 'not_initialized',
        projectionRevision: null,
        sealedThroughLocalDate: null,
        lastRebuiltAt: null,
        lastSealedAt: null,
      },
      kpis: {
        scans: { value: null, priorValue: null, trend: null, evidence },
        ratings: { value: null, priorValue: null, trend: null, evidence },
        avgRating: {
          value: null,
          priorValue: null,
          comparison: null,
          sampleCount: 0,
          priorSampleCount: 0,
          evidence,
        },
        feedback: { value: null, priorValue: null, trend: null, evidence },
        googleOpens: { value: null, priorValue: null, trend: null, evidence },
      },
      engagementFunnel: null,
      ratingDistribution: [],
      ratingTrend: [],
      responseIntegrity,
    }
  }

  const values = aggregate.values
  // Google opens are Google review selections only: a secondary link is not a
  // Google open. The aggregate keeps both counts; this measure reads one.
  const googleOpens = values.googleReviewSelectionCount
  const averageShowable = isAverageShowable(values.privateRatingCount)
  const ratingValue = averageShowable
    ? roundedRating(values.privateRatingSum / values.privateRatingCount)
    : null
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
    ratingCount: lifetimeEvidence(
      aggregate.definitionVersionIds.privateRatings,
      values.privateRatingCount,
      aggregate,
      input.endDate,
    ),
    feedback: lifetimeEvidence(
      aggregate.definitionVersionIds.privateFeedback,
      values.privateFeedbackCount,
      aggregate,
      input.endDate,
    ),
    destinations: lifetimeEvidence(
      aggregate.definitionVersionIds.destinationSelections,
      googleOpens,
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
    qualifiedScansSince,
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
      ratings: {
        value: values.privateRatingCount,
        priorValue: null,
        trend: null,
        evidence: evidence.ratingCount,
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
      googleOpens: {
        value: googleOpens,
        priorValue: null,
        trend: null,
        evidence: evidence.destinations,
      },
    },
    engagementFunnel: {
      qualifiedScans: values.qualifiedScanCount,
      ratings: values.privateRatingCount,
      googleOpens,
    },
    // A distribution would give a withheld average away.
    ratingDistribution: averageShowable
      ? [
          { stars: 1, count: values.privateRating1Count },
          { stars: 2, count: values.privateRating2Count },
          { stars: 3, count: values.privateRating3Count },
          { stars: 4, count: values.privateRating4Count },
          { stars: 5, count: values.privateRating5Count },
        ]
      : [],
    // An anonymous total has no daily points. Deriving a chart from it would
    // invent time semantics the lifetime projection intentionally does not own.
    ratingTrend: [],
    responseIntegrity,
  }
}
