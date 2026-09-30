// Login form stories.
// The sign-in `mutation` is an `Action` prop (the reactive wrapper returned by
// `useAction(serverFn)`) — NOT a raw server fn. So stories build mock Actions
// directly with controllable `isPending`/`error`/`isSuccess`, which is the
// type-correct way to reach every state without a live server. The resend is
// the opposite: a bare function, because the notice that calls it owns each
// resend's state.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useAction, type Action } from '#/components/hooks/use-action'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
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

type ResendInput = { data: { email: string } }
type ResendVerification = (input: ResendInput) => Promise<unknown>

const resendSpy = fn()

// What the route hands the form: the bare server function. The notice owns the
// pending/error/success state of each resend, so it starts clean per attempt.
const sendsALink: ResendVerification = async (input) => {
  resendSpy(input)
  return { sent: true }
}

const meta: Meta<typeof LoginForm> = {
  title: 'Identity/LoginForm',
  component: LoginForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { resendVerification: sendsALink },
}
export default meta
type Story = StoryObj<typeof LoginForm>

const resolvingAction = makeAction(async () => ({ ok: true }))

export const Idle: Story = {
  args: { mutation: resolvingAction },
  // Before hydration the browser submits this form natively; `method="post"`
  // keeps the password out of the URL, history, and request logs.
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('form')).toHaveAttribute('method', 'post')
  },
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

// Sign-in found the address unverified (the refusal only comes after the
// password checked out): the notice offers a new link instead of a bare error.
const unverifiedRefusal = new ServerFunctionError(
  'AuthError',
  'Verify your email before signing in.',
  'email_not_verified',
  403,
)

export const UnverifiedEmail: Story = {
  args: {
    mutation: makeAction(
      async () => {
        throw unverifiedRefusal
      },
      { error: unverifiedRefusal },
    ),
  },
  play: async ({ canvasElement }) => {
    resendSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/email/i), 'user@example.com')
    await userEvent.type(canvas.getByLabelText(/password/i), 'correct-horse-battery')
    await userEvent.click(canvas.getByRole('button', { name: /^sign in$/i }))

    await expect(await canvas.findByText('Verify your email first')).toBeInTheDocument()
    await expect(
      canvas.getByText(/until user@example\.com is verified/i),
    ).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Send a new link' }))
    await waitFor(() =>
      expect(resendSpy).toHaveBeenCalledWith({ data: { email: 'user@example.com' } }),
    )
  },
}

async function trySigningIn(canvas: ReturnType<typeof within>, email: string) {
  const emailField = canvas.getByLabelText(/email/i)
  await userEvent.clear(emailField)
  await userEvent.type(emailField, email)
  const password = canvas.getByLabelText(/password/i)
  await userEvent.clear(password)
  await userEvent.type(password, 'correct-horse-battery')
  await userEvent.click(canvas.getByRole('button', { name: /^sign in$/i }))
}

export const UnverifiedEmailLinkSent: Story = {
  args: {
    mutation: makeAction(async () => undefined, {
      error: unverifiedRefusal,
    }),
  },
  play: async ({ canvasElement }) => {
    resendSpy.mockClear()
    const canvas = within(canvasElement)
    await trySigningIn(canvas, 'user@example.com')
    await userEvent.click(await canvas.findByRole('button', { name: 'Send a new link' }))

    await expect(await canvas.findByRole('status')).toHaveTextContent(
      /a new link is on its way/i,
    )
    await expect(
      canvas.queryByRole('button', { name: 'Send a new link' }),
    ).not.toBeInTheDocument()
  },
}

export const UnverifiedEmailResendRefused: Story = {
  args: {
    mutation: makeAction(async () => undefined, { error: unverifiedRefusal }),
    resendVerification: async () => {
      throw new Error('Too many requests. Try again later.')
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await trySigningIn(canvas, 'user@example.com')
    await userEvent.click(await canvas.findByRole('button', { name: 'Send a new link' }))

    await expect(
      await canvas.findByText('Too many requests. Try again later.'),
    ).toBeInTheDocument()
    // Nothing was sent, so the way to try again stays.
    await expect(canvas.getByRole('button', { name: 'Send a new link' })).toBeEnabled()
  },
}

// The sign-in mutation keeps its own state across attempts, the way the route's
// does, and always finds the address unverified.
function RepeatedUnverifiedSignIn({
  resendVerification,
}: Readonly<{ resendVerification: ResendVerification }>) {
  const signIn = useAction(async (_input: LoginInput) => {
    throw unverifiedRefusal
  })
  return <LoginForm mutation={signIn} resendVerification={resendVerification} />
}

// A link sent for one address says nothing about the next address tried: the
// notice is about the attempt it was raised for, so the next attempt starts
// with the button back and nothing claimed as sent.
export const UnverifiedEmailAnotherAddress: Story = {
  render: () => <RepeatedUnverifiedSignIn resendVerification={sendsALink} />,
  play: async ({ canvasElement }) => {
    resendSpy.mockClear()
    const canvas = within(canvasElement)

    await trySigningIn(canvas, 'first@example.com')
    await userEvent.click(await canvas.findByRole('button', { name: 'Send a new link' }))
    await expect(await canvas.findByRole('status')).toHaveTextContent(
      /if first@example\.com still needs verifying/i,
    )

    await trySigningIn(canvas, 'second@example.com')
    await expect(
      await canvas.findByText(/until second@example\.com is verified/i),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('status')).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Send a new link' })).toBeEnabled()
    await expect(resendSpy).toHaveBeenCalledTimes(1)
    await expect(resendSpy).toHaveBeenCalledWith({ data: { email: 'first@example.com' } })
  },
}

// Same for a refusal: the rate-limit message belongs to the address it was
// raised for, not the one typed next.
export const UnverifiedEmailAnotherAddressAfterRefusal: Story = {
  render: () => (
    <RepeatedUnverifiedSignIn
      resendVerification={async () => {
        throw new Error('Too many requests. Try again later.')
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await trySigningIn(canvas, 'first@example.com')
    await userEvent.click(await canvas.findByRole('button', { name: 'Send a new link' }))
    await expect(
      await canvas.findByText('Too many requests. Try again later.'),
    ).toBeInTheDocument()

    await trySigningIn(canvas, 'second@example.com')
    await expect(
      await canvas.findByText(/until second@example\.com is verified/i),
    ).toBeInTheDocument()
    await expect(
      canvas.queryByText('Too many requests. Try again later.'),
    ).not.toBeInTheDocument()
  },
}
