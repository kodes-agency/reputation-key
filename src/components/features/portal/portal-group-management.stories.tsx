import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { PortalGroupManagement } from './portal-group-management'
import type { Action } from '#/components/hooks/use-action'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../.storybook/AuthedRouterDecorator'

type CreateInput = {
  data: { propertyId: string; name: string; portalIds?: string[] }
}
type UpdateInput = { data: { portalGroupId: string; name: string } }
type MembershipInput = { data: { portalGroupId: string; portalId: string } }
type DeleteInput = { data: { portalGroupId: string } }

const action = <TInput,>(error: Error | null = null): Action<TInput> =>
  Object.assign(
    async (_input: TInput) => {
      if (error) throw error
      return undefined
    },
    { isPending: false, error, isSuccess: false, data: null },
  )

const meta: Meta<typeof PortalGroupManagement> = {
  title: 'Portal/PortalGroupManagement',
  component: PortalGroupManagement,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalGroupManagement>

const portals = [
  { id: 'portal-1', name: 'Guest services' },
  { id: 'portal-2', name: 'Dining' },
  { id: 'portal-3', name: 'Spa and wellness' },
]

const groups = [
  { id: 'group-1', name: 'Guest experience', portalIds: ['portal-1', 'portal-2'] },
]

const baseArgs = {
  propertyId: 'property-1',
  portals,
  groups,
  createMutation: action<CreateInput>(),
  updateMutation: action<UpdateInput>(),
  deleteMutation: action<DeleteInput>(),
  addPortalMutation: action<MembershipInput>(),
  removePortalMutation: action<MembershipInput>(),
}

export const Populated: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Guest experience')).toBeInTheDocument()
    await expect(canvas.getByText('Guest services')).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: { ...baseArgs, groups: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/no portal groups yet/i),
    ).toBeInTheDocument()
  },
}

export const Loading: Story = {
  args: { ...baseArgs, groups: [], state: 'loading' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/loading portal groups/i),
    ).toBeInTheDocument()
  },
}

export const LoadError: Story = {
  args: {
    ...baseArgs,
    groups: [],
    state: 'error',
    error: new globalThis.Error('Portal groups could not be loaded.'),
    onRetry: () => undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent(/could not be loaded/i)
    await expect(canvas.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  },
}

export const PermissionDenied: Story = {
  args: baseArgs,
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/view-only access/i)).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /new group/i })).toBeNull()
  },
}

export const NoEligiblePortal: Story = {
  args: {
    ...baseArgs,
    groups: [
      {
        id: 'group-1',
        name: 'Every portal',
        portalIds: portals.map((portal) => portal.id),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/no eligible portals remain/i),
    ).toBeInTheDocument()
  },
}

export const ArchiveConfirmation: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /archive group/i }),
    )
    await expect(
      await within(document.body).findByRole('alertdialog', {
        name: /archive guest experience/i,
      }),
    ).toBeInTheDocument()
  },
}

export const MutationError: Story = {
  args: {
    ...baseArgs,
    addPortalMutation: action<MembershipInput>(
      new globalThis.Error('The selected portal is already assigned to another group.'),
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      /already assigned/i,
    )
  },
}
