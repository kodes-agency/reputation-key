// Single selectable location row — checkbox + business name, optional address
// and category badge. Pure presentational, so stories drive `selected` + a
// representative location shape directly.
import type { Meta, StoryObj } from '@storybook/react'
import type { GbpLocation } from '#/contexts/integration/application/public-api'
import { LocationRow } from './location-row'

const meta: Meta<typeof LocationRow> = {
  title: 'Integration/LocationRow',
  component: LocationRow,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof LocationRow>

const fullLocation: GbpLocation = {
  name: 'locations/abc-123',
  gbpPlaceId: 'place-abc-123',
  businessName: 'Acme Diner',
  address: '123 Main St, Springfield',
  primaryCategory: 'Restaurant',
  latitude: 39.78,
  longitude: -89.64,
  countryCode: null,
}

// Unselected, full detail (address + category badge).
export const Default: Story = {
  args: { location: fullLocation, selected: false, onSelect: () => {} },
}

export const Selected: Story = {
  args: { location: fullLocation, selected: true, onSelect: () => {} },
}

// No address / no category — the optional lines drop out.
export const Minimal: Story = {
  args: {
    location: {
      name: 'locations/min',
      gbpPlaceId: 'place-min',
      businessName: 'Unlisted Spot',
      address: null,
      primaryCategory: null,
      latitude: null,
      longitude: null,
      countryCode: null,
    },
    selected: false,
    onSelect: () => {},
  },
}
