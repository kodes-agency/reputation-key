// Location picker — "select all" control + a list of LocationRow entries.
// Owns selection through the `selectedIds` set + `onSelectionChange` callback,
// so stories vary the set to show none / some / all selected.
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import type { GbpLocation } from '#/contexts/integration/application/public-api'
import { LocationPicker } from './location-picker'

const meta: Meta<typeof LocationPicker> = {
  title: 'Integration/LocationPicker',
  component: LocationPicker,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof LocationPicker>

const locations: GbpLocation[] = [
  {
    name: 'locations/a',
    gbpPlaceId: 'place-a',
    businessName: 'Acme Diner',
    address: '123 Main St',
    primaryCategory: 'Restaurant',
    latitude: null,
    longitude: null,
    countryCode: null,
  },
  {
    name: 'locations/b',
    gbpPlaceId: 'place-b',
    businessName: 'Globex Garage',
    address: '88 Oak Ave',
    primaryCategory: 'Auto Repair',
    latitude: null,
    longitude: null,
    countryCode: null,
  },
  {
    name: 'locations/c',
    gbpPlaceId: 'place-c',
    businessName: 'Soylent Cafe',
    address: null,
    primaryCategory: null,
    latitude: null,
    longitude: null,
    countryCode: null,
  },
]

// Harness that mirrors a parent owning the selection set — lets the "select all"
// checkbox and per-row toggles drive the visible selection count.
function PickerHarness({ initial }: { initial: Set<string> }) {
  const [selected, setSelected] = useState<Set<string>>(initial)
  return (
    <LocationPicker
      locations={locations}
      selectedIds={selected}
      onSelectionChange={setSelected}
    />
  )
}

export const NoneSelected: Story = {
  render: () => <PickerHarness initial={new Set()} />,
}

export const SomeSelected: Story = {
  render: () => <PickerHarness initial={new Set(['place-a', 'place-c'])} />,
}

export const AllSelected: Story = {
  render: () => <PickerHarness initial={new Set(locations.map((l) => l.gbpPlaceId))} />,
}
