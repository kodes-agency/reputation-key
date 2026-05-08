import type { GbpLocation } from '#/shared/domain'
import { Checkbox } from '#/components/ui/checkbox'
import { LocationRow } from './location-row'

interface LocationPickerProps {
  locations: GbpLocation[]
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
}

export function LocationPicker({
  locations,
  selectedIds,
  onSelectionChange,
}: LocationPickerProps) {
  const allSelected = locations.length > 0 && selectedIds.size === locations.length

  const handleSelectAll = (checked: boolean | string) => {
    const isChecked = checked === true
    onSelectionChange(isChecked ? new Set(locations.map((l) => l.gbpPlaceId)) : new Set())
  }

  const handleLocationToggle = (gbpPlaceId: string, checked: boolean) => {
    const newIds = new Set(selectedIds)
    if (checked) {
      newIds.add(gbpPlaceId)
    } else {
      newIds.delete(gbpPlaceId)
    }
    onSelectionChange(newIds)
  }

  if (locations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
        <p className="text-muted-foreground">No locations found.</p>
        <p className="text-sm text-muted-foreground">
          Select a different Google account or connect a new one.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Checkbox
          id="select-all"
          checked={allSelected}
          onCheckedChange={handleSelectAll}
          aria-label="Select all locations"
        />
        <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
          Select all ({locations.length})
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {locations.map((location) => (
          <LocationRow
            key={location.gbpPlaceId}
            location={location}
            selected={selectedIds.has(location.gbpPlaceId)}
            onSelect={(checked) => handleLocationToggle(location.gbpPlaceId, checked)}
          />
        ))}
      </div>
    </div>
  )
}
