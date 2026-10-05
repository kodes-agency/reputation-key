// Profile settings form stories. The component receives three `Action` props
// (`updateProfile`, `updateUserImage`, `removeUserImage`) plus two plain async fn props
// for the presigned avatar upload flow. Stories construct mock Actions for the
// reactive props and plain async fns for the upload helpers.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ToasterDecorator } from '../../../../.storybook/ToasterDecorator'
import type { Action } from '#/components/hooks/use-action'
import { ProfileSettingsForm } from './profile-settings-form'

type NameInput = { data: { name: string } }
type ImageInput = { data: { imageUrl: string } }
type RemoveImageInput = { data: { imageUrl: null } }

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
  // The form fills the width the page gives it, so the story gives it a column to fill
  // (`centered` shrinks its Cards to their content).
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof ProfileSettingsForm>

const resolvingName = makeAction<NameInput>(async () => ({ ok: true }))
const resolvingImage = makeAction<ImageInput>(async () => ({ ok: true }))
const resolvingRemoval = makeAction<RemoveImageInput>(async () => ({ ok: true }))

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
    removeUserImage: resolvingRemoval,
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

// The group has no Cancel to another page: Reset puts the saved name back, and only
// shows once the name has been edited.
export const ResetRestoresTheSavedName: Story = {
  args: { ...Idle.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('link', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
    const nameField = canvas.getByLabelText(/^name$/i)
    await userEvent.type(nameField, ' Smith')
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))
    expect(nameField).toHaveValue('Jane Doe')
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument(),
    )
    // Save is last in the row, in the card with the fields.
    const save = canvas.getByRole('button', { name: /save changes/i })
    expect(save.closest('[data-slot="form-actions"]')).not.toBeNull()
    expect(save.closest('[data-slot="card"]')).toContainElement(nameField)
  },
}

// A 1x1 PNG: renders with no network.
const PICTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Remove is saved, not only drawn: it is the same server call with no image, so the
// avatar is still gone after a reload (it used to clear the page's copy and nothing else).
const removalSpy = fn()
export const RemovingTheAvatarIsSaved: Story = {
  args: {
    ...Idle.args,
    user: { ...user, image: PICTURE },
    removeUserImage: makeAction<RemoveImageInput>(async (input) => {
      removalSpy(input)
      return { ok: true }
    }),
  },
  play: async ({ canvasElement }) => {
    removalSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remove avatar' }))
    await waitFor(() => {
      expect(removalSpy).toHaveBeenCalledWith({ data: { imageUrl: null } })
    })
    expect(await canvas.findByRole('button', { name: 'Upload avatar' })).toBeVisible()
  },
}

// A refused removal leaves the avatar where it was; the setting says so in a toast.
export const RemovingTheAvatarRefused: Story = {
  args: {
    ...Idle.args,
    user: { ...user, image: PICTURE },
    removeUserImage: makeAction<RemoveImageInput>(async () => {
      throw new Error('connection reset')
    }),
  },
  decorators: [ToasterDecorator],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remove avatar' }))
    expect(
      await within(document.body).findByText("Couldn't remove that avatar. Try again."),
    ).toBeInTheDocument()
    expect(canvas.getByRole('img', { name: 'Current avatar' })).toBeInTheDocument()
  },
}

// The email is a fact the person reads, not a disabled field they might try to edit.
export const EmailIsReadOnlyText: Story = {
  args: { ...Idle.args },
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('textbox', { name: /email/i })).not.toBeInTheDocument()
    expect(canvas.getByText('jane@example.com').closest('dd')).not.toBeNull()
  },
}
