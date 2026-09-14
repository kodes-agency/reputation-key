// The composer's footer — the blocked-submit reason, the error line, and the
// one primary button in region 4.
//
// It used to own the save-state COPY MAP too: six autosave statuses, each
// folding in `· publishes only after approval`. Plan v2.1 row 14 deletes that
// line and row 16 moves the status up into the dock's head, where
// `composer-mode-row.tsx` prints it in three words and `composer-dock.stories.tsx`
// pins every status against a reporting surface. The guarantee moved to the
// submit's tooltip (`Nothing publishes until a manager approves it`) and the
// submit toast. What this file still pins, per status, is what the FOOTER does
// with the status it is still handed: offer `Retry save` on an error and on
// nothing else — and that neither the old line nor its guarantee comes back.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ReplyComposerFooter } from './reply-composer-footer'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

const onRetrySave = fn(async () => undefined).mockName('onRetrySave')
const onSubmit = fn(async () => undefined).mockName('onSubmit')
const onDelete = fn(async () => undefined).mockName('onDelete')

/** The line row 14 deleted, and the older lock line before it. Neither returns. */
const REMOVED_LINES =
  /publishes only after approval|Nothing is published automatically|Draft saved|Saving draft/i

/** The footer prints no status and so owns no live region any more. */
function expectNoSaveStateLine(canvasElement: HTMLElement): void {
  expect(canvasElement.querySelectorAll('[aria-live="polite"]')).toHaveLength(0)
  expect(canvasElement.textContent ?? '').not.toMatch(REMOVED_LINES)
}

const meta: Meta<typeof ReplyComposerFooter> = {
  title: 'Inbox/ReplyComposerFooter',
  component: ReplyComposerFooter,
  tags: ['autodocs'],
  decorators: [withRole('PropertyManager')],
  parameters: { layout: 'centered' },
  args: {
    status: 'idle',
    error: null,
    canSubmit: true,
    submitBlockedReason: null,
    disabled: false,
    isSubmitting: false,
    onRetrySave,
    onSubmit,
  },
}
export default meta
type Story = StoryObj<typeof ReplyComposerFooter>

/**
 * Nothing typed yet. The guarantee is already stated: it is true of a draft
 * that has never been saved just as much as of one that has, which is why it
 * belongs to the save state rather than to a line of its own.
 */
export const Idle: Story = {
  play: async ({ canvasElement }) => {
    expectNoSaveStateLine(canvasElement)
    expect(within(canvasElement).queryByRole('button', { name: 'Retry save' })).toBeNull()
    // The footer's one primary, and the region's.
    const primaries = canvasElement.querySelectorAll('button[data-variant="default"]')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveAccessibleName('Submit for approval')
  },
}

/** Debounce running. Same clause, present tense. */
export const Pending: Story = {
  args: { status: 'pending' },
  play: async ({ canvasElement }) => {
    expectNoSaveStateLine(canvasElement)
    expect(within(canvasElement).queryByRole('button', { name: 'Retry save' })).toBeNull()
  },
}

/** The request is in flight. Deliberately the same wording as `pending`. */
export const Saving: Story = {
  args: { status: 'saving' },
  play: async ({ canvasElement }) => {
    expectNoSaveStateLine(canvasElement)
    expect(within(canvasElement).queryByRole('button', { name: 'Retry save' })).toBeNull()
  },
}

/**
 * The string the rebuild is pinned on: `Draft saved · publishes only after
 * approval`. This is the whole of what a manager is told about publication now,
 * so it is asserted verbatim rather than by regex.
 */
export const Saved: Story = {
  args: { status: 'saved' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectNoSaveStateLine(canvasElement)
    // A saved draft offers no retry: there is nothing to retry.
    expect(canvas.queryByRole('button', { name: 'Retry save' })).toBeNull()
  },
}

/**
 * Ineligible to save — an auto-detect language selection, or an empty/over-long
 * draft. Not an error, so no destructive treatment and no retry, but the
 * guarantee still holds and still says so.
 */
export const Unsaved: Story = {
  args: { status: 'unsaved' },
  play: async ({ canvasElement }) => {
    expectNoSaveStateLine(canvasElement)
    expect(within(canvasElement).queryByRole('button', { name: 'Retry save' })).toBeNull()
  },
}

/**
 * The save failed. The retry appears — and it is a ghost, not a second primary:
 * `Submit for approval` stays the only `variant="default"` in the region even
 * when it is the refused action of the two.
 */
export const SaveFailed: Story = {
  args: {
    status: 'error',
    error: 'Draft could not be saved. Retry before submitting.',
    canSubmit: false,
  },
  play: async ({ canvasElement }) => {
    onRetrySave.mockClear()
    const canvas = within(canvasElement)
    expectNoSaveStateLine(canvasElement)
    expect(
      canvas.getByText('Draft could not be saved. Retry before submitting.'),
    ).toBeVisible()

    const retry = canvas.getByRole('button', { name: 'Retry save' })
    expect(retry).toHaveAttribute('data-variant', 'ghost')
    expect(canvas.getByRole('button', { name: 'Submit for approval' })).toBeDisabled()
    const primaries = canvasElement.querySelectorAll('button[data-variant="default"]')
    expect(primaries).toHaveLength(1)

    await userEvent.click(retry)
    expect(onRetrySave).toHaveBeenCalledOnce()
  },
}

/**
 * An existing draft adds Delete, also a ghost. Two extra controls and still one
 * primary — the rule region 4 is gated on.
 */
export const WithDeletableDraft: Story = {
  args: { status: 'saved', onDelete },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Delete draft' })).toHaveAttribute(
      'data-variant',
      'ghost',
    )
    const primaries = canvasElement.querySelectorAll('button[data-variant="default"]')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveAccessibleName('Submit for approval')
  },
}

/**
 * An unfilled template placeholder blocks the submit, and the reason reaches
 * the reader through the button's `aria-describedby` rather than by being
 * merely visible near it.
 */
export const SubmitBlocked: Story = {
  args: {
    status: 'saved',
    canSubmit: false,
    submitBlockedReason:
      'Fill every template placeholder before publishing: {guest_name}.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const submit = canvas.getByRole('button', { name: 'Submit for approval' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAccessibleDescription(
      'Fill every template placeholder before publishing: {guest_name}.',
    )
  },
}

/** The submit is in flight: the label says so and every control is locked. */
export const Submitting: Story = {
  args: { status: 'saved', disabled: true, isSubmitting: true, onDelete },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Submitting…' })).toBeDisabled()
    expect(canvas.getByRole('button', { name: 'Delete draft' })).toBeDisabled()
    expect(canvas.queryByRole('button', { name: 'Submit for approval' })).toBeNull()
  },
}
