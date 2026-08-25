import type { PortalMetricEvidenceView } from './portal-metric-evidence-presentation'
import {
  formatEvidenceTime,
  portalMetricAvailabilityDetail,
  portalMetricStateLabel,
} from './portal-metric-evidence-presentation'

type EvidenceEntry = Readonly<{
  label: string
  evidence: PortalMetricEvidenceView
}>

export function PortalMetricEvidenceSummary({
  entries,
  timeZone,
}: {
  entries: readonly EvidenceEntry[]
  timeZone: string
}) {
  return (
    <details className="rounded-lg border bg-muted/20 p-4">
      <summary className="cursor-pointer text-sm font-semibold tracking-tight">
        Data status
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Verified through tracks pipeline completeness. Latest activity is the newest
        business event; computed at is when this view was assembled.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-2xl text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="pb-2 pr-4 font-medium">Metric</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 pr-4 font-medium">Verified through</th>
              <th className="pb-2 pr-4 font-medium">Latest activity</th>
              <th className="pb-2 pr-4 font-medium">Computed at</th>
              <th className="pb-2 pr-4 font-medium">Completeness</th>
              <th className="pb-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ label, evidence }) => (
              <tr key={label} className="border-t">
                <th className="py-2 pr-4 font-medium">{label}</th>
                <td className="py-2 pr-4">{portalMetricStateLabel(evidence.state)}</td>
                <td className="py-2 pr-4 tabular-nums">
                  {formatEvidenceTime(evidence.verifiedThrough, undefined, timeZone)}
                </td>
                <td className="py-2 pr-4 tabular-nums">
                  {formatEvidenceTime(evidence.latestActivity, undefined, timeZone)}
                </td>
                <td className="py-2 pr-4 tabular-nums">
                  {formatEvidenceTime(evidence.computedAt, undefined, timeZone)}
                </td>
                <td className="py-2 pr-4 tabular-nums">
                  {Math.round(evidence.completeness * 100)}%
                </td>
                <td className="py-2">
                  {portalMetricAvailabilityDetail(evidence.availabilityReason)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
