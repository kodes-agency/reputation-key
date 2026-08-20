import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type { CreateStaffParticipationMutationInput } from '#/components/features/team/shared/types'
import { StaffParticipationForm } from './staff-participation-form'

const idle = { isPending: false, error: null, isSuccess: false, data: null }
const mutation: Action<{
  data: CreateStaffParticipationMutationInput
}> = Object.assign(async () => ({ participation: { id: 'sp-new' } }), idle)

const meta: Meta<typeof StaffParticipationForm> = {
  title: 'Staff/StaffParticipationForm',
  component: StaffParticipationForm,
  tags: ['autodocs'],
  args: {
    propertyId: 'prop-1',
    members: [
      { userId: 'u-1', name: 'Avery Morgan', email: 'avery@example.com' },
      { userId: 'u-2', name: 'Jordan Lee', email: 'jordan@example.com' },
    ],
    activeUserIds: new Set<string>(),
    mutation,
  },
}
export default meta
type Story = StoryObj<typeof StaffParticipationForm>

export const Default: Story = {}

export const EveryoneAlreadyParticipates: Story = {
  args: { activeUserIds: new Set(['u-1', 'u-2']) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/all members already participate here/i),
    ).toBeInTheDocument()
  },
}

export const MutationError: Story = {
  args: {
    mutation: Object.assign(async () => ({ participation: null }), {
      ...idle,
      error: new Error('Participation could not be created.'),
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Participation could not be created.'),
    ).toBeInTheDocument()
  },
}
