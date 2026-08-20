import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { TeamMemberList } from './team-member-list'

const idle = { isPending: false, error: null, isSuccess: false, data: null }
const addAction: Action<{
  data: { teamId: string; staffParticipationId: string }
}> = Object.assign(async () => ({ membership: { id: 'tm-new' } }), idle)
const removeAction: Action<{
  data: { teamId: string; staffParticipationId: string; reason?: string }
}> = Object.assign(async () => ({ removed: true }), idle)

const memberships = [
  {
    id: 'tm-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    teamId: 'team-1',
    staffParticipationId: 'sp-1',
    userId: 'u-1',
    displayName: 'Avery Morgan',
    role: 'lead' as const,
    effectiveFrom: '2026-01-10T12:00:00.000Z',
    effectiveTo: null,
  },
  {
    id: 'tm-2',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    teamId: 'team-1',
    staffParticipationId: 'sp-2',
    userId: 'u-2',
    displayName: 'Jordan Lee',
    role: 'member' as const,
    effectiveFrom: '2026-02-01T12:00:00.000Z',
    effectiveTo: null,
  },
]

const meta: Meta<typeof TeamMemberList> = {
  title: 'Team/TeamMemberList',
  component: TeamMemberList,
  tags: ['autodocs'],
  args: {
    teamId: 'team-1',
    memberships,
    availableParticipations: [{ id: 'sp-3', userId: 'u-3', displayName: 'Sam Rivera' }],
    canManageMembers: true,
    addAction,
    removeAction,
  },
}
export default meta
type Story = StoryObj<typeof TeamMemberList>

export const Populated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Avery Morgan')).toBeInTheDocument()
    await expect(canvas.getByText('Lead')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /add members/i }))
    await expect(await within(document.body).findByText('Sam Rivera')).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: { memberships: [] },
}

export const ViewOnly: Story = {
  args: { canManageMembers: false, availableParticipations: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByRole('button', { name: /add members/i }),
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole('button', { name: /remove jordan/i }),
    ).not.toBeInTheDocument()
  },
}

export const MutationError: Story = {
  args: {
    removeAction: Object.assign(async () => ({ removed: false }), {
      ...idle,
      error: new Error('Membership change was denied.'),
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Membership change was denied.'),
    ).toBeInTheDocument()
  },
}
