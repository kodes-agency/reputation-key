// Storybook stories for SettingsSidebar — the ONLY sidebar that gates its own
// items off usePermissions(). `organization.update`, `member.list`,
// `ai.manage` and `integration.manage` each conditionally render a nav
// entry, so the visible nav changes with the signed-in role:
//   - AccountAdmin (owner): all beta items render.
//   - PropertyManager (admin): Members (read-only), AI overview and the account
//     entries render; Organization settings and Google connection
//     administration are AccountAdmin-only.
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

/** The four entries every role gets, waiting for the sidebar to render. */
async function expectAlwaysOnEntries(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  expect(await canvas.findByText(/^profile$/i)).toBeInTheDocument()
  for (const entry of [/^security$/i, /^preferences$/i, /^notifications$/i]) {
    expect(canvas.getByText(entry)).toBeInTheDocument()
  }
}

/** Members and AI overview come with managing; Recognition stays out of this beta. */
function expectManagerEntries(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  expect(canvas.getByText(/^members$/i)).toBeInTheDocument()
  expect(canvas.queryByText(/^recognition$/i)).toBeNull()
  expect(canvas.getByText(/^ai overview$/i)).toBeInTheDocument()
}

// Owner role → every gated beta item (Organization, Members,
// Integrations) renders alongside the four always-on entries.
export const AsAccountAdmin: Story = {
  decorators: [withRole('AccountAdmin')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectAlwaysOnEntries(canvasElement)
    expect(canvas.getByRole('link', { name: /^organization$/i })).toBeInTheDocument()
    expectManagerEntries(canvasElement)
    expect(canvas.getByText(/^integrations$/i)).toBeInTheDocument()
    // Scope is labelled: account pages under You, shared pages under Organization.
    expect(canvas.getByText(/^you$/i)).toBeInTheDocument()
    expect(canvas.getAllByText(/^organization$/i)).toHaveLength(2)
  },
}

// PropertyManager lists Members and manages AI settings, but edits neither the
// Organization (ADR 0033, amended 2026-10) nor the Google connection: both are
// AccountAdmin-only. "Back to app" → /properties.
export const AsPropertyManager: Story = {
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectAlwaysOnEntries(canvasElement)
    expectManagerEntries(canvasElement)
    expect(canvas.queryByRole('link', { name: /^organization$/i })).toBeNull()
    expect(canvas.queryByText(/^integrations$/i)).toBeNull()
  },
}

// Member lacks organization.update / member.list / ai.manage / integration.manage,
// so the gated entries are absent. Only Profile, Security,
// Preferences, Notifications render. "Back to app" → /.
export const AsMember: Story = {
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectAlwaysOnEntries(canvasElement)
    // Gated entries must NOT render for Member.
    for (const gated of [
      /^organization$/i,
      /^members$/i,
      /^recognition$/i,
      /^ai overview$/i,
      /^integrations$/i,
    ]) {
      expect(canvas.queryByText(gated)).toBeNull()
    }
  },
}
