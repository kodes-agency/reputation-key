// The two empty moments of a Portals list, on the Property page and on All
// properties: nothing made yet, and nothing matching the search.
import type { ReactNode } from 'react'
import { Globe, SearchX } from 'lucide-react'
import { ClearFiltersButton } from '#/components/ui/clear-filters-button'
import { EmptyState } from '#/components/ui/empty-state'

export function PortalOverviewEmpty({ action }: Readonly<{ action: ReactNode }>) {
  return (
    <EmptyState
      icon={Globe}
      title="No portals yet"
      description="Create a portal to set up a guest-facing page with links."
      action={action}
    />
  )
}

export function PortalOverviewNoMatch({
  searching,
  filters = true,
  onClear,
}: Readonly<{
  searching: boolean
  /** The list offers filters. `false` on All properties, which has only a search. */
  filters?: boolean
  onClear: () => void
}>) {
  return (
    <EmptyState
      icon={SearchX}
      title="No portals match"
      action={
        <ClearFiltersButton
          variant="outline"
          searching={searching}
          filters={filters}
          onClear={onClear}
        />
      }
    />
  )
}
