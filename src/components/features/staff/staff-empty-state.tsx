import { Building2 } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'

export function StaffEmptyState() {
  return (
    <EmptyState
      icon={Building2}
      title="Your manager hasn't assigned you to any portals yet."
    />
  )
}
