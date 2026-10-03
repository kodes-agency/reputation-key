// The dialog primitive, with the four things it decides so no caller spells them:
// a width (`size`), a height bound that scrolls, a close control that is a Button
// named "Close", and the refusal to be dismissed while a request is in flight.
// A footer takes its note beside the actions, and Cancel is one outline Button.
// Dark is the default theme; the light variants draw the same dialogs on the
// light surface. The Storybook Vitest project compiles no Tailwind, so the plays
// read which recipe an element carries rather than a measured width.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { useRefusingAction } from '#/components/forms/refusing-action.stories.fixtures'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { Button } from './button'
import {
  Dialog,
  DialogCancel,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogSize,
} from './dialog'
import { useDialogBusy } from './dialog-dismissal'

const meta: Meta = {
  title: 'Patterns/Dialog',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj

const bodyOf = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

async function open(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open' }))
  const dialog = await bodyOf(canvasElement).findByRole('dialog')
  await waitFor(() => expect(dialog).toBeVisible())
  return { dialog, page: bodyOf(canvasElement) }
}

function Demo({
  size,
  busy,
  note,
  tall,
}: Readonly<{
  size?: DialogSize
  busy?: boolean
  note?: string
  tall?: boolean
}>) {
  return (
    <Dialog busy={busy}>
      <DialogTrigger asChild>
        <Button variant="outline">Open</Button>
      </DialogTrigger>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>Rename group</DialogTitle>
          <DialogDescription>Only your team sees the name.</DialogDescription>
        </DialogHeader>
        {tall
          ? Array.from({ length: 40 }, (_, line) => (
              <p key={line} className="text-sm">
                Line {line + 1}
              </p>
            ))
          : null}
        <DialogFooter note={note}>
          <DialogCancel />
          <Button type="button">Save name</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const WIDTH_CLASS: Readonly<Record<DialogSize, string>> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
}

function sizeStory(size: DialogSize, theme?: 'light'): Story {
  return {
    render: () => <Demo size={size} />,
    parameters: theme ? { theme } : {},
    play: async ({ canvasElement }) => {
      const { dialog } = await open(canvasElement)
      expect(dialog).toHaveAttribute('data-size', size)
      expect(dialog.className).toContain(WIDTH_CLASS[size])
    },
  }
}

/** Short lists and one-line questions. */
export const Small: Story = sizeStory('sm')
/** The default: a form of a few fields. */
export const Medium: Story = sizeStory('md')
/** A form with a column of choices. */
export const Large: Story = sizeStory('lg')
/** A form beside its preview. */
export const ExtraLarge: Story = sizeStory('xl')
export const MediumLight: Story = sizeStory('md', 'light')

/**
 * Whatever the content, the dialog is the viewport less a rem on each side, in
 * `dvh` so a phone's address bar does not hide the footer, and scrolls inside it.
 */
export const TallContentScrolls: Story = {
  render: () => <Demo tall />,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]')
    expect(dialog.className).toContain('overflow-y-auto')
  },
}

/** The corner close is a Button with the one name every close wears. */
export const CloseIsAButton: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const { dialog, page } = await open(canvasElement)
    const close = within(dialog).getByRole('button', { name: 'Close' })
    expect(close).toHaveAttribute('data-slot', 'dialog-close')
    expect(close).toHaveAttribute('data-size', 'icon-sm')
    await userEvent.click(close)
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

/** Cancel is the outline Button, and closes the dialog. */
export const CancelCloses: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const { dialog, page } = await open(canvasElement)
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveAttribute('data-variant', 'outline')
    await userEvent.click(cancel)
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

/** A note sits at the start of the footer, the actions at the end. */
export const FooterWithANote: Story = {
  render: () => <Demo note="Nothing is public until you publish." />,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    const note = within(dialog).getByText('Nothing is public until you publish.')
    expect(note.closest('[data-slot=dialog-footer-note]')).not.toBeNull()
    const footer = note.closest('[data-slot=dialog-footer]')
    expect(footer?.lastElementChild).toContainElement(
      within(dialog).getByRole('button', { name: 'Save name' }),
    )
  },
}

/**
 * Busy: Escape and the close button are refused until the request settles, and
 * Cancel is held back with them.
 */
export const BusyCannotBeDismissed: Story = {
  render: () => <Demo busy />,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(dialog).toBeVisible()
  },
}

export const BusyCannotBeDismissedLight: Story = {
  ...BusyCannotBeDismissed,
  parameters: { theme: 'light' },
}

function Saving() {
  const [saving, setSaving] = useState(false)
  useDialogBusy(saving)
  return (
    <DialogFooter>
      <DialogCancel />
      <Button type="button" onClick={() => setSaving((now) => !now)}>
        {saving ? 'Finish' : 'Start saving'}
      </Button>
    </DialogFooter>
  )
}

/** A body that owns the request holds the dialog with `useDialogBusy`, and lets go. */
export const ABodyHoldsTheDialog: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send report</DialogTitle>
          <DialogDescription>Describe what happened.</DialogDescription>
        </DialogHeader>
        <Saving />
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    const { dialog, page } = await open(canvasElement)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start saving' }))
    await waitFor(() => expect(dialog).toHaveAttribute('aria-busy', 'true'))
    await userEvent.keyboard('{Escape}')
    expect(dialog).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Finish' }))
    await waitFor(() => expect(dialog).not.toHaveAttribute('aria-busy'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

function Refusing() {
  // The mutation lives in the page, so it still holds the last refusal when the
  // dialog is opened again.
  const mutation = useRefusingAction(
    () => new ServerFunctionError('GroupError', 'That name is taken.', 'name_taken', 409),
    new Error('An earlier refusal'),
  )
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename group</DialogTitle>
          <DialogDescription>Only your team sees the name.</DialogDescription>
        </DialogHeader>
        <DialogErrorBanner error={mutation.error} />
        <DialogFooter>
          <DialogCancel />
          <Button
            type="button"
            onClick={() => void mutation(undefined as never).catch(() => undefined)}
          >
            Save name
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A refusal is shown above the footer once the attempt is made. The one the
 * mutation held from the last time the dialog was open is not.
 */
export const ARefusalShowsOnlyOnceTried: Story = {
  render: () => <Refusing />,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save name' }))
    await within(dialog).findByText('That name is taken.')
    expect(within(dialog).getAllByRole('alert')).toHaveLength(1)
    expect(within(dialog).queryByText('An earlier refusal')).not.toBeInTheDocument()
  },
}

export const ARefusalShowsOnlyOnceTriedLight: Story = {
  ...ARefusalShowsOnlyOnceTried,
  parameters: { theme: 'light' },
}
