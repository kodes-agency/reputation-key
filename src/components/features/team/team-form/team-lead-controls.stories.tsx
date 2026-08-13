import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { TeamLeadControls } from './team-lead-controls'

const idle = { isPending: false, error: null, isSuccess: false, data: null }
const setLeadAction: Action<{
  data: { teamId: string; staffParticipationId: string }
}> = Object.assign(async () => ({ membership: { id: 'tm-1' } }), idle)
const clearLeadAction: Action<{
  data: { teamId: string; reason?: string }
}> = Object.assign(async () => ({ cleared: true }), idle)
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

const meta: Meta<typeof TeamLeadControls> = {
  title: 'Team/TeamLeadControls',
  component: TeamLeadControls,
  tags: ['autodocs'],
  args: {
    teamId: 'team-1',
    memberships,
    setLeadAction,
    clearLeadAction,
  },
}
export default meta
type Story = StoryObj<typeof TeamLeadControls>

export const CurrentLead: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /clear lead/i })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /replace lead/i })).toBeDisabled()
  },
}

export const NoMembers: Story = {
  args: { memberships: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/add a member before appointing/i),
    ).toBeInTheDocument()
  },
}

export const MutationError: Story = {
  args: {
    setLeadAction: Object.assign(async () => ({ membership: null }), {
      ...idle,
      error: new Error('Lead appointment was denied.'),
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Lead appointment was denied.'),
    ).toBeInTheDocument()
  },
}
