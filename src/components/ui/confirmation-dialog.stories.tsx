// The confirmation shell with no domain around it. `tone` is the only thing
// that varies the look: neutral for an action the person can undo (archive,
// restore), destructive for one they cannot (remove, delete, disconnect, end).
// Dark is the default theme; the light variants render the same dialogs on the
// light surface. The Storybook Vitest project compiles no Tailwind, so the plays
// check which variant recipe the confirm carries, not a pixel; whether that
// recipe is readable is `token-contrast.test.ts`'s job, measured from the tokens.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor } from 'storybook/test'
import { Button } from './button'
import { openAlertDialog } from './confirmation-dialog.stories.open'
import { ConfirmationDialog } from './confirmation-dialog'

const meta: Meta<typeof ConfirmationDialog> = {
  title: 'Patterns/Confirmation dialog',
  component: ConfirmationDialog,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    trigger: <Button variant="outline">Open</Button>,
    title: 'Archive Harborline Suites?',
    description: 'Guests and new provider work will pause. You can restore it later.',
    cancelLabel: 'Keep active',
    confirmLabel: 'Archive',
    pendingLabel: 'Archiving…',
    pending: false,
    onConfirm: fn(),
  },
}
export default meta
type Story = StoryObj<typeof ConfirmationDialog>

const openDialog = (canvasElement: HTMLElement) => openAlertDialog(canvasElement, 'Open')

const destructiveArgs = {
  tone: 'destructive',
  title: 'Remove Harborline Suites from your workspace?',
  description: 'It leaves your property list. You can restore it for 30 days.',
  cancelLabel: 'Keep Property',
  confirmLabel: 'Remove Property',
  pendingLabel: 'Removing…',
} as const

/** A reversible action confirms in the primary colour. */
export const Neutral: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    const confirm = dialog.getByRole('button', { name: 'Archive' })
    expect(confirm.className).toContain('bg-primary')
    expect(confirm.className).not.toContain('bg-destructive')
    await userEvent.click(confirm)
    expect(args.onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}

/** An action that cannot be taken back confirms in the destructive colour. */
export const Destructive: Story = {
  args: destructiveArgs,
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    const confirm = dialog.getByRole('button', { name: 'Remove Property' })
    expect(confirm.className).toContain('bg-destructive')
    expect(confirm.className).not.toContain('bg-primary')
    await userEvent.click(confirm)
    expect(args.onConfirm).toHaveBeenCalledTimes(1)
  },
}

export const DestructiveLight: Story = {
  args: destructiveArgs,
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    expect(dialog.getByRole('button', { name: 'Remove Property' }).className).toContain(
      'bg-destructive',
    )
  },
}

export const NeutralLight: Story = {
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    expect(dialog.getByRole('button', { name: 'Archive' })).toBeEnabled()
  },
}

/** Cancel leaves everything as it was: the action never runs. */
export const Cancel: Story = {
  args: destructiveArgs,
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Keep Property' }))
    await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

/** While the action is running the confirm says so and cannot be pressed again. */
export const Pending: Story = {
  args: { ...destructiveArgs, pending: true },
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    expect(dialog.getByRole('button', { name: 'Removing…' })).toBeDisabled()
  },
}

/** Extra content (a required note) can hold the confirm back until it is valid. */
export const ConfirmDisabled: Story = {
  args: { confirmDisabled: true },
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    const confirm = dialog.getByRole('button', { name: 'Archive' })
    expect(confirm).toBeDisabled()
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

function Controlled(props: React.ComponentProps<typeof ConfirmationDialog>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open
      </Button>
      <ConfirmationDialog
        {...props}
        trigger={undefined}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

/**
 * With no trigger the caller owns `open`: how a menu item asks, since a dialog
 * inside a menu would unmount with it. Cancel closes it again.
 */
export const OpenedByTheCaller: Story = {
  render: (args) => <Controlled {...args} />,
  args: destructiveArgs,
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Keep Property' }))
    await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(args.onConfirm).not.toHaveBeenCalled()
    const reopened = await openDialog(canvasElement)
    await userEvent.click(reopened.getByRole('button', { name: 'Remove Property' }))
    expect(args.onConfirm).toHaveBeenCalledTimes(1)
  },
}
