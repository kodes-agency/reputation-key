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

const action = <TInput,>(): Action<TInput> =>
  Object.assign(async (_input: TInput) => undefined, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

const portals = [
  {
    id: 'p-1',
    name: 'Guest Services',
    slug: 'guest-services',
    publicationState: 'published' as const,
    theme: { primaryColor: '#6366f1' },
  },
  {
    id: 'p-2',
    name: 'Spa & Wellness',
    slug: 'spa',
    publicationState: 'draft' as const,
    theme: { primaryColor: '#10b981' },
  },
  {
    id: 'p-3',
    name: 'Dining Feedback',
    slug: 'dining',
    publicationState: 'disabled' as const,
    theme: { primaryColor: '#f59e0b' },
  },
  {
    id: 'p-4',
    name: 'Archived Lobby',
    slug: 'archived-lobby',
    publicationState: 'archived' as const,
    theme: { primaryColor: '#64748b' },
  },
]

const baseArgs = {
  portals,
  propertyId: 'prop-1',
  propertyName: 'Acme Hotel',
  archiveMutation: action<{
    data: { portalId: string; publicationState: 'archived' }
  }>(),
  restoreMutation: action<{
    data: { portalId: string; publicationState: 'disabled' }
  }>(),
  portalGroups: [{ id: 'group-1', name: 'Guest experience', portalIds: ['p-1', 'p-2'] }],
  createGroupMutation: action<{
    data: { propertyId: string; name: string; portalIds?: string[] }
  }>(),
  updateGroupMutation: action<{ data: { portalGroupId: string; name: string } }>(),
  deleteGroupMutation: action<{ data: { portalGroupId: string } }>(),
  addPortalToGroupMutation: action<{
    data: { portalGroupId: string; portalId: string }
  }>(),
  removePortalFromGroupMutation: action<{
    data: { portalGroupId: string; portalId: string }
  }>(),
}

export const Default: Story = { args: baseArgs }

export const AllDisabled: Story = {
  args: {
    ...baseArgs,
    portals: portals.map((portal) => ({
      ...portal,
      publicationState: 'disabled' as const,
    })),
  },
}

export const Empty: Story = {
  args: { ...baseArgs, portals: [], portalGroups: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/no portals yet/i)).toBeInTheDocument()
  },
}

export const ShowsPortalNames: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Guest Services' })).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Spa & Wellness' })).toBeInTheDocument()
    await expect(
      canvas.getByRole('link', { name: 'Dining Feedback' }),
    ).toBeInTheDocument()
  },
}

export const RecoverableLifecycle: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const archiveButtons = within(canvasElement).getAllByRole('button', {
      name: /archive/i,
    })
    await userEvent.click(archiveButtons[0])
    await expect(
      await within(document.body).findByRole('alertdialog', {
        name: /archive guest services/i,
      }),
    ).toBeInTheDocument()

    await userEvent.click(within(document.body).getByRole('button', { name: /cancel/i }))
    // findBy, not getBy: the dismissed alert dialog leaves the canvas
    // aria-hidden for a beat, and getByRole would not see the button through it.
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: /^restore$/i }),
    )
    await expect(
      await within(document.body).findByRole('alertdialog', {
        name: /restore archived lobby/i,
      }),
    ).toBeInTheDocument()
    await expect(
      within(document.body).getByText(/return as disabled/i),
    ).toBeInTheDocument()
  },
}

export const SearchFiltersRows: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/search portals by name/i), 'spa')
    await expect(canvas.getByRole('link', { name: 'Spa & Wellness' })).toBeInTheDocument()
    await expect(canvas.queryByRole('link', { name: 'Guest Services' })).toBeNull()
  },
}

export const SearchWithNoMatches: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/search portals by name/i), 'zzzz')
    await expect(canvas.getByText(/no portals match/i)).toBeInTheDocument()
  },
}

export const StaffReadOnly: Story = {
  args: baseArgs,
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /add portal/i })).toBeNull()
    await expect(canvas.queryAllByRole('button', { name: /archive/i })).toHaveLength(0)
    await expect(canvas.queryAllByRole('button', { name: /restore/i })).toHaveLength(0)
    await expect(canvas.getByText(/view-only access/i)).toBeInTheDocument()
  },
}
