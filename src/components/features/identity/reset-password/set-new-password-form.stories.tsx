import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { SetNewPasswordForm } from './set-new-password-form'

type SetNewPasswordInput = {
  newPassword: string
  confirmPassword: string
}

function makeAction(
  impl: (input: SetNewPasswordInput) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<SetNewPasswordInput> {
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

const resolvingAction = makeAction(async () => ({ ok: true }))

const meta = {
  title: 'Identity/ResetPassword/SetNewPasswordForm',
  component: SetNewPasswordForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [AuthedRouterDecorator],
} satisfies Meta<typeof SetNewPasswordForm>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {
  args: { mutation: resolvingAction },
}

export const Submitting: Story = {
  args: {
    mutation: makeAction(() => new Promise<unknown>(() => {}), { isPending: true }),
  },
}

export const MutationError: Story = {
  args: {
    mutation: makeAction(async () => undefined, {
      error: new Error('This reset link is invalid or expired.'),
    }),
  },
}

export const PasswordTooShort: Story = {
  args: { mutation: resolvingAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/^new password/i), 'short')
    await userEvent.type(canvas.getByLabelText(/^confirm password/i), 'short')
    await userEvent.click(canvas.getByRole('button', { name: /save new password/i }))
    expect(
      await canvas.findByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument()
  },
}

export const PasswordMismatch: Story = {
  args: { mutation: resolvingAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/^new password/i), 'correct-password')
    await userEvent.type(
      canvas.getByLabelText(/^confirm password/i),
      'different-password',
    )
    await userEvent.click(canvas.getByRole('button', { name: /save new password/i }))
    expect(await canvas.findByText(/passwords do not match/i)).toBeInTheDocument()
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
    await userEvent.type(canvas.getByLabelText(/^new password/i), 'new-password-123')
    await userEvent.type(canvas.getByLabelText(/^confirm password/i), 'new-password-123')
    await userEvent.click(canvas.getByRole('button', { name: /save new password/i }))
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith({
        newPassword: 'new-password-123',
        confirmPassword: 'new-password-123',
      })
    })
    expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}
