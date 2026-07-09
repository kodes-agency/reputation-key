// Reset password form stories.
// Unlike server-fn-backed forms, this one calls `mutation(value)` directly
// (no `{ data }` wrapper) because it wraps a client SDK call. Mock Actions
// cover every state without a live server.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { AnyAction } from '#/components/hooks/use-action'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { ResetPasswordForm } from './reset-password-form'

type ResetInput = { email: string }

function makeAction(
  impl: (input: ResetInput) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): AnyAction {
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

const meta: Meta<typeof ResetPasswordForm> = {
  title: 'Identity/ResetPassword/ResetPasswordForm',
  component: ResetPasswordForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof ResetPasswordForm>

const resolvingAction = makeAction(async () => ({ ok: true }))

export const Idle: Story = {
  args: { mutation: resolvingAction },
}

// Pending mutation: button shows the spinner + is disabled.
export const Submitting: Story = {
  args: {
    mutation: makeAction(() => new Promise<unknown>(() => {}), { isPending: true }),
  },
}

// Server/SDK-rejected request — top-level banner surfaces the message.
export const MutationError: Story = {
  args: {
    mutation: makeAction(
      async () => {
        throw new Error('No account found for that email')
      },
      { error: new Error('No account found for that email') },
    ),
  },
}

// Submit an empty form → Zod schema marks the email field invalid.
export const ValidationError: Story = {
  args: { mutation: resolvingAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /send reset link/i }))
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
  },
  play: async ({ canvasElement }) => {
    submitSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/^email/i), 'user@example.com')
    await userEvent.click(canvas.getByRole('button', { name: /send reset link/i }))
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith({ email: 'user@example.com' })
    })
    // No field-level validation alerts render once the form is valid.
    expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}
