// Profile settings form stories. The component receives two `Action` props
// (`updateProfile`, `updateUserImage`) plus two plain async fn props for the
// presigned avatar upload flow. Stories construct mock Actions for the
// reactive props and plain async fns for the upload helpers.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import { ProfileSettingsForm } from './profile-settings-form'

type NameInput = { data: { name: string } }
type ImageInput = { data: { imageUrl: string } }

function makeAction<TInput>(
  impl: (input: TInput) => Promise<unknown>,
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<TInput, unknown> {
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  }) as Action<TInput, unknown>
}

const user = { name: 'Jane Doe', email: 'jane@example.com', image: null }

const meta: Meta<typeof ProfileSettingsForm> = {
  title: 'Identity/ProfileSettingsForm',
  component: ProfileSettingsForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof ProfileSettingsForm>

const resolvingName = makeAction<NameInput>(async () => ({ ok: true }))
const resolvingImage = makeAction<ImageInput>(async () => ({ ok: true }))

const noopRequestUpload = async () => ({
  uploadUrl: 'https://upload.example.com/presigned',
  key: 'avatar-1',
})
const noopFinalizeUpload = async () => ({
  avatarUrl: 'https://cdn.example.com/avatar-1.png',
})

export const Idle: Story = {
  args: {
    user,
    updateProfile: resolvingName,
    updateUserImage: resolvingImage,
    requestAvatarUpload: noopRequestUpload,
    finalizeAvatarUpload: noopFinalizeUpload,
  },
}

// Save in flight — submit button shows spinner + is disabled.
export const Submitting: Story = {
  args: {
    ...Idle.args,
    updateProfile: makeAction<NameInput>(() => new Promise<unknown>(() => {}), {
      isPending: true,
    }),
  },
}

// Server rejects the profile save.
export const MutationError: Story = {
  args: {
    ...Idle.args,
    updateProfile: makeAction<NameInput>(
      async () => {
        throw new Error('Name contains invalid characters')
      },
      { error: new Error('Name contains invalid characters') },
    ),
  },
}

// Clear the name and submit → schema surfaces "Name is required".
export const ValidationError: Story = {
  args: {
    ...Idle.args,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.clear(canvas.getByLabelText(/name/i))
    await userEvent.click(canvas.getByRole('button', { name: /save changes/i }))
    expect(await canvas.findByText(/name is required/i)).toBeInTheDocument()
  },
}

const submitSpy = fn()
export const Success: Story = {
  args: {
    ...Idle.args,
    updateProfile: makeAction<NameInput>(async (input) => {
      submitSpy(input)
      return { ok: true }
    }),
  },
  play: async ({ canvasElement }) => {
    submitSpy.mockClear()
    const canvas = within(canvasElement)
    const nameField = canvas.getByLabelText(/name/i)
    await userEvent.clear(nameField)
    await userEvent.type(nameField, 'Jane Smith')
    await userEvent.click(canvas.getByRole('button', { name: /save changes/i }))
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith({ data: { name: 'Jane Smith' } })
    })
    expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}
