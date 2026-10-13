// The note command as the composer issues it.
//
// A note is the one item command whose result carries no item snapshot
// (`InboxNote`), yet it advances the item's command revision in the same
// transaction (`inbox-command-store.ts` `addNote`). So the revision the note
// left behind is worked out here and carried into every cached copy of the item
// (`inboxCachePolicy.onNoteAdded`) before the manager can issue another command.
//
// It is the revision of the send that COMMITTED, plus one. `onSuccess` only
// ever sees the first send's input, and `withFreshCommandRevision` re-sends
// once at the server's revision after a conflict, so reading it off that input
// left the cache one behind whenever the re-send was the one that landed. Each
// send therefore reports the revision it leaves, and the one that committed is
// the one that comes back.
import { useQueryClient } from '@tanstack/react-query'
import type { Action } from '#/components/hooks/use-action'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
// Type-only: the server fn arrives as a prop per src/components/CONTEXT.md "Server-function boundary".
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import {
  isInboxRevisionConflictResult,
  type InboxNote,
  type InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'
import { inboxCachePolicy } from './inbox-cache-policy'
import { withFreshCommandRevision } from './use-inbox-detail'

export type AddInboxNoteInput = Parameters<typeof addInboxNoteFn>[0]

export type AddInboxNote = (
  input: AddInboxNoteInput,
) => Promise<InboxNote | InboxRevisionConflictResult>

/** The saved note, and the command revision its send left the item on. */
type CommittedNote = Readonly<{ note: InboxNote; commandRevision: number }>

export function useAddInboxNote(
  addInboxNote: AddInboxNote,
): Action<AddInboxNoteInput, CommittedNote> {
  const qc = useQueryClient()
  const send = async (
    attempt: AddInboxNoteInput,
  ): Promise<CommittedNote | InboxRevisionConflictResult> => {
    const result = await addInboxNote(attempt)
    return isInboxRevisionConflictResult(result)
      ? result
      : { note: result, commandRevision: attempt.data.expectedCommandRevision + 1 }
  }
  return useActionMutation(
    (input: AddInboxNoteInput) =>
      withFreshCommandRevision(qc, input.data.inboxItemId, send)(input),
    {
      successMessage: 'Note added',
      // The item comes from the command's own input, never from what the pane
      // has open by the time a slow send settles.
      onSuccess: (committed, input) =>
        inboxCachePolicy.onNoteAdded(
          qc,
          input.data.inboxItemId,
          committed.commandRevision,
        ),
    },
  )
}
