// Reporting application — the Portal results measures for one bounded period.
//
// Pure assembly of the governed sums and their evidence into the KPIs the
// analytics tab shows. Nothing here reads a store; get-portal-analytics.ts does
// the reads and hands the rows over.
//
// What each measure means (and does not):
//   - scans        qualified scans only, never raw page opens
//   - ratings      the count of eligible private ratings
//   - avgRating    held back below the average floor (domain thresholds)
//   - googleOpens  Google review link opens only, never secondary links
// A figure whose evidence is not `ready` is null, never zero.

import type {
  MetricAvailabilityState,
  PortalCountKPIValue,
  PortalEngagementFunnel,
  PortalKPIs,
  PortalMetricEvidence,
  RatingKPIValue,
} from '../../domain/dashboard-types'
import {
  averageWithholdReason,
  isAverageShowable,
} from '../../domain/portal-results-thresholds'
import type {
  MetricPortalMetricEvidence as SourceMetricEvidence,
  MetricPortalMetricEvidenceSet,
  PortalMetricSumRow,
} from '../ports/portal-analytics.repository'
import { computeTrend, ratingComparison } from '../utils'

const METRIC_KEY = {
  qualifiedScan: 'portal.qualified_scan',
  feedback: 'portal.feedback',
  rating: 'portal.rating',
  googleOpen: 'portal.review_link_click',
} as const

/** One window's governed sums and the evidence that says whether to trust them. */
export type PortalPeriodReading = Readonly<{
  sums: readonly PortalMetricSumRow[]
  evidence: MetricPortalMetricEvidenceSet
}>

export type PortalPeriodKpis = Readonly<{
  kpis: PortalKPIs
  engagementFunnel: PortalEngagementFunnel | null
  /** True when the average is shown, so its distribution and trend may be too. */
  ratingDetailShowable: boolean
}>

const AVAILABILITY: Record<SourceMetricEvidence['state'], MetricAvailabilityState> = {
  ready: 'ready',
  updating: 'updating',
  insufficient: 'insufficient_data',
  unavailable: 'temporarily_unavailable',
}

function roundedRating(value: number): number {
  return Math.round(value * 10) / 10
}

function sumFor(reading: PortalPeriodReading | null, key: string) {
  return reading?.sums.find((row) => row.metricKey === key)
}

export function periodEvidence(
  source: SourceMetricEvidence,
  sampleCount: number,
): PortalMetricEvidence {
  return { ...source, state: AVAILABILITY[source.state], sampleCount }
}

/** A count, with the absolute prior value and a trend only when both are known. */
function countKpi(
  current: Readonly<{ value: number; sampleCount: number }>,
  previous: Readonly<{ value: number }> | null,
  currentEvidence: SourceMetricEvidence,
  priorEvidence: SourceMetricEvidence | null,
): PortalCountKPIValue {
  const value = currentEvidence.state === 'ready' ? current.value : null
  const priorValue =
    previous !== null && priorEvidence?.state === 'ready' ? previous.value : null
  return {
    value,
    priorValue,
    trend: value !== null && priorValue !== null ? computeTrend(value, priorValue) : null,
    evidence: periodEvidence(currentEvidence, current.sampleCount),
  }
}

const sumCount = (row: PortalMetricSumRow | undefined) => ({
  value: row?.total ?? 0,
  sampleCount: row?.count ?? 0,
})

/** The rating COUNT as a count measure: its value is the number of ratings. */
function ratingCount(reading: PortalPeriodReading) {
  const count = sumFor(reading, METRIC_KEY.rating)?.count ?? 0
  return { value: count, sampleCount: count }
}

type AverageSide = Readonly<{ value: number | null; count: number }>

/** The average of one window, or null when it is unusable or below the floor. */
function averageSide(reading: PortalPeriodReading | null, ready: boolean): AverageSide {
  const row = sumFor(reading, METRIC_KEY.rating)
  const count = row?.count ?? 0
  return {
    count,
    value:
      ready && row && isAverageShowable(count) ? roundedRating(row.total / count) : null,
  }
}

function averageKpi(
  current: PortalPeriodReading,
  prior: PortalPeriodReading | null,
): RatingKPIValue {
  const now = averageSide(current, current.evidence.privateRatings.state === 'ready')
  const before = averageSide(prior, prior?.evidence.privateRatings.state === 'ready')
  const source = periodEvidence(current.evidence.privateRatings, now.count)
  // Below the floor the source can be perfectly healthy: the average is held
  // back because the sample is small, which is its own state and reason.
  const evidence: PortalMetricEvidence =
    source.state === 'ready' && now.value === null
      ? {
          ...source,
          state: 'insufficient_data',
          availabilityReason: averageWithholdReason(now.count),
        }
      : source
  return {
    value: now.value,
    priorValue: before.value,
    comparison: ratingComparison(now.value, now.count, before.value, before.count),
    sampleCount: now.count,
    priorSampleCount: before.count,
    evidence,
  }
}

function engagementFunnel(current: PortalPeriodReading): PortalEngagementFunnel | null {
  const { scans, privateRatings, reviewLinkClicks } = current.evidence
  if (
    scans.state !== 'ready' ||
    privateRatings.state !== 'ready' ||
    reviewLinkClicks.state !== 'ready'
  ) {
    return null
  }
  return {
    qualifiedScans: sumFor(current, METRIC_KEY.qualifiedScan)?.total ?? 0,
    ratings: sumFor(current, METRIC_KEY.rating)?.count ?? 0,
    googleOpens: sumFor(current, METRIC_KEY.googleOpen)?.total ?? 0,
  }
}

export function portalPeriodKpis(
  current: PortalPeriodReading,
  prior: PortalPeriodReading | null,
): PortalPeriodKpis {
  const average = averageKpi(current, prior)
  const priorEvidence = prior?.evidence
  const kpis: PortalKPIs = {
    scans: countKpi(
      sumCount(sumFor(current, METRIC_KEY.qualifiedScan)),
      prior && sumCount(sumFor(prior, METRIC_KEY.qualifiedScan)),
      current.evidence.scans,
      priorEvidence?.scans ?? null,
    ),
    ratings: countKpi(
      ratingCount(current),
      prior && ratingCount(prior),
      current.evidence.privateRatings,
      priorEvidence?.privateRatings ?? null,
    ),
    avgRating: average,
    feedback: countKpi(
      sumCount(sumFor(current, METRIC_KEY.feedback)),
      prior && sumCount(sumFor(prior, METRIC_KEY.feedback)),
      current.evidence.privateFeedback,
      priorEvidence?.privateFeedback ?? null,
    ),
    googleOpens: countKpi(
      sumCount(sumFor(current, METRIC_KEY.googleOpen)),
      prior && sumCount(sumFor(prior, METRIC_KEY.googleOpen)),
      current.evidence.reviewLinkClicks,
      priorEvidence?.reviewLinkClicks ?? null,
    ),
  }
  return {
    kpis,
    engagementFunnel: engagementFunnel(current),
    ratingDetailShowable: average.value !== null,
  }
}
