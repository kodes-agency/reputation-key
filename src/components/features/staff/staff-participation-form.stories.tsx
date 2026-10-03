import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { useRefusingAction } from '#/components/forms/refusing-action.stories.fixtures'
import type { CreateStaffParticipationMutationInput } from '#/components/features/staff/types'
import { inADialog } from '../../../../.storybook/InADialogDecorator'
import { StaffParticipationForm } from './staff-participation-form'

type CreateInput = { data: CreateStaffParticipationMutationInput }

const idle = { isPending: false, error: null, isSuccess: false, data: null }
const mutation: Action<CreateInput> = Object.assign(
  async () => ({ participation: { id: 'sp-new' } }),
  idle,
)

const meta: Meta<typeof StaffParticipationForm> = {
  title: 'Staff/StaffParticipationForm',
  component: StaffParticipationForm,
  tags: ['autodocs'],
  // The form is the body of the Add staff dialog, and its play reads the page.
  decorators: [inADialog('Add staff participation')],
  args: {
    propertyId: 'prop-1',
    mutation,
  },
}
export default meta
type Story = StoryObj<typeof StaffParticipationForm>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    expect(page.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(page.getByRole('button', { name: 'Add staff' })).toBeInTheDocument()
  },
}

function RefusedParticipation() {
  const refusing = useRefusingAction<CreateInput>(
    () => new Error('Participation could not be created.'),
    new Error('An earlier refusal'),
  )
  return <StaffParticipationForm propertyId="prop-1" mutation={refusing} />
}

/** A refusal shows once the attempt is made, and not the one left from before. */
export const MutationError: Story = {
  render: () => <RefusedParticipation />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    expect(page.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.type(page.getByLabelText('Name'), 'Alex Morgan')
    await userEvent.click(page.getByRole('button', { name: 'Add staff' }))
    await waitFor(() => expect(page.getAllByRole('alert')).toHaveLength(1))
  },
}
