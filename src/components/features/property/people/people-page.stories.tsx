// People page — staff / teams / directory management.
//
// PeoplePage receives pre-wrapped Action mutation objects from the route
// (per QRY-04/05). Stories provide mock Action objects (no useActionMutation
// inside PeoplePage or tabs).
//
// The Staff and Directory tabs render without any permission check. The Teams
// tab calls `usePermissions()` → `useRouteContext({ from: '/_authenticated' })`,
// so TeamsTab is wrapped in AuthRoleDecorator (see .stories-data.tsx), a
// story-local TanStack memory router providing `/_authenticated` with
// `{ role: 'AccountAdmin' }` (owner → every permission).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { PeoplePage } from './people-page'
import { AuthRoleDecorator, seededArgs } from './people-page-stories-data'

const meta: Meta<typeof PeoplePage> = {
  title: 'Property/PeoplePage',
  component: PeoplePage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof PeoplePage>

export const Default: Story = {
  args: { ...seededArgs, tab: 'staff' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The "Assign Staff" action opens a controlled dialog (PeoplePage owns the
    // open state), so the click reveals the dialog body without any RPC.
    await userEvent.click(canvas.getByRole('button', { name: /assign staff/i }))
    // DialogContent portals to document.body (outside the canvas), so scope
    // the awaitable findByText to document.body.
    await expect(
      await within(document.body).findByText(/select staff members and portals/i),
    ).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: {
    ...seededArgs,
    assignments: [],
    members: [],
    teams: [],
    portals: [],
    tab: 'staff',
  },
}

export const DirectoryTab: Story = {
  args: { ...seededArgs, tab: 'directory' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Alice Adams')).toBeInTheDocument()
    await expect(canvas.getByText('bob@acme.com')).toBeInTheDocument()
  },
}

export const TeamsTab: Story = {
  args: { ...seededArgs, tab: 'teams' },
  decorators: [AuthRoleDecorator],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // AccountAdmin can create teams → the Create Team action is visible.
    await userEvent.click(canvas.getByRole('button', { name: /create team/i }))
    // DialogContent portals to document.body; scope findByText there.
    await expect(
      await within(document.body).findByText('Create a new team'),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Front Desk')).toBeInTheDocument()
  },
}
