// The confirmation shell with no domain around it. `tone` is the only thing
// that varies the look: neutral for an action the person can undo (archive,
// restore), destructive for one they cannot (remove, delete, disconnect, end).
// The plays also pin the pending contract: the dialog stays open and busy while
// the action runs, refuses Escape, closes when it resolves, and says a refusal
// once, in place, which a reopened dialog does not repeat.
// Dark is the default theme; the light variants render the same dialogs on the
// light surface. The Storybook Vitest project compiles no Tailwind, so the plays
// check which variant recipe the confirm carries, not a pixel; whether that
// recipe is readable is `token-contrast.test.ts`'s job, measured from the tokens.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Button } from './button'
import { openAlertDialog } from './confirmation-dialog.stories.open'
import { ConfirmationDialog, ConfirmationTrigger } from './confirmation-dialog'
import { Input } from './input'

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
    onConfirm: fn(async () => undefined),
  },
}
export default meta
type Story = StoryObj<typeof ConfirmationDialog>

const openDialog = (canvasElement: HTMLElement) => openAlertDialog(canvasElement, 'Open')

/** Presses the cancel and waits for the dialog to go. */
async function keepProperty(dialog: ReturnType<typeof within>) {
  await userEvent.click(dialog.getByRole('button', { name: 'Keep property' }))
  await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
}

const destructiveArgs = {
  tone: 'destructive',
  title: 'Remove Harborline Suites from your workspace?',
  description: 'It leaves your property list. You can restore it for 30 days.',
  cancelLabel: 'Keep property',
  confirmLabel: 'Remove property',
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
    // It closes when the action has resolved, not when the button was pressed.
    await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}

/** An action that cannot be taken back confirms in the destructive colour. */
export const Destructive: Story = {
  args: destructiveArgs,
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    const confirm = dialog.getByRole('button', { name: 'Remove property' })
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
    expect(dialog.getByRole('button', { name: 'Remove property' }).className).toContain(
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
    await keepProperty(dialog)
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

/** The action in flight, released by the play when it has seen what it came for. */
let releaseSlow: () => void = () => undefined
const slowAction = fn(
  () =>
    new Promise<void>((resolve) => {
      releaseSlow = resolve
    }),
)

/**
 * While the action runs the dialog stays open and busy: the confirm is a pending
 * Button, Cancel is held back, and Escape is refused. It closes when the action
 * resolves.
 */
export const Pending: Story = {
  args: { ...destructiveArgs, onConfirm: slowAction },
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Remove property' }))
    const confirm = await dialog.findByRole('button', { name: 'Removing…' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(dialog.getByRole('button', { name: 'Keep property' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(dialog.getByRole('alertdialog')).toBeVisible()
    releaseSlow()
    await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}

export const PendingLight: Story = {
  ...Pending,
  parameters: { theme: 'light' },
}

const refusal = () => {
  throw new Error('This Property is being restored by someone else.')
}

/**
 * A refusal keeps the dialog open and says so once, in a banner above the
 * actions; the confirm is live again for a second try, and has focus again (it was
 * disabled while it ran, which dropped focus to the page).
 */
export const Refused: Story = {
  args: { ...destructiveArgs, onConfirm: fn(async () => refusal()) },
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Remove property' }))
    await dialog.findByText('Unable to complete this action')
    expect(dialog.getAllByRole('alert')).toHaveLength(1)
    expect(dialog.getByRole('alertdialog')).toBeVisible()
    const confirm = dialog.getByRole('button', { name: 'Remove property' })
    expect(confirm).toBeEnabled()
    await waitFor(() => expect(confirm).toHaveFocus())
    await userEvent.click(confirm)
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledTimes(2))
    expect(dialog.getAllByRole('alert')).toHaveLength(1)
  },
}

export const RefusedLight: Story = {
  ...Refused,
  parameters: { theme: 'light' },
}

/** Cancelling after a refusal and asking again starts clean: no old error. */
export const ReopenedWithoutTheOldError: Story = {
  args: { ...destructiveArgs, onConfirm: fn(async () => refusal()) },
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Remove property' }))
    await dialog.findByText('Unable to complete this action')
    await keepProperty(dialog)
    const reopened = await openDialog(canvasElement)
    expect(reopened.queryByRole('alert')).not.toBeInTheDocument()
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

function WithNote(props: React.ComponentProps<typeof ConfirmationDialog>) {
  const [note, setNote] = useState('')
  return (
    <ConfirmationDialog {...props} confirmDisabled={note.trim().length < 3}>
      <Input
        aria-label="Archive note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </ConfirmationDialog>
  )
}

/** A field in the body: the confirm waits for it, and Enter in it confirms. */
export const WithAField: Story = {
  render: (args) => <WithNote {...args} />,
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)
    expect(dialog.getByRole('button', { name: 'Archive' })).toBeDisabled()
    await userEvent.type(dialog.getByLabelText('Archive note'), 'Closed for works{Enter}')
    expect(args.onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}

/**
 * A confirmation that hosts fields (Replace code, Stop all codes, an archive
 * note) is the viewport less a rem on each side and scrolls inside it, so on a
 * short phone or with the soft keyboard open the confirm is still reachable.
 */
export const TallBodyScrolls: Story = {
  render: (args) => (
    <ConfirmationDialog {...args}>
      {Array.from({ length: 12 }, (_, index) => (
        <Input key={index} aria-label={`Field ${index + 1}`} />
      ))}
    </ConfirmationDialog>
  ),
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)
    const content = dialog.getByRole('alertdialog')
    expect(content.className).toContain('max-h-[calc(100dvh-2rem)]')
    expect(content.className).toContain('overflow-y-auto')
    expect(dialog.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  },
}

/** The trigger follows the tone: destructive for a destructive confirm, outline otherwise. */
export const TriggersFollowTheTone: Story = {
  render: () => (
    <div className="flex gap-3">
      <ConfirmationTrigger tone="neutral">Archive</ConfirmationTrigger>
      <ConfirmationTrigger tone="destructive">Remove</ConfirmationTrigger>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Remove' }).className).toContain(
      'bg-destructive',
    )
    expect(canvas.getByRole('button', { name: 'Archive' }).className).not.toContain(
      'bg-destructive',
    )
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
    await keepProperty(dialog)
    expect(args.onConfirm).not.toHaveBeenCalled()
    const reopened = await openDialog(canvasElement)
    await userEvent.click(reopened.getByRole('button', { name: 'Remove property' }))
    expect(args.onConfirm).toHaveBeenCalledTimes(1)
  },
}
