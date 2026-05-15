// Shared types for GBP import components
import type { GoogleConnection, GbpLocation } from '#/shared/domain'

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
