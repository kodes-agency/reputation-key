export type PortalMetricStateView =
  'ready' | 'updating' | 'insufficient_data' | 'temporarily_unavailable'

export type PortalMetricEvidenceView = Readonly<{
  basis?: 'governed_period' | 'anonymous_lifetime'
  definitionVersionId: string | null
  state: PortalMetricStateView
  verifiedThrough: Date | null
  latestActivity: Date | null
  computedAt: Date
  completeness: number
  availabilityReason: string | null
  correctionHead: Date | null
  sampleCount: number
}>

export function portalMetricStateLabel(state: PortalMetricStateView): string {
  switch (state) {
    case 'ready':
      return 'Ready'
    case 'updating':
      return 'Updating'
    case 'insufficient_data':
      return 'Insufficient data'
    case 'temporarily_unavailable':
      return 'Temporarily unavailable'
  }
}

export function formatEvidenceTime(
  value: Date | null,
  locale?: string,
  timeZone?: string,
): string {
  if (value === null) return '—'
  return value.toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  })
}

export function portalMetricAvailabilityDetail(reason: string | null): string {
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

export function portalMetricEvidenceLine(
  evidence: PortalMetricEvidenceView,
  locale?: string,
  timeZone?: string,
): string {
  if (evidence.basis === 'anonymous_lifetime') {
    switch (evidence.state) {
      case 'ready':
        return 'All-time aggregate'
      case 'updating':
        return 'All-time totals are being checked.'
      case 'insufficient_data':
        return 'No eligible ratings in the all-time aggregate.'
      case 'temporarily_unavailable':
        return 'All-time totals are temporarily unavailable.'
    }
  }
  switch (evidence.state) {
    case 'ready':
      return `Data through ${formatEvidenceTime(evidence.verifiedThrough, locale, timeZone)}`
    case 'updating':
      return 'Updating; figures will appear when checks finish.'
    case 'insufficient_data':
      return 'No eligible ratings in this period.'
    case 'temporarily_unavailable':
      return 'Figures are temporarily unavailable.'
  }
}
