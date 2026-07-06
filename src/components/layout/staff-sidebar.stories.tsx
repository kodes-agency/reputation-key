// Storybook stories for StaffSidebar — the Staff app chrome.
// Rendered by the authenticated layout for the Staff role (the route picks
// ManagerSidebar for PropertyManager+, else StaffSidebar). Stateful: a useEffect
// keeps a valid property in the URL (?propertyId= is the source of truth per
// ADR 0016), defaulting to the first property when none is selected, so nav is
// usable even on first render.
//
// The Team nav entry is conditional on `hasTeam`; the org switcher renders only
// when an activeOrganization is present; the property switcher renders only
// when more than one property is available. Stories vary each axis.
//
// setActiveOrganization is a prop (Phase-1 fn-as-prop channel) wrapped by
// useAction inside the component; the story passes a plain matching callable.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { SidebarProvider } from '#/components/ui/sidebar'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { StaffSidebar } from './staff-sidebar'

const organizations = [
  { id: 'org-acme', name: 'Acme Group' },
  { id: 'org-globex', name: 'Globex Worldwide' },
]

const properties = [
  { id: 'prop-acme', name: 'Acme Hotel', slug: 'acme-hotel' },
  { id: 'prop-globex', name: 'Globex HQ', slug: 'globex-hq' },
]

// Prop type is a plain callable (not a server-fn brand), so a matching async fn
// satisfies it directly — no cast needed.
const setActiveOrganization = async (_input: {
  data: { organizationId: string }
}): Promise<void> => {
  // No-op: org switch is reflected via the activeOrganization prop in real use.
}

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

// Staff role, two orgs + two properties, team membership → full nav including
// Team, plus both switchers.
export const AsStaff: Story = {
  args: {
    organizations,
    properties,
    activeOrganization: organizations[0],
    setActiveOrganization,
    hasTeam: true,
  },
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Org switcher shows the active organization.
    expect(await canvas.findByText(/acme group/i)).toBeInTheDocument()
    // Core nav + conditional Team entry render.
    expect(canvas.getByText(/^home$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^progress$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^leaderboard$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^team$/i)).toBeInTheDocument()
  },
}

// No team membership → the Team nav entry is omitted; the rest of the nav and
// both switchers still render.
export const NoTeam: Story = {
  args: {
    organizations,
    properties,
    activeOrganization: organizations[0],
    setActiveOrganization,
    hasTeam: false,
  },
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^home$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^progress$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^leaderboard$/i)).toBeInTheDocument()
    // Team entry must NOT render without a team.
    expect(canvas.queryByText(/^team$/i)).toBeNull()
  },
}

// No active organization → the org switcher is hidden; nav still renders.
export const NoOrganization: Story = {
  args: {
    organizations,
    properties,
    activeOrganization: null,
    setActiveOrganization,
    hasTeam: true,
  },
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^home$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^team$/i)).toBeInTheDocument()
  },
}

// A single property → the property switcher is hidden (it only renders for >1).
export const SingleProperty: Story = {
  args: {
    organizations,
    properties: [properties[0]],
    activeOrganization: organizations[0],
    setActiveOrganization,
    hasTeam: true,
  },
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^home$/i)).toBeInTheDocument()
  },
}
