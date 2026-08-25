// Storybook stories for StaffSidebar — the Staff app chrome.
// Rendered by the authenticated layout for the Staff role (the route picks
// ManagerSidebar for PropertyManager+, else StaffSidebar). Stateful: a useEffect
// keeps a valid property in the URL (?propertyId= is the source of truth per
// ADR 0016), defaulting to the first property when none is selected, so nav is
// usable even on first render.
//
// The property switcher renders only when more than one property is available.
// Stories assert that multi-Organization and deferred Team navigation stay absent.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { SidebarProvider } from '#/components/ui/sidebar'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { StaffSidebar } from './staff-sidebar'

const properties = [
  { id: 'prop-acme', name: 'Acme Hotel', slug: 'acme-hotel' },
  { id: 'prop-globex', name: 'Globex HQ', slug: 'globex-hq' },
]

const meta: Meta<typeof StaffSidebar> = {
  title: 'Layout/StaffSidebar',
  component: StaffSidebar,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <SidebarProvider style={{ minHeight: '100vh' }}>
        <Story />
      </SidebarProvider>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof StaffSidebar>

// Legacy Staff posture with two properties: beta navigation and property scope.
export const AsStaff: Story = {
  args: {
    properties,
  },
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^home$/i)).toBeInTheDocument()
    expect(canvas.queryByText(/acme group/i)).toBeNull()
    // Beta Staff navigation renders without deferred product surfaces.
    expect(canvas.getByText(/^progress$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^leaderboard$/i)).toBeInTheDocument()
    expect(canvas.queryByText(/^team$/i)).toBeNull()
  },
}

// A single property → the property switcher is hidden (it only renders for >1).
export const SingleProperty: Story = {
  args: {
    properties: [properties[0]],
  },
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^home$/i)).toBeInTheDocument()
  },
}
