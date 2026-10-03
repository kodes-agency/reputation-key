// Remove member dialog stories.
// The confirmation is trigger-driven (manages its own open state); its content
// portals to document.body, so confirm-state assertions query the document
// rather than the story canvas.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { RemoveMemberDialog } from './remove-member-dialog'

const meta: Meta<typeof RemoveMemberDialog> = {
  title: 'Identity/MemberDirectory/RemoveMemberDialog',
  component: RemoveMemberDialog,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof RemoveMemberDialog>

const member = { memberName: 'Jane Doe', memberEmail: 'jane@example.com' }

// Closed: only the destructive "Remove" trigger is rendered.
export const Closed: Story = {
  args: { ...member, onRemove: fn(async () => undefined) },
}

// Open the dialog, then confirm removal fires the onRemove callback.
const removeSpy = fn(async () => undefined)
export const ConfirmRemoval: Story = {
  args: { ...member, onRemove: removeSpy },
  play: async ({ canvasElement }) => {
    removeSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^remove$/i }))
    const dialog = await within(document.body).findByRole('alertdialog', {
      name: /remove jane doe/i,
    })
    await userEvent.click(within(dialog).getByRole('button', { name: /remove member/i }))
    expect(removeSpy).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(within(document.body).queryByRole('alertdialog')).toBeNull()
    })
  },
}

// Removal in flight: the confirm is a busy Button and Cancel is held back.
export const Removing: Story = {
  args: { ...member, onRemove: () => new Promise<void>(() => undefined) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^remove$/i }))
    const dialog = await within(document.body).findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /remove member/i }))
    const confirm = await within(dialog).findByRole('button', { name: /removing/i })
    expect(confirm).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  },
}

// A refusal stays in the dialog, once, and the dialog stays open.
export const Refused: Story = {
  args: {
    ...member,
    onRemove: async () => {
      throw new Error('The organization needs at least one Account Admin.')
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^remove$/i }))
    const dialog = await within(document.body).findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /remove member/i }))
    await within(dialog).findByText('Unable to complete this action')
    expect(within(dialog).getAllByRole('alert')).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: /remove member/i })).toBeEnabled()
  },
}
