// Registration form stories — supports both `register` (user + organization)
// and `join` (invited member, user only) modes. Like LoginForm, the component
// receives an `AnyAction` prop, so stories construct mock Actions with
// controllable `isPending`/`error` state.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { AnyAction } from '#/components/hooks/use-action'
import { RegisterForm } from './register-form'

function makeAction(
  impl: (...args: never[]) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): AnyAction {
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  }) as AnyAction
}

const meta: Meta<typeof RegisterForm> = {
  title: 'Identity/RegisterForm',
  component: RegisterForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof RegisterForm>

const resolvingAction = makeAction(async () => ({ ok: true }))

export const RegisterIdle: Story = {
  name: 'Register (idle)',
  args: { mode: 'register', mutation: resolvingAction },
}

export const JoinIdle: Story = {
  name: 'Join (idle)',
  args: { mode: 'join', mutation: resolvingAction },
}

export const Submitting: Story = {
  args: {
    mode: 'register',
    mutation: makeAction(() => new Promise<unknown>(() => {}), { isPending: true }),
  },
}

export const MutationError: Story = {
  args: {
    mode: 'register',
    mutation: makeAction(
      async () => {
        throw new Error('An account with that email already exists')
      },
      { error: new Error('An account with that email already exists') },
    ),
  },
}

// Empty submit → every required field surfaces its validation message.
export const ValidationError: Story = {
  args: { mode: 'register', mutation: resolvingAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /create account/i }))
    expect(await canvas.findByText(/name is required/i)).toBeInTheDocument()
    expect(
      await canvas.findByText(/a valid email address is required/i),
    ).toBeInTheDocument()
    expect(
      await canvas.findByText(/organization name must be at least 2 characters/i),
    ).toBeInTheDocument()
    expect(
      await canvas.findByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument()
  },
}

// Mismatched passwords → confirmPassword refinement error.
export const PasswordMismatch: Story = {
  args: { mode: 'register', mutation: resolvingAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/full name/i), 'Jane Doe')
    await userEvent.type(canvas.getByLabelText(/email/i), 'jane@example.com')
    await userEvent.type(canvas.getByLabelText(/organization name/i), 'Acme Co')
    await userEvent.type(canvas.getByLabelText(/^password$/i), 'password123')
    await userEvent.type(canvas.getByLabelText(/confirm password/i), 'password999')
    await userEvent.click(canvas.getByRole('button', { name: /create account/i }))
    expect(await canvas.findByText(/passwords do not match/i)).toBeInTheDocument()
  },
}

const submitSpy = fn()
export const Success: Story = {
  args: {
    mode: 'register',
    mutation: makeAction(async (...args: never[]) => {
      submitSpy(...args)
      return { ok: true }
    }),
  },
  play: async ({ canvasElement }) => {
    submitSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/full name/i), 'Jane Doe')
    await userEvent.type(canvas.getByLabelText(/email/i), 'jane@example.com')
    await userEvent.type(canvas.getByLabelText(/organization name/i), 'Acme Co')
    await userEvent.type(canvas.getByLabelText(/^password$/i), 'password123')
    await userEvent.type(canvas.getByLabelText(/confirm password/i), 'password123')
    await userEvent.click(canvas.getByRole('button', { name: /create account/i }))
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledTimes(1)
    })
    expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}
