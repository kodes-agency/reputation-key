import type { MetricAvailabilityState } from '#/contexts/dashboard/application/public-api'
import {
  metricAvailabilityDetail,
  metricEvidenceLine,
  metricStateLabel,
} from './metric-availability-presentation'

export function AvailabilityLine({
  state,
  dataThrough,
  reason,
  locale,
  timeZone,
}: Readonly<{
  state: MetricAvailabilityState
  dataThrough: Date | null
  reason: string | null
  locale?: string
  timeZone?: string
}>) {
  const detail = reason === null ? null : metricAvailabilityDetail(reason)

  return (
    <span className="text-xs text-muted-foreground">
      <span className="font-medium">{metricStateLabel(state)}</span>
      <span aria-hidden="true"> · </span>
      <span>{metricEvidenceLine({ state, dataThrough }, locale, timeZone)}</span>
      {detail === null ? null : <span> {detail}</span>}
    </span>
  )
}
