// The edit-and-republish editor for a reply that already reached Google.
//
// Its Review update trigger carries the same two a11y rules the thread
// message's Confirm & Publish does, and for the same reason: a natively
// `disabled` button leaves the tab order and takes its `aria-describedby` with
// it, and a paragraph that mounts with its content announces nothing as a live
// region. Between them they made the one sentence naming an unfilled template
// placeholder unreachable by every reader who needed it.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ReviewReplyPublishedEditor } from './reply-editor-views'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

const onSave = fn(async (_text: string) => undefined)
const onCancel = fn(() => {})

const PUBLISHED_AT = new Date('2026-08-27T08:00:00.000Z')
const UNFILLED_SLOT_MESSAGE =
  'Fill every template placeholder before publishing: {guest_name}.'

const meta: Meta<typeof ReviewReplyPublishedEditor> = {
  title: 'Inbox/ReplyEditorViews',
  component: ReviewReplyPublishedEditor,
  decorators: [withRole('PropertyManager')],
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof ReviewReplyPublishedEditor>

export const PublishedEditRequiresConfirmation: Story = {
  args: {
    reply: {
      text: 'Thank you for your feedback. We hope to welcome you again.',
      publishedAt: new Date('2026-08-27T08:00:00.000Z'),
      rejectionReason: null,
    },
    isSaving: false,
    onSave,
    onCancel,
  },
  play: async ({ canvasElement }) => {
    onSave.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /review update/i }))
    const dialog = await within(document.body).findByRole('alertdialog')
    await waitFor(() =>
      expect(
        within(dialog).getByText(/keeps the update pending until google confirms/i),
      ).toBeVisible(),
    )
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.click(
      within(dialog).getByRole('button', { name: /confirm & update/i }),
    )
    expect(onSave).toHaveBeenCalledWith(
      'Thank you for your feedback. We hope to welcome you again.',
    )
  },
}

/**
 * A template slot left unfilled blocks the republish AND has to say why, on the
 * control — which means the control stays reachable. Natively disabled, it left
 * the tab order and took its `aria-describedby` with it, so the sentence naming
 * the placeholder was announced to nobody: the reader most likely to need it
 * was the one who could never get to it.
 */
export const PublishedEditWithUnfilledSlot: Story = {
  args: {
    reply: {
      text: 'Dear {guest_name}, thank you.',
      publishedAt: PUBLISHED_AT,
      rejectionReason: null,
    },
    isSaving: false,
    onSave,
    onCancel,
  },
  play: async ({ canvasElement }) => {
    onSave.mockClear()
    const canvas = within(canvasElement)
    const review = canvas.getByRole('button', { name: /review update/i })
    const reason = canvas.getByText(UNFILLED_SLOT_MESSAGE)

    // Blocked, and still a control a keyboard can land on.
    expect(review).toHaveAttribute('aria-disabled', 'true')
    expect(review).not.toBeDisabled()
    review.focus()
    expect(review).toHaveFocus()

    // ...so the explanation is reachable FROM it, which is the only route a
    // screen reader has to the sentence. And it is a plain paragraph: as a
    // live region it mounted already holding its text, so it announced nothing.
    expect(reason).toBeVisible()
    expect(reason).not.toHaveAttribute('role')
    expect(review).toHaveAttribute('aria-describedby', reason.id)
    expect(document.getElementById(reason.id)).toHaveTextContent(UNFILLED_SLOT_MESSAGE)

    // Focusable is not permitted: the click is refused before the dialog.
    await userEvent.click(review)
    expect(within(document.body).queryByRole('alertdialog')).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  },
}

/**
 * The editor states the edit ONCE — by not stating it at all.
 *
 * Region 4 already says it, in the one line that exists to: the row-9 band,
 * "Editing a live reply · republishes to Google", directly above this editor
 * and inside the same bordered region. This file used to say it twice more — a
 * visible `h2` and a `Republishes to Google` badge — under a `border-t` that
 * drew a second rule inside the region's own. Three statements of one fact and
 * two rules, in a box about 56 px tall.
 *
 * What survives is the heading as the field's LABEL, `sr-only`. That is the
 * forced half and worth pinning as such: the band's id is minted inside
 * `reply-composer.tsx` and handed only to the mode row, and the reply slot is
 * an opaque `ReactNode` the pane builds, so `aria-labelledby` cannot point at
 * the band from here until the region threads that id down. Until it does, a
 * sentence no sighted reader sees beats a textarea a screen reader announces
 * as "edit text" with nothing about which reply is being republished to Google.
 * So the accessible name stays exactly `Edit published reply` — which
 * `reply-composer.stories.tsx` and `reply-form.stories.tsx` both query by — and
 * this story is what fails if the label is dropped along with the visible copy.
 */
export const PublishedEditLabelsTheFieldAndRepeatsNothing: Story = {
  args: {
    reply: {
      text: 'Thank you for your feedback. We hope to welcome you again.',
      publishedAt: PUBLISHED_AT,
      rejectionReason: null,
    },
    isSaving: false,
    onSave,
    onCancel,
  },
  play: async ({ canvas }) => {
    const field = canvas.getByRole('textbox', { name: 'Edit published reply' })
    expect(field).toHaveValue(
      'Thank you for your feedback. We hope to welcome you again.',
    )

    // One heading, and it is the field's label rather than a title.
    const headings = canvas.getAllByRole('heading')
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveAccessibleName('Edit published reply')
    expect(field).toHaveAttribute('aria-labelledby', headings[0]?.id)

    // The band's sentence and the deleted badge are both absent: the region
    // owns that fact, and this editor no longer repeats any part of it.
    expect(canvas.queryByText(/republishes to google/i)).toBeNull()
    expect(canvas.queryByText(/live on google/i)).toBeNull()
  },
}

/**
 * The other half of the split. A write in flight has nothing to explain and
 * nothing the manager can act on, so it keeps the native attribute — which is
 * what makes the story above a statement about reachable descriptions rather
 * than about dropping `disabled` everywhere.
 */
export const PublishedEditWhileSaving: Story = {
  args: {
    reply: {
      text: 'Thank you for your feedback. We hope to welcome you again.',
      publishedAt: PUBLISHED_AT,
      rejectionReason: null,
    },
    isSaving: true,
    onSave,
    onCancel,
  },
  play: async ({ canvas }) => {
    const review = canvas.getByRole('button', { name: /review update/i })
    expect(review).toBeDisabled()
    expect(review).not.toHaveAttribute('aria-describedby')
  },
}
