// Inbox notes thread — note list + add-note form inside the detail panel.
// The form wraps addInboxNote via useActionMutation; stories drive the mock fn
// to cover the populated/empty states and a real submit interaction.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { InboxNotesThread } from './inbox-notes-thread'
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import type { InboxNote, InboxNoteView } from '#/contexts/inbox/application/public-api'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'

type AddNoteInput = {
  data: { inboxItemId: string; text: string; expectedCommandRevision: number }
}

// Resolving add-note fn — form stays idle after a successful submit.
const addNoteFn = mockServerFn(async (_input: AddNoteInput) => ({
  ok: true,
})) as unknown as typeof addInboxNoteFn

const notes: ReadonlyArray<InboxNoteView> = [
  {
    id: 'note-1' as InboxNote['id'],
    inboxItemId: 'inbox-1' as InboxNote['inboxItemId'],
    organizationId: 'org-1' as InboxNote['organizationId'],
    userId: 'user-1' as InboxNote['userId'],
    displayName: 'Ada Lovelace',
    text: 'Escalating to the property manager for follow-up.',
    createdAt: new Date('2025-06-01T10:00:00Z'),
  },
  {
    id: 'note-2' as InboxNote['id'],
    inboxItemId: 'inbox-1' as InboxNote['inboxItemId'],
    organizationId: 'org-1' as InboxNote['organizationId'],
    userId: 'user-2' as InboxNote['userId'],
    // An author the directory could not resolve renders "Unknown user".
    displayName: null,
    text: 'Customer replied — looks resolved.',
    createdAt: new Date('2025-06-01T09:00:00Z'),
  },
  {
    id: 'note-3' as InboxNote['id'],
    inboxItemId: 'inbox-1' as InboxNote['inboxItemId'],
    organizationId: 'org-1' as InboxNote['organizationId'],
    userId: 'user-3' as InboxNote['userId'],
    displayName: 'Grace Hopper',
    text: 'Confirmed the refund with the front desk.',
    createdAt: new Date('2025-06-01T08:00:00Z'),
  },
]

const meta: Meta<typeof InboxNotesThread> = {
  title: 'Inbox/Notes Thread',
  component: InboxNotesThread,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof InboxNotesThread>

// Two notes (newest first) — the current user's note is labelled "You".
export const WithNotes: Story = {
  args: {
    notes,
    inboxItemId: 'inbox-1',
    expectedCommandRevision: 1,
    currentUserId: 'user-1',
    onNoteAdded: fn(),
    addInboxNote: addNoteFn,
  },
  // IBX-01-T6: the author label is the resolved display name, an unresolvable
  // author is an opaque "Unknown user", and no id fragment is ever rendered.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The caller's own note is "You"; a resolved author is their display name;
    // an unresolvable author is opaque. No id fragment appears anywhere.
    await expect(canvas.getByText('You')).toBeInTheDocument()
    await expect(canvas.getByText('Grace Hopper')).toBeInTheDocument()
    await expect(canvas.getByText('Unknown user')).toBeInTheDocument()
    await expect(canvasElement.textContent ?? '').not.toContain('user-')
  },
}

// No notes yet — the empty hint renders.
export const Empty: Story = {
  args: {
    notes: [],
    inboxItemId: 'inbox-1',
    expectedCommandRevision: 1,
    currentUserId: 'user-1',
    onNoteAdded: fn(),
    addInboxNote: addNoteFn,
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: /add note/i }),
    ).toBeDisabled()
  },
}

// Submitting a note: typing then clicking Add Note invokes addInboxNote with the
// text, fires onNoteAdded on success, and clears the textarea. Module-level
// spies + mockClear keep assertions stable across play re-runs.
const submitSpy = fn(async (_input: AddNoteInput) => ({ ok: true }))
const addNoteForSubmit = mockServerFn(submitSpy) as unknown as typeof addInboxNoteFn
const onNoteAddedSpy = fn()

export const AddNote: Story = {
  args: {
    notes: [],
    inboxItemId: 'inbox-1',
    expectedCommandRevision: 1,
    currentUserId: 'user-1',
    onNoteAdded: onNoteAddedSpy,
    addInboxNote: addNoteForSubmit,
  },
  play: async ({ canvasElement }) => {
    submitSpy.mockClear()
    onNoteAddedSpy.mockClear()
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
    // onSuccess fires onNoteAdded + clears the field once the mutation settles.
    await waitFor(() => {
      expect(onNoteAddedSpy).toHaveBeenCalledWith(2)
      expect(textarea).toHaveValue('')
    })
  },
}
