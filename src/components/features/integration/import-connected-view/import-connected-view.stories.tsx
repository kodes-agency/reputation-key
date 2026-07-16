// Import connected view — composes the account selector, the connect button,
// and the locations section. Locations are fetched via the `listGbpLocations`
// server fn prop (mocked here), so stories reach loading/error/empty/loaded by
// varying that mock. `useNavigate` is supplied by the global Storybook router.
import type { Meta, StoryObj } from '@storybook/react'
import type { GbpLocation } from '#/contexts/integration/application/public-api'
import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'
import type { listGbpLocations } from '#/contexts/integration/server/gbp-import'
import type { Action } from '#/components/hooks/use-action'
import { ImportConnectedView } from './import-connected-view'

const meta: Meta<typeof ImportConnectedView> = {
  title: 'Integration/ImportConnectedView',
  component: ImportConnectedView,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof ImportConnectedView>

const connection: GoogleConnectionDto = {
  id: 'conn-1',
  organizationId: 'org-1',
  googleAccountId: 'gacct-1',
  googleEmail: 'owner@acme.com',
  scopes: [],
  connectedBy: 'user-1',
  visibility: 'private',
  status: 'active',
  createdAt: new Date('2026-06-01'),
  updatedAt: new Date('2026-06-01'),
}

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
]

type ImportInput = {
  data: {
    connectionId: string
    locations: Array<{
      gbpPlaceId: string
      businessName: string
      address: string | null
      primaryCategory: string | null
      gbpLocationName: string
    }>
  }
}

function makeImportAction(
  overrides: { isPending?: boolean; error?: unknown } = {},
): Action<ImportInput, { job: { id: string } }> {
  const run = async (): Promise<{ job: { id: string } }> => ({ job: { id: 'job-1' } })
  return Object.assign(run, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: false,
    data: null,
  })
}

const getAuthUrl = async (): Promise<{ url: string }> => ({
  url: 'https://example.com/oauth',
})

// Resolves immediately with the seeded locations.
const loadedList = (async (): Promise<{ locations: GbpLocation[] }> => ({
  locations,
})) as unknown as typeof listGbpLocations

// No connections yet → only the connect affordance renders (section is null).
export const NoConnection: Story = {
  args: {
    connections: [],
    getAuthUrl,
    importAction: makeImportAction(),
    listGbpLocations: loadedList,
  },
}

// Account connected, locations resolved → the picker + import button render.
export const LoadedLocations: Story = {
  args: {
    connections: [connection],
    initialConnectionId: 'conn-1',
    getAuthUrl,
    importAction: makeImportAction(),
    listGbpLocations: loadedList,
  },
}

// listGbpLocations never settles → the section stays in its loading spinner.
export const LoadingLocations: Story = {
  args: {
    connections: [connection],
    initialConnectionId: 'conn-1',
    getAuthUrl,
    importAction: makeImportAction(),
    listGbpLocations: (() =>
      Promise.withResolvers<{ locations: GbpLocation[] }>()
        .promise) as unknown as typeof listGbpLocations,
  },
}

// listGbpLocations rejects → the section shows its error banner.
export const ErrorLocations: Story = {
  args: {
    connections: [connection],
    initialConnectionId: 'conn-1',
    getAuthUrl,
    importAction: makeImportAction(),
    listGbpLocations: (async (): Promise<{ locations: GbpLocation[] }> => {
      throw new Error('GBP API unavailable')
    }) as unknown as typeof listGbpLocations,
  },
}

// Import action carries an error → the top-level "Failed to start import" banner
// renders below the (loaded) section.
export const ImportError: Story = {
  args: {
    connections: [connection],
    initialConnectionId: 'conn-1',
    getAuthUrl,
    importAction: makeImportAction({
      error: new Error('You do not have permission to import properties'),
    }),
    listGbpLocations: loadedList,
  },
}
