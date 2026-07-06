// Remove member dialog stories.
// The AlertDialog is trigger-driven (manages its own open state); its content
// portals to document.body, so confirm-state assertions query the document
// rather than the story canvas.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
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

// Closed: only the outline "Remove" trigger is rendered.
export const Closed: Story = {
  args: { ...member, onRemove: fn(), isPending: false },
}

// Open the dialog, then confirm removal fires the onRemove callback.
const removeSpy = fn()
export const ConfirmRemoval: Story = {
  args: { ...member, onRemove: removeSpy, isPending: false },
  play: async ({ canvasElement }) => {
    removeSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^remove$/i }))
    const dialog = await within(document.body).findByRole('alertdialog', {
      name: /remove jane doe/i,
    })
    await userEvent.click(within(dialog).getByRole('button', { name: /remove member/i }))
    expect(removeSpy).toHaveBeenCalledTimes(1)
  },
}

// Removal in flight: the confirm action is disabled + relabelled "Removing…".
export const Removing: Story = {
  args: { ...member, onRemove: fn(), isPending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^remove$/i }))
    const confirm = await within(document.body).findByRole('button', {
      name: /removing/i,
    })
    expect(confirm).toBeDisabled()
  },
}
