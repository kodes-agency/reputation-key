// Login form stories.
// The form receives an `Action` prop (the reactive wrapper returned by
// `useAction(serverFn)`) — NOT a raw server fn. So stories build mock Actions
// directly with controllable `isPending`/`error`/`isSuccess`, which is the
// type-correct way to reach every state without a live server.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { LoginForm } from './login-form'

type LoginInput = { data: { email: string; password: string } }

function makeAction(
  impl: (input: LoginInput) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<LoginInput, unknown> {
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

const meta: Meta<typeof LoginForm> = {
  title: 'Identity/LoginForm',
  component: LoginForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof LoginForm>

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

// Server-rejected sign-in — top-level banner surfaces the message.
export const MutationError: Story = {
  args: {
    mutation: makeAction(
      async () => {
        throw new Error('Invalid email or password')
      },
      { error: new Error('Invalid email or password') },
    ),
  },
}

// Submit an empty form → Zod schema marks each field touched + invalid.
export const ValidationError: Story = {
  args: { mutation: resolvingAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }))
    expect(
      await canvas.findByText(/a valid email address is required/i),
    ).toBeInTheDocument()
    expect(await canvas.findByText(/password is required/i)).toBeInTheDocument()
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
    await userEvent.type(canvas.getByLabelText(/email/i), 'user@example.com')
    await userEvent.type(canvas.getByLabelText(/password/i), 'correct-horse-battery')
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith({
        data: { email: 'user@example.com', password: 'correct-horse-battery' },
      })
    })
    // No field-level validation alerts render once the form is valid.
    expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}
