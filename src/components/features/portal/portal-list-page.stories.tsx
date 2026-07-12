// Portal list page — property-scoped portal directory table.
// Receives a wrapped delete action (Action) from the route per QRY-04/05.
// Component + button do not import server fns or call useActionMutation.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { PortalListPage } from './portal-list-page'
import type { Action } from '#/components/hooks/use-action'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../.storybook/AuthedRouterDecorator'

const meta: Meta<typeof PortalListPage> = {
  title: 'Portal/PortalListPage',
  component: PortalListPage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalListPage>

const deleteMutation: Action<{ data: { portalId: string } }> = Object.assign(
  async (_input: { data: { portalId: string } }) => ({ deleted: true }),
  { isPending: false, error: null, isSuccess: false, data: null },
)

const portals = [
  {
    id: 'p-1',
    name: 'Guest Services',
    slug: 'guest-services',
    isActive: true,
    theme: { primaryColor: '#6366f1' },
  },
  {
    id: 'p-2',
    name: 'Spa & Wellness',
    slug: 'spa',
    isActive: true,
    theme: { primaryColor: '#10b981' },
  },
  {
    id: 'p-3',
    name: 'Dining Feedback',
    slug: 'dining',
    isActive: false,
    theme: { primaryColor: '#f59e0b' },
  },
]

export const Default: Story = {
  args: {
    portals,
    propertyId: 'prop-1',
    propertyName: 'Acme Hotel',
    propertySlug: 'acme-hotel',
    deleteMutation,
  },
}

// Inactive portal row renders at half opacity — visible state difference.
export const AllInactive: Story = {
  args: {
    ...Default.args,
    portals: portals.map((p) => ({ ...p, isActive: false })),
  },
}

// Empty state — the EmptyState CTA renders (gated on portal.create).
export const Empty: Story = {
  args: {
    ...Default.args,
    portals: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/no portals yet/i)).toBeInTheDocument()
  },
}

// Populated list renders every portal name as a link.
export const ShowsPortalNames: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Guest Services')).toBeInTheDocument()
    await expect(canvas.getByText('Spa & Wellness')).toBeInTheDocument()
    await expect(canvas.getByText('Dining Feedback')).toBeInTheDocument()
  },
}

// Delete confirmation: clicking Delete opens the AlertDialog (an authenticated
// affordance — AccountAdmin has portal.delete).
export const DeleteConfirmation: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const deleteButtons = canvas.getAllByRole('button', { name: /delete/i })
    await userEvent.click(deleteButtons[0])
    // AlertDialog content is portaled to document.body (outside the story
    // canvas), so query the document — not the canvas — for the confirm dialog.
    await expect(
      await within(document.body).findByRole('alertdialog', {
        name: /delete guest services\?/i,
      }),
    ).toBeInTheDocument()
  },
}

// Staff role — no create/delete affordances (no Add Portal button, no Delete).
export const StaffReadOnly: Story = {
  args: { ...Default.args },
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /add portal/i })).toBeNull()
    await expect(canvas.queryAllByRole('button', { name: /delete/i })).toHaveLength(0)
  },
}
