import { match } from 'ts-pattern'
import type { MetricAvailabilityState } from '#/contexts/reporting/application/public-api'
import { formatDateTime } from '#/lib/format-date-time'

export type MetricEvidenceSubject =
  'reviews' | 'ratings' | 'scans' | 'private_feedback' | 'review_clicks'

export type MetricEvidenceLineInput = Readonly<{
  basis?: 'governed_period' | 'anonymous_lifetime'
  subject: MetricEvidenceSubject
  state: MetricAvailabilityState
  dataThrough: Date | null
}>

export function metricStateLabel(state: MetricAvailabilityState): string {
  return match(state)
    .with('ready', () => 'Ready')
    .with('updating', () => 'Updating')
    .with('insufficient_data', () => 'Insufficient data')
    .with('temporarily_unavailable', () => 'Temporarily unavailable')
    .exhaustive()
}

/**
 * Evidence timestamps render inside server-rendered dashboards, so the format
 * has to be byte-identical on the server and in the browser: an ambient locale
 * or timezone makes the two disagree and React fails hydration (error #418).
 * Both are therefore pinned unless the caller knows the metric's governed
 * timezone, and the zone is always named so a UTC reading is not mistaken for
 * local time.
 */
export function formatEvidenceTime(
  value: Date | null,
  locale = 'en-US',
  timeZone = 'UTC',
): string {
  if (value === null) return '—'
  return formatDateTime(value, { locale, timeZone, timeZoneName: true })
}

export function metricAvailabilityDetail(reason: string | null): string {
  switch (reason) {
    case 'consumer_receipt_pending':
      return 'Recent activity is still processing.'
    case 'source_fact_quarantined':
    case 'invalid_governed_reading':
      return 'A data quality check needs attention.'
    case 'source_fact_obsolete':
      return 'This data needs to be refreshed.'
    case 'projection_missing':
      return 'This data is being repaired.'
    case 'lifetime_reconciliation_pending':
      return 'The first all-time consistency check is still finishing.'
    case 'lifetime_projection_missing':
      return 'All-time totals are preparing.'
    case null:
      return '—'
    default:
      return 'This data is temporarily unavailable.'
  }
}

function insufficientDataLine(
  subject: MetricEvidenceSubject,
  basis: MetricEvidenceLineInput['basis'],
): string {
  const period = basis === 'anonymous_lifetime' ? 'the all-time aggregate' : 'this period'
  return match(subject)
    .with('reviews', () => `No eligible reviews in ${period}.`)
    .with('ratings', () => `No eligible ratings in ${period}.`)
    .with('scans', () => `No scans recorded in ${period}.`)
    .with('private_feedback', () => `No private feedback received in ${period}.`)
    .with('review_clicks', () => `No review clicks recorded in ${period}.`)
    .exhaustive()
}

export function metricEvidenceLine(
  evidence: MetricEvidenceLineInput,
  locale?: string,
  timeZone?: string,
): string | null {
  if (evidence.basis === 'anonymous_lifetime') {
    return match(evidence.state)
      .with('ready', () => 'All-time aggregate')
      .with('updating', () => 'All-time totals are being checked.')
      .with('insufficient_data', () =>
        insufficientDataLine(evidence.subject, evidence.basis),
      )
      .with(
        'temporarily_unavailable',
        () => 'All-time totals are temporarily unavailable.',
      )
      .exhaustive()
  }

  return match(evidence.state)
    .with('ready', () =>
      evidence.dataThrough === null
        ? null
        : `Data through ${formatEvidenceTime(evidence.dataThrough, locale, timeZone)}`,
    )
    .with('updating', () => 'Updating; figures will appear when checks finish.')
    .with('insufficient_data', () =>
      insufficientDataLine(evidence.subject, evidence.basis),
    )
    .with('temporarily_unavailable', () => 'Figures are temporarily unavailable.')
    .exhaustive()
}
