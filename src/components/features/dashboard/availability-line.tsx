import type { MetricAvailabilityState } from '#/contexts/reporting/application/public-api'
import {
  metricAvailabilityDetail,
  metricEvidenceLine,
  metricStateLabel,
  type MetricEvidenceSubject,
} from './metric-availability-presentation'

export function AvailabilityLine({
  subject,
  state,
  dataThrough,
  reason,
  locale,
  timeZone,
}: Readonly<{
  subject: MetricEvidenceSubject
  state: MetricAvailabilityState
  dataThrough: Date | null
  reason: string | null
  locale?: string
  timeZone?: string
}>) {
  const detail = reason === null ? null : metricAvailabilityDetail(reason)
  const evidence = metricEvidenceLine({ subject, state, dataThrough }, locale, timeZone)

  return (
    <span className="text-xs text-muted-foreground">
      <span className="font-medium">{metricStateLabel(state)}</span>
      {evidence === null ? null : (
        <>
          <span aria-hidden="true"> · </span>
          <span>{evidence}</span>
        </>
      )}
      {detail === null ? null : (
        <>
          {evidence === null ? <span aria-hidden="true"> · </span> : ' '}
          <span>{detail}</span>
        </>
      )}
    </span>
  )
}
