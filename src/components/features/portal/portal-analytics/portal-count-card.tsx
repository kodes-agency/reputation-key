import type { ComponentType } from 'react'
import {
  formatTrend,
  TrendIndicator,
} from '#/components/features/property/property-dashboard-helpers'
import {
  portalMetricEvidenceLine,
  type PortalMetricEvidenceView,
} from './portal-metric-evidence-presentation'

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
    evidence: PortalMetricEvidenceView
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
        {portalMetricEvidenceLine(kpi.evidence, undefined, timeZone)}
      </p>
    </div>
  )
}
