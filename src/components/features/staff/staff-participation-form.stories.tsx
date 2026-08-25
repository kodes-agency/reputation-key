import type { Meta, StoryObj } from '@storybook/react'
import type { Action } from '#/components/hooks/use-action'
import type { CreateStaffParticipationMutationInput } from '#/components/features/staff/types'
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
    mutation,
  },
}
export default meta
type Story = StoryObj<typeof StaffParticipationForm>

export const Default: Story = {}

export const MutationError: Story = {
  args: {
    mutation: Object.assign(async () => ({ participation: null }), {
      ...idle,
      error: new Error('Participation could not be created.'),
    }),
  },
}
