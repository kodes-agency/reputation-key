import { Building2 } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'

export function StaffEmptyState() {
  return (
    <EmptyState
      icon={Building2}
      title="You don't have an active portal responsibility at this property."
    />
  )
}
