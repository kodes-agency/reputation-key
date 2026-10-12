// Inbox notes thread — the add-note form inside the detail panel. The notes
// themselves are no longer listed here: they are messages in InboxThread,
// interleaved with handling events in the order they happened, so the author
// rules this file used to prove (a resolved display name, an opaque "Unknown
// user", never an id fragment) now live in inbox-thread.stories.tsx →
// NotesInterleavedBetweenEvents.
//
// What is left is the write half: the form wraps addInboxNote via
// useActionMutation, so the stories cover the idle state, a real submit, and
// the permission gate that renders no form at all.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { InboxNotesThread } from './inbox-notes-thread'
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'

type AddNoteInput = {
  data: { inboxItemId: string; text: string; expectedCommandRevision: number }
}

// Resolving add-note fn — form stays idle after a successful submit.
const addNoteFn = mockServerFn(async (_input: AddNoteInput) => ({
  ok: true,
})) as unknown as typeof addInboxNoteFn

const meta: Meta<typeof InboxNotesThread> = {
  title: 'Inbox/Notes Thread',
  component: InboxNotesThread,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof InboxNotesThread>

// A reader without `inbox.write` — the component renders nothing at all. With
// the list gone this file has only the form left, so an ungated render would
// leave a labelled textarea a viewer can type into but never submit, and the
// caller would draw a section rule over an empty region.
export const WithoutWritePermission: Story = {
  args: {
    inboxItemId: 'inbox-1',
    expectedCommandRevision: 1,
    addInboxNote: addNoteFn,
    canAdd: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /add note/i })).toBeNull()
    await expect(canvas.queryByRole('textbox', { name: /add a note/i })).toBeNull()
    await expect(canvas.queryByPlaceholderText('Add a note…')).toBeNull()
  },
}

// Nothing typed yet — the submit stays disabled until the field has content.
export const Empty: Story = {
  args: {
    inboxItemId: 'inbox-1',
    expectedCommandRevision: 1,
    addInboxNote: addNoteFn,
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: /add note/i }),
    ).toBeDisabled()
  },
}

// Submitting a note: typing then clicking Add Note invokes addInboxNote with the
// text and clears the textarea once it has landed. What the note does to the
// cached item (its command revision, in the detail and in every list row) is
// the hook's own business, `use-add-inbox-note.ts`, and is tested with a real
// query cache in `inbox-command-fence.test.ts`. Module-level spies + mockClear
// keep assertions stable across play re-runs.
const submitSpy = fn(async (_input: AddNoteInput) => ({ ok: true }))
const addNoteForSubmit = mockServerFn(submitSpy) as unknown as typeof addInboxNoteFn

export const AddNote: Story = {
  args: {
    inboxItemId: 'inbox-1',
    expectedCommandRevision: 1,
    addInboxNote: addNoteForSubmit,
  },
  play: async ({ canvasElement }) => {
    submitSpy.mockClear()
    const canvas = within(canvasElement)
    const textarea = canvas.getByPlaceholderText('Add a note…')
    await userEvent.type(textarea, '  Follow up tomorrow  ')
    await userEvent.click(canvas.getByRole('button', { name: /add note/i }))
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            text: 'Follow up tomorrow',
            expectedCommandRevision: 1,
          }),
        }),
      )
    })
    // The field clears once the mutation settles.
    await waitFor(() => {
      expect(textarea).toHaveValue('')
    })
  },
}
