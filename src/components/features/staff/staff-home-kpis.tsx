import { MessageSquare, Star, ScanLine, MessageCircle } from 'lucide-react'
import type { KPIs } from '#/contexts/dashboard/application/public-api'
import { KPICard } from '#/components/features/property/property-dashboard-helpers'

type StaffHomeKpisProps = Readonly<{
  kpis: KPIs
}>

export function StaffHomeKpis({ kpis }: StaffHomeKpisProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <KPICard label="Reviews" kpi={kpis.reviews} icon={MessageSquare} />
      <KPICard
        label="Avg Rating"
        kpi={kpis.avgRating}
        icon={Star}
        formatValue={(v) => v.toFixed(1)}
      />
      <KPICard label="Scans" kpi={kpis.scans} icon={ScanLine} />
      <KPICard label="Feedback" kpi={kpis.feedback} icon={MessageCircle} />
    </div>
  )
}
