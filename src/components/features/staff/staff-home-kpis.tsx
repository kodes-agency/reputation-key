import { MessageSquare, Star, ScanLine, MessageCircle } from 'lucide-react'
import type { KPIs } from '#/contexts/dashboard/application/public-api'
import {
  KPICard,
  RatingKPICard,
} from '#/components/features/property/property-dashboard-helpers'

type StaffHomeKpisProps = Readonly<{
  kpis: KPIs
}>

export function StaffHomeKpis({ kpis }: StaffHomeKpisProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <KPICard label="Reviews" kpi={kpis.reviews} icon={MessageSquare} />
      <RatingKPICard
        label="Avg Rating"
        kpi={kpis.avgRating}
        icon={Star}
        timeRange="30d"
      />
      <KPICard label="Scans" kpi={kpis.scans} icon={ScanLine} />
      <KPICard label="Feedback" kpi={kpis.feedback} icon={MessageCircle} />
    </div>
  )
}
