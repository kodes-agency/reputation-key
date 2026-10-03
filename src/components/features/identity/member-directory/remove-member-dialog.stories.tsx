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

/** Opens the dialog from the row and presses its confirm. */
async function confirmRemoval(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^remove$/i }))
  const dialog = within(await within(document.body).findByRole('alertdialog'))
  await userEvent.click(dialog.getByRole('button', { name: /remove member/i }))
  return dialog
}

// Removal in flight: the confirm is a busy Button and Cancel is held back.
export const Removing: Story = {
  args: { ...member, onRemove: () => new Promise<void>(() => undefined) },
  play: async ({ canvasElement }) => {
    const dialog = await confirmRemoval(canvasElement)
    const confirm = await dialog.findByRole('button', { name: /removing/i })
    expect(confirm).toBeDisabled()
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
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
    const dialog = await confirmRemoval(canvasElement)
    await dialog.findByText('Unable to complete this action')
    expect(dialog.getAllByRole('alert')).toHaveLength(1)
    expect(dialog.getByRole('button', { name: /remove member/i })).toBeEnabled()
  },
}
