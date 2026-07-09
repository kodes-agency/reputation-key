// Invite member form stories.
// The form receives a mutation `Action` prop (the reactive wrapper returned by
// `useAction`), so stories build mock Actions directly with controllable
// `isPending`/`error`/`isSuccess` — the type-correct way to reach every state
// without a live server. Rendered inside the authed memory router
// (AccountAdmin) per the member-directory convention.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { AnyAction } from '#/components/hooks/use-action'
import type { Role } from '#/shared/domain/roles'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { InviteMemberForm } from './invite-member-form'

type InviteInput = { data: { email: string; role: Role; propertyIds: string[] } }

function makeAction(
  impl: (input: InviteInput) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): AnyAction {
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

const allowedRoles: ReadonlyArray<Role> = ['AccountAdmin', 'PropertyManager', 'Staff']
const properties = [
  { id: 'prop-1', name: 'Sunset Apartments' },
  { id: 'prop-2', name: 'Harbor View' },
]

const meta: Meta<typeof InviteMemberForm> = {
  title: 'Identity/MemberDirectory/InviteMemberForm',
  component: InviteMemberForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof InviteMemberForm>

const resolvingAction = makeAction(async () => ({ ok: true }))

export const Idle: Story = {
  args: { mutation: resolvingAction, allowedRoles, properties },
}

// Pending mutation: submit button shows the spinner + is disabled.
export const Submitting: Story = {
  args: {
    mutation: makeAction(() => new Promise<unknown>(() => {}), { isPending: true }),
    allowedRoles,
    properties,
  },
}

// Server-rejected invitation — top-level banner surfaces the message.
export const MutationError: Story = {
  args: {
    mutation: makeAction(
      async () => {
        throw new Error('That email is already invited')
      },
      { error: new Error('That email is already invited') },
    ),
    allowedRoles,
    properties,
  },
}

// Submit an empty form → Zod schema marks the email field touched + invalid.
export const ValidationError: Story = {
  args: { mutation: resolvingAction, allowedRoles, properties },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
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
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/email address/i), 'teammate@example.com')
    await userEvent.click(canvas.getByRole('button', { name: /send invitation/i }))
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledTimes(1)
    })
    // role defaults to the first allowed role; propertyIds defaults to [].
    expect(submitSpy).toHaveBeenCalledWith({
      data: {
        email: 'teammate@example.com',
        role: 'AccountAdmin',
        propertyIds: [],
      },
    })
    // No field-level validation alerts render once the form is valid.
    expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}
