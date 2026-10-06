// Invite member form stories.
// The form receives a mutation `Action` prop (the reactive wrapper returned by
// `useAction`), so stories build mock Actions directly with controllable
// `isPending`/`error`/`isSuccess` — the type-correct way to reach every state
// without a live server. Rendered inside the authed memory router
// (AccountAdmin) per the member-directory convention.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { inADialog } from '../../../../../.storybook/InADialogDecorator'
import { useRefusingAction } from '#/components/forms/refusing-action.stories.fixtures'
import {
  mockAction,
  type MockActionState,
} from '../../../../../.storybook/mocks/mock-action'
import { InviteMemberForm } from './invite-member-form'

type InviteInput = {
  data: { email: string; role: BetaInteractiveRole; propertyIds: string[] }
}

const makeAction = (
  impl: (input: InviteInput) => Promise<unknown>,
  state?: MockActionState,
) => mockAction<InviteInput>(impl, state)

// The safe role first: an invitation starts as a Property Manager.
const allowedRoles: ReadonlyArray<BetaInteractiveRole> = [
  'PropertyManager',
  'AccountAdmin',
]
const properties = [
  { id: 'prop-1', name: 'Sunset Apartments' },
  { id: 'prop-2', name: 'Harbor View' },
]

const meta: Meta<typeof InviteMemberForm> = {
  title: 'Identity/MemberDirectory/InviteMemberForm',
  component: InviteMemberForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  // The form is the body of the Invite member dialog, and its play reads the page.
  decorators: [inADialog('Invite a new member'), AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof InviteMemberForm>

const resolvingAction = makeAction(async () => ({ ok: true }))

export const Idle: Story = {
  args: { mutation: resolvingAction, allowedRoles, properties },
}

// BQC-6.8: light-theme variant of the form — axe runs on it too (inputs,
// labels, and error text need a light-mode contrast proof).
export const IdleLight: Story = {
  args: { mutation: resolvingAction, allowedRoles, properties },
  parameters: { theme: 'light' },
}

// Pending mutation: submit button shows the spinner + is disabled.
export const Submitting: Story = {
  args: {
    mutation: makeAction(() => new Promise<unknown>(() => {}), { isPending: true }),
    allowedRoles,
    properties,
  },
}

// A server-rejected invitation: the banner above the actions surfaces the message
// once the attempt is made, and not before. A refusal an earlier open left on the
// mutation is already there when the form mounts.
function RefusedInvite() {
  const mutation = useRefusingAction<InviteInput>(
    () => new Error('That email is already invited'),
    new Error('An invitation to someone else was refused earlier'),
  )
  return (
    <InviteMemberForm
      mutation={mutation}
      allowedRoles={allowedRoles}
      properties={properties}
    />
  )
}

export const MutationError: Story = {
  render: () => <RefusedInvite />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    expect(page.queryByText(/refused earlier/i)).not.toBeInTheDocument()
    expect(page.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.type(page.getByLabelText(/email address/i), 'teammate@example.com')
    await userEvent.click(page.getByRole('button', { name: /send invitation/i }))
    await waitFor(() => expect(page.getAllByRole('alert')).toHaveLength(1))
    expect(page.queryByText(/refused earlier/i)).not.toBeInTheDocument()
    // The refusal sits in the form, with Cancel beside the primary.
    expect(page.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  },
}

// Submit an empty form → Zod schema marks the email field touched + invalid.
export const ValidationError: Story = {
  args: { mutation: resolvingAction, allowedRoles, properties },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: /send invitation/i }))
    expect(
      await canvas.findByText(/a valid email address is required/i),
    ).toBeInTheDocument()
  },
}

const submitSpy = fn()
export const Success: Story = {
  args: {
    mutation: makeAction(async (input) => {
      submitSpy(input)
      return { ok: true }
    }),
    allowedRoles,
    properties,
  },
  play: async ({ canvasElement }) => {
    submitSpy.mockClear()
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.type(canvas.getByLabelText(/email address/i), 'teammate@example.com')
    await userEvent.click(canvas.getByRole('button', { name: /send invitation/i }))
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledTimes(1)
    })
    // role defaults to Property Manager; propertyIds defaults to [].
    expect(submitSpy).toHaveBeenCalledWith({
      data: {
        email: 'teammate@example.com',
        role: 'PropertyManager',
        propertyIds: [],
      },
    })
    // No field-level validation alerts render once the form is valid.
    expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}

// The invitation starts as a Property Manager, with the property picker shown
// and a plain warning while no property is chosen.
export const DefaultsToPropertyManager: Story = {
  args: { mutation: resolvingAction, allowedRoles, properties },
  play: async ({ canvasElement }) => {
    // The form is in the dialog, which portals to the page.
    const canvas = within(canvasElement.ownerDocument.body)
    expect(canvas.getByRole('radio', { name: /property manager/i })).toBeChecked()
    expect(canvas.getByText('Properties they can work')).toBeInTheDocument()
    expect(canvas.getByText(/sign in to an empty app/i)).toBeInTheDocument()
  },
}

// Choosing Account Admin drops the property picker: an Account Admin reaches
// every property, and no grants are sent with the invitation.
const adminSubmitSpy = fn()
export const AccountAdminHidesTheProperties: Story = {
  args: {
    mutation: makeAction(async (input) => {
      adminSubmitSpy(input)
      return { ok: true }
    }),
    allowedRoles,
    properties,
  },
  play: async ({ canvasElement }) => {
    adminSubmitSpy.mockClear()
    // The form is in the dialog, which portals to the page.
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.type(canvas.getByLabelText(/email address/i), 'lead@example.com')
    await userEvent.click(canvas.getByRole('radio', { name: /account admin/i }))
    expect(canvas.queryByText('Properties they can work')).not.toBeInTheDocument()
    expect(
      canvas.getByText('Account Admins can access every property.'),
    ).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /send invitation/i }))
    await waitFor(() => {
      expect(adminSubmitSpy).toHaveBeenCalledWith({
        data: { email: 'lead@example.com', role: 'AccountAdmin', propertyIds: [] },
      })
    })
  },
}
