import type { GbpLocation } from '#/shared/domain'
import { LocationPicker } from '#/components/features/integration'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'

type Props = Readonly<{
  locations: GbpLocation[]
  isLoading: boolean
  error: Error | null
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  onImport: () => void
  isImporting: boolean
  hasConnection: boolean
}>

export function ImportLocationsSection({
  locations,
  isLoading,
  error,
  selectedIds,
  onSelectionChange,
  onImport,
  isImporting,
  hasConnection,
}: Props) {
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-12"
        role="status"
        aria-live="polite"
      >
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <span className="sr-only">Loading locations...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">
          Failed to load locations. Please try selecting a different account.
        </p>
      </div>
    )
  }

  if (locations.length > 0) {
    return (
      <>
        <LocationPicker
          locations={locations}
          selectedIds={selectedIds}
          onSelectionChange={onSelectionChange}
        />
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {selectedIds.size} of {locations.length} selected
          </p>
          <Button onClick={onImport} disabled={selectedIds.size === 0 || isImporting}>
            {isImporting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Importing...
              </>
            ) : (
              `Import ${selectedIds.size} ${
                selectedIds.size === 1 ? 'property' : 'properties'
              }`
            )}
          </Button>
        </div>
      </>
    )
  }

  if (hasConnection) {
    return (
      <p className="text-center text-muted-foreground py-12">
        No locations found for this account.
      </p>
    )
  }

  return null
}
