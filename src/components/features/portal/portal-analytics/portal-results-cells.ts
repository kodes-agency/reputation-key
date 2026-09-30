// Portal results — the five measures as the strip prints them (board 07).
//
// One cell per measure, in the order the board draws them: a label that says
// what is counted, the figure, and ONE line under it. The line is the most
// useful true thing there is room for:
//   - qualified scans and private notes: the change against the period before;
//   - private ratings and Google opens: the share of qualified scans, unless
//     scans are not known or fewer than the step counted (a share over 100% is
//     a bug to a reader), when it falls back to the change;
//   - the average: the sample it rests on, and its comparison in stars.
// A figure that is not ready is a dash with the reason, never a zero. Every
// floor comes from the server (`thresholds`); this file keeps none.

import type {
  PortalAnalyticsData,
  PortalCountKPIValue,
  PortalEngagementFunnel,
  PortalKPIs,
  PortalMetricEvidence,
  PortalResultsThresholds,
} from '#/contexts/reporting/application/public-api'
import {
  metricAvailabilityDetail,
  metricEvidenceLine,
  type MetricEvidenceSubject,
} from '#/components/features/dashboard/metric-availability-presentation'
import { dayCount } from './portal-results-window'

export type ResultsCellKey = 'scans' | 'ratings' | 'average' | 'googleOpens' | 'notes'

export type ResultsCell = Readonly<{
  key: ResultsCellKey
  /** What is counted, in words a manager would use. */
  label: string
  subject: MetricEvidenceSubject
  /** The figure, or a dash while it is not known. */
  value: string
  /** `star` draws the rating star after the figure. */
  unit: 'star' | null
  detail: string | null
}>

type Options = Readonly<{ compare: boolean }>
type Count = PortalCountKPIValue
type LocalDays = NonNullable<PortalAnalyticsData['localDays']>

/**
 * What the five cells need, so a strip over many Portals (the overview) and one
 * Portal's own Results view print the same words from the same figures.
 */
export type ResultsMeasuresInput = Readonly<{
  kpis: PortalKPIs
  thresholds: PortalResultsThresholds
  timezone: string
  /** The window and its comparison in local days; null for All Time. */
  localDays: LocalDays | null
  /**
   * Where "% of scans" comes from. Left out, each share is worked out from the
   * counts. Given, it is read from the scan funnel, and a funnel that is
   * withheld (null) gives no share at all.
   */
  funnel?: PortalEngagementFunnel | null
}>

export const DASH = '—'

export const formatCount = (value: number) => value.toLocaleString('en-US')

function signed(delta: number): string {
  if (delta === 0) return 'No change'
  return `${delta > 0 ? '+' : '−'}${formatCount(Math.abs(delta))}`
}

/** "the 30 days before", from the window's own local days. */
function priorName(data: ResultsMeasuresInput): string {
  const days = data.localDays
  if (days === null) return 'the period before'
  const length = dayCount(days.start, days.end)
  return length === 1 ? 'the day before' : `the ${length} days before`
}

function changeLine(kpi: Count, data: ResultsMeasuresInput, options: Options) {
  if (!options.compare || kpi.value === null) return null
  if (kpi.priorValue === null) {
    return kpi.priorUnavailableReason === undefined
      ? null
      : 'The period before predates this measure'
  }
  return `${signed(kpi.value - kpi.priorValue)} vs ${priorName(data)}`
}

export function notReadyLine(
  subject: MetricEvidenceSubject,
  evidence: PortalMetricEvidence,
  timeZone: string,
): string | null {
  if (evidence.availabilityReason !== null) {
    return metricAvailabilityDetail(evidence.availabilityReason)
  }
  return metricEvidenceLine(
    {
      subject,
      state: evidence.state,
      dataThrough: evidence.verifiedThrough,
      reason: evidence.availabilityReason,
    },
    'en-US',
    timeZone,
  )
}

