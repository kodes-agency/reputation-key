// Security settings form stories — change-password card + a disabled 2FA card.
// The component receives a single `changePassword` Action prop; stories build
// mock Actions to cover idle / submitting / mutation-error. Success is visible:
// `onSubmit` calls `form.reset()`, so the password fields clear.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { SecuritySettingsForm } from './security-settings-form'

type PasswordInput = { data: { currentPassword: string; newPassword: string } }

function makeAction(
  impl: (input: PasswordInput) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<PasswordInput, unknown> {
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

const meta: Meta<typeof SecuritySettingsForm> = {
  title: 'Identity/SecuritySettingsForm',
  component: SecuritySettingsForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof SecuritySettingsForm>

const resolvingAction = makeAction(async () => ({ ok: true }))

export const Idle: Story = {
  args: { changePassword: resolvingAction },
}

export const Submitting: Story = {
  args: {
    changePassword: makeAction(() => new Promise<unknown>(() => {}), { isPending: true }),
  },
}

export const MutationError: Story = {
  args: {
    changePassword: makeAction(
      async () => {
        throw new Error('Current password is incorrect')
      },
      { error: new Error('Current password is incorrect') },
    ),
  },
}

export const ValidationError: Story = {
  args: { changePassword: resolvingAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /update password/i }))
    expect(await canvas.findByText(/current password is required/i)).toBeInTheDocument()
    expect(
      await canvas.findByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument()
    expect(await canvas.findByText(/please confirm your password/i)).toBeInTheDocument()
  },
}

// New + confirm mismatch → the schema refinement surfaces "Passwords do not match".
export const PasswordMismatch: Story = {
  args: { changePassword: resolvingAction },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/current password/i), 'oldpass123')
    await userEvent.type(canvas.getByLabelText(/^new password$/i), 'newpass123')
    await userEvent.type(canvas.getByLabelText(/confirm new password/i), 'differentpass')
    await userEvent.click(canvas.getByRole('button', { name: /update password/i }))
    expect(await canvas.findByText(/passwords do not match/i)).toBeInTheDocument()
  },
}

const submitSpy = fn()
export const Success: Story = {
  args: {
    changePassword: makeAction(async (input) => {
      submitSpy(input)
      return { ok: true }
    }),
  },
  play: async ({ canvasElement }) => {
    submitSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/current password/i), 'oldpass123')
    await userEvent.type(canvas.getByLabelText(/^new password$/i), 'newpass123')
    await userEvent.type(canvas.getByLabelText(/confirm new password/i), 'newpass123')
    await userEvent.click(canvas.getByRole('button', { name: /update password/i }))
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith({
        data: { currentPassword: 'oldpass123', newPassword: 'newpass123' },
      })
    })
    // onSuccess the component resets the form → password fields clear.
    await waitFor(() => {
      expect(canvas.getByLabelText(/current password/i)).toHaveValue('')
      expect(canvas.getByLabelText(/^new password$/i)).toHaveValue('')
    })
  },
}
