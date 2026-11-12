// The dialog primitive, with the four things it decides so no caller spells them:
// a width (`size`), a height bound that scrolls, a close control that is a Button
// named "Close", and the refusal to be dismissed while a request is in flight.
// A footer takes its note beside the actions, and Cancel is one outline Button.
// Dark is the default theme; the light variants draw the same dialogs on the
// light surface. The plays measure the rendered dialog and its pinned footer.
import { playInThemes } from '../../../.storybook/play-in-themes'
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
  await Promise.all(
    dialog
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)),
  )
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

const WIDTH_PX: Readonly<Record<DialogSize, number>> = {
  sm: 384,
  md: 512,
  lg: 672,
  xl: 896,
}

function sizeStory(size: DialogSize, theme?: 'light'): Story {
  return {
    render: () => <Demo size={size} />,
    parameters: theme ? { theme } : {},
    play: async ({ canvasElement }) => {
      const { dialog } = await open(canvasElement)
      expect(dialog).toHaveAttribute('data-size', size)
      expect(dialog.getBoundingClientRect().width).toBeCloseTo(
        Math.min(WIDTH_PX[size], window.innerWidth - 32),
        0,
      )
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
 * The footer is pinned to the bottom of that box, so Cancel and the primary action
 * are on screen while the body scrolls under them.
 */
export const TallContentScrolls: Story = {
  render: () => <Demo tall />,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    expect(dialog.getBoundingClientRect().height).toBeLessThanOrEqual(
      window.innerHeight - 32,
    )
    expect(dialog.scrollHeight).toBeGreaterThan(dialog.clientHeight)
    expect(getComputedStyle(dialog).overflowY).toBe('auto')
    const footer = within(dialog)
      .getByRole('button', { name: 'Save name' })
      .closest('[data-slot=dialog-footer]')
    const footerTop = footer!.getBoundingClientRect().top
    dialog.scrollTop = dialog.scrollHeight
    expect(footer!.getBoundingClientRect().top).toBeCloseTo(footerTop, 0)
    expect(footer!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      dialog.getBoundingClientRect().bottom,
    )
    // Hit testing skips the pointer-events:none fade. At the same stack level,
    // positioned controls paint after ::before, keeping their focus rings above it.
    const fade = getComputedStyle(footer as HTMLElement, '::before')
    expect(fade.position).toBe('absolute')
    expect(fade.zIndex).toBe('auto')
    for (const button of within(footer as HTMLElement).getAllByRole('button')) {
      const style = getComputedStyle(button)
      expect(style.position).toBe('relative')
      expect(style.zIndex).toBe('auto')
      const box = button.getBoundingClientRect()
      expect(
        document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
      ).toBe(button)
    }
    dialog.scrollTop = 0
  },
}

/** A footer with a note is pinned the same way. */
export const TallContentWithANoteKeepsTheFooter: Story = {
  render: () => <Demo tall note="Nothing is public until you publish." />,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    const note = within(dialog).getByText('Nothing is public until you publish.')
    const top = note.getBoundingClientRect().top
    dialog.scrollTop = dialog.scrollHeight
    expect(note.getBoundingClientRect().top).toBeCloseTo(top, 0)
    dialog.scrollTop = 0
  },
}

/**
 * The corner close sits over the title's last column, so the title leaves it room,
 * wider below `md` where the close is a tap target. That holds when the header is
 * not a direct child of the content (a form's first child, as in the Goal
 * dialogs), and does not when the corner close is dropped. The header reads from
 * the start at every width, like the body and footer under it.
 */
export const TitleLeavesRoomForTheCloseInAForm: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open</Button>
      </DialogTrigger>
      <DialogContent>
        <form className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              Change the monthly target for every portal in this group
            </DialogTitle>
            <DialogDescription>Changes apply from Nov 1.</DialogDescription>
          </DialogHeader>
        </form>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    const title = within(dialog).getByRole('heading')
    const close = within(dialog).getByRole('button', { name: 'Close' })
    const text = document.createRange()
    text.selectNodeContents(title)
    expect(text.getBoundingClientRect().right).toBeLessThanOrEqual(
      close.getBoundingClientRect().left,
    )
    expect(getComputedStyle(title.parentElement!).textAlign).toBe('start')
  },
}

export const TitleKeepsItsWidthWithoutTheCorner: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Rename group</DialogTitle>
          <DialogDescription>Only your team sees the name.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogCancel />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    const title = within(dialog).getByRole('heading')
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull()
    expect(getComputedStyle(title).paddingInlineEnd).toBe('0px')
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
  play: playInThemes(async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(dialog).toBeVisible()
  }),
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
  play: playInThemes(async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save name' }))
    await within(dialog).findByText('That name is taken.')
    expect(within(dialog).getAllByRole('alert')).toHaveLength(1)
    expect(within(dialog).queryByText('An earlier refusal')).not.toBeInTheDocument()
  }),
}
