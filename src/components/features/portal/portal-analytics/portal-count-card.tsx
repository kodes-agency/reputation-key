import type { ComponentType } from 'react'
import {
  formatTrend,
  TrendIndicator,
} from '#/components/features/property/property-dashboard-helpers'
import { metricEvidenceLine } from '#/components/features/dashboard/metric-availability-presentation'
import type { PortalMetricEvidence } from '#/contexts/dashboard/application/public-api'

export function PortalCountCard({
  label,
  icon: Icon,
  kpi,
  timeZone,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  timeZone: string
  kpi: Readonly<{
    value: number | null
    trend: number | null
    evidence: PortalMetricEvidence
  }>
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums">
          {kpi.value === null ? '—' : kpi.value.toLocaleString()}
        </p>
        <span className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
          <TrendIndicator trend={kpi.trend} />
          {formatTrend(kpi.trend)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {metricEvidenceLine(
          {
            basis: kpi.evidence.basis,
            state: kpi.evidence.state,
            dataThrough: kpi.evidence.verifiedThrough,
          },
          undefined,
          timeZone,
        )}
      </p>
    </div>
  )
}
