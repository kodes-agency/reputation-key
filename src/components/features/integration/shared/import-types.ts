// Shared types for GBP import components
import type { GoogleConnection } from '#/contexts/integration/domain/types'
import type { GbpLocation } from '#/contexts/integration/domain/types'

export type GoogleConnectionDisplay = GoogleConnection & {
  displayName: string
}

export type LocationRowProps = {
  location: GbpLocation
  selected: boolean
  onSelect: (selected: boolean) => void
}

export type LocationPickerProps = {
  locations: GbpLocation[]
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
}
