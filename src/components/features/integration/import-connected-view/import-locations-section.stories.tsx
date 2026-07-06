// Import locations section — the state machine rendered below the account
// selector: loading spinner → error banner → empty hint → the picker + import
// button. Pure presentational; each story pins one branch.
import type { Meta, StoryObj } from '@storybook/react'
import type { GbpLocation } from '#/contexts/integration/application/public-api'
import { ImportLocationsSection } from './import-locations-section'

const meta: Meta<typeof ImportLocationsSection> = {
  title: 'Integration/ImportLocationsSection',
  component: ImportLocationsSection,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof ImportLocationsSection>

const noop = () => {}

const locations: GbpLocation[] = [
  {
    name: 'locations/a',
    gbpPlaceId: 'place-a',
    businessName: 'Acme Diner',
    address: '123 Main St',
    primaryCategory: 'Restaurant',
    latitude: null,
    longitude: null,
  },
  {
    name: 'locations/b',
    gbpPlaceId: 'place-b',
    businessName: 'Globex Garage',
    address: '88 Oak Ave',
    primaryCategory: 'Auto Repair',
    latitude: null,
    longitude: null,
  },
]

export const Loading: Story = {
  args: {
    locations: [],
    isLoading: true,
    error: null,
    selectedIds: new Set(),
    onSelectionChange: noop,
    onImport: noop,
    isImporting: false,
    hasConnection: true,
  },
}

export const ErrorState: Story = {
  args: {
    locations: [],
    isLoading: false,
    error: new Error('GBP API rate limited'),
    selectedIds: new Set(),
    onSelectionChange: noop,
    onImport: noop,
    isImporting: false,
    hasConnection: true,
  },
}

// Account connected but returned zero locations → the empty hint.
export const Empty: Story = {
  args: {
    locations: [],
    isLoading: false,
    error: null,
    selectedIds: new Set(),
    onSelectionChange: noop,
    onImport: noop,
    isImporting: false,
    hasConnection: true,
  },
}

// Locations loaded, two of two selected → import button enabled.
export const Loaded: Story = {
  args: {
    locations,
    isLoading: false,
    error: null,
    selectedIds: new Set(['place-a', 'place-b']),
    onSelectionChange: noop,
    onImport: noop,
    isImporting: false,
    hasConnection: true,
  },
}

// Import in flight → button shows the spinner + "Importing..." copy.
export const Importing: Story = {
  args: {
    locations,
    isLoading: false,
    error: null,
    selectedIds: new Set(['place-a']),
    onSelectionChange: noop,
    onImport: noop,
    isImporting: true,
    hasConnection: true,
  },
}