function shareLine(count: number, scans: number): string | null {
  if (scans === 0 || count > scans) return null
  return `${Math.round((count / scans) * 100)}% of scans`
}

/** A share of qualified scans, only where the scan count is known and not exceeded. */
function shareOfScans(
  key: 'ratings' | 'googleOpens',
  data: ResultsMeasuresInput,
): string | null {
  const { funnel, kpis } = data
  if (funnel !== undefined) {
    return funnel === null ? null : shareLine(funnel[key], funnel.qualifiedScans)
  }
  const count = kpis[key].value
  if (count === null || kpis.scans.value === null) return null
  return shareLine(count, kpis.scans.value)
}

function countCell(
  key: ResultsCellKey,
  label: string,
  subject: MetricEvidenceSubject,
  kpi: Count,
  detail: string | null,
  timeZone: string,
): ResultsCell {
  if (kpi.value === null) {
    return {
      key,
      label,
      subject,
      value: DASH,
      unit: null,
      detail: notReadyLine(subject, kpi.evidence, timeZone),
    }
  }
  return { key, label, subject, value: formatCount(kpi.value), unit: null, detail }
}

function starChange(comparison: number): string {
  if (comparison === 0) return 'no change'
  return `${comparison > 0 ? '+' : '−'}${Math.abs(comparison).toFixed(1)}`
}

function ratingsWord(count: number): string {
  return count === 1 ? '1 rating' : `${formatCount(count)} ratings`
}

function averageCell(data: ResultsMeasuresInput, options: Options): ResultsCell {
  const { avgRating } = data.kpis
  const base = {
    key: 'average',
    label: 'Average private rating',
    subject: 'ratings',
  } as const
  if (avgRating.value === null) {
    const { evidence, sampleCount } = avgRating
    const detail =
      evidence.availabilityReason === 'below_minimum_sample'
        ? `${ratingsWord(sampleCount)}, needs ${data.thresholds.averageMinSample} to show an average`
        : evidence.state === 'insufficient_data' && sampleCount === 0
          ? 'No private ratings yet'
          : notReadyLine('ratings', evidence, data.timezone)
    return { ...base, value: DASH, unit: null, detail }
  }
  const parts = [`from ${formatCount(avgRating.sampleCount)}`]
  if (options.compare) {
    if (avgRating.comparison !== null) parts.push(starChange(avgRating.comparison))
    else if (avgRating.comparisonWithheld === 'sample_too_small') {
      parts.push('too few to compare')
    }
  }
  return {
    ...base,
    value: avgRating.value.toFixed(1),
    unit: 'star',
    detail: parts.join(' · '),
  }
}

export function measureCells(
  data: ResultsMeasuresInput,
  options: Options,
): readonly ResultsCell[] {
  const { kpis, timezone: zone } = data
  return [
    countCell(
      'scans',
      'Qualified scans',
      'qualified_scans',
      kpis.scans,
      changeLine(kpis.scans, data, options),
      zone,
    ),
    countCell(
      'ratings',
      'Private ratings',
      'ratings',
      kpis.ratings,
      shareOfScans('ratings', data) ?? changeLine(kpis.ratings, data, options),
      zone,
    ),
    averageCell(data, options),
    countCell(
      'googleOpens',
      'Guests who opened Google',
      'google_opens',
      kpis.googleOpens,
      shareOfScans('googleOpens', data) ?? changeLine(kpis.googleOpens, data, options),
      zone,
    ),
    countCell(
      'notes',
      'Private notes',
      'private_feedback',
      kpis.feedback,
      changeLine(kpis.feedback, data, options),
      zone,
    ),
  ]
}

export function resultsCells(
  data: PortalAnalyticsData,
  options: Options,
): readonly ResultsCell[] {
  return measureCells(
    {
      kpis: data.kpis,
      thresholds: data.thresholds,
      timezone: data.period.timezone,
      localDays: data.localDays,
    },
    options,
  )
}
