import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { StaffTeamView } from './staff-team-view'

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
    userId: 'u-lead',
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
    userId: 'u-member',
    displayName: 'Jordan Lee',
    role: 'member' as const,
    effectiveFrom: '2026-02-01T12:00:00.000Z',
    effectiveTo: null,
  },
]

const meta: Meta<typeof StaffTeamView> = {
  title: 'Team/StaffTeamView',
  component: StaffTeamView,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    team: {
      id: 'team-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      name: 'Guest Experience',
      description: 'Coordinates arrivals and in-stay support.',
    },
    memberships,
    availableParticipations: [{ id: 'sp-3', userId: 'u-3', displayName: 'Sam Rivera' }],
    currentUserId: 'u-lead',
    addAction,
    removeAction,
  },
}
export default meta
type Story = StoryObj<typeof StaffTeamView>

export const Lead: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('You lead this team')).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: /remove jordan lee/i }),
    ).toBeInTheDocument()
  },
}

export const MemberViewOnly: Story = {
  args: { currentUserId: 'u-member', availableParticipations: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('You are a team member')).toBeInTheDocument()
    await expect(
      canvas.queryByRole('button', { name: /remove jordan lee/i }),
    ).not.toBeInTheDocument()
  },
}

export const Unassigned: Story = {
  args: { team: null, memberships: [], availableParticipations: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('You are not assigned to a team'),
    ).toBeInTheDocument()
  },
}
