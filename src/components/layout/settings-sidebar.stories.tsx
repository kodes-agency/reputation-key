// Storybook stories for SettingsSidebar — the ONLY sidebar that gates its own
// items off usePermissions(). `organization.update`, `member.list`,
// `ai.manage` and `integration.manage` each conditionally render a nav
// entry, so the visible nav changes with the signed-in role:
//   - AccountAdmin (owner): all beta items render.
//   - PropertyManager (admin): manager settings render, but Google connection
//     administration stays AccountAdmin-only.
//   - Staff (member): only Profile, Security, Preferences, Notifications — the
//     four always-on entries.
// `isManager = hasRole(role, 'PropertyManager')` also flips the "Back to app"
// link target (/properties for manager+, / for staff).
//
// Each story nests an inner authed memory router carrying that role's context,
// so usePermissions() — which reads useRouteContext({ from: '/_authenticated' })
// — resolves to the intended role. The global RouterDecorator still wraps
// outermost; the withRole router's context wins for the subtree.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { SidebarProvider } from '#/components/ui/sidebar'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { SettingsSidebar } from './settings-sidebar'

const meta: Meta<typeof SettingsSidebar> = {
  title: 'Layout/SettingsSidebar',
  component: SettingsSidebar,
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
type Story = StoryObj<typeof SettingsSidebar>

// Owner role → every gated beta item (Organization, Members,
// Integrations) renders alongside the four always-on entries.
export const AsAccountAdmin: Story = {
  decorators: [withRole('AccountAdmin')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^profile$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^security$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^preferences$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^notifications$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^organization$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^members$/i)).toBeInTheDocument()
    expect(canvas.queryByText(/^recognition$/i)).toBeNull()
    expect(canvas.getByText(/^ai & replies$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^integrations$/i)).toBeInTheDocument()
  },
}

// PropertyManager can update Organization presentation, list Members, and manage
// AI settings. Google connection administration remains AccountAdmin-only.
// "Back to app" → /properties.
export const AsPropertyManager: Story = {
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^organization$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^members$/i)).toBeInTheDocument()
    expect(canvas.queryByText(/^recognition$/i)).toBeNull()
    expect(canvas.getByText(/^ai & replies$/i)).toBeInTheDocument()
    expect(canvas.queryByText(/^integrations$/i)).toBeNull()
  },
}

// Staff lacks organization.update / member.list / ai.manage / integration.manage,
// so the gated entries are absent. Only Profile, Security,
// Preferences, Notifications render. "Back to app" → /.
export const AsStaff: Story = {
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/^profile$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^security$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^preferences$/i)).toBeInTheDocument()
    expect(canvas.getByText(/^notifications$/i)).toBeInTheDocument()
    // Gated entries must NOT render for Staff.
    expect(canvas.queryByText(/^organization$/i)).toBeNull()
    expect(canvas.queryByText(/^members$/i)).toBeNull()
    expect(canvas.queryByText(/^recognition$/i)).toBeNull()
    expect(canvas.queryByText(/^ai & replies$/i)).toBeNull()
    expect(canvas.queryByText(/^integrations$/i)).toBeNull()
  },
}
