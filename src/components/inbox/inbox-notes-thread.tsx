import { useMemo } from 'react'
import { useForm } from '@tanstack/react-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextarea, type BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
// Receives addInboxNote server fn as a prop per src/components/CONTEXT.md:55.
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import { Send, Clock, User } from 'lucide-react'
import type { InboxNoteView } from '#/contexts/inbox/application/public-api'
import { addInboxNoteFormDto } from '#/contexts/inbox/application/dto/inbox.dto'

type Props = Readonly<{
  notes: ReadonlyArray<InboxNoteView>
  inboxItemId: string
  expectedCommandRevision: number
  /** Domain-owned mutation recovery; see withFreshCommandRevision. */
  recoverConflict: <TInput extends { data: { expectedCommandRevision: number } }>(
    input: TInput,
    error: unknown,
  ) => Promise<TInput | null>
  currentUserId?: string
  onNoteAdded: (resultingCommandRevision: number) => void
  addInboxNote: typeof addInboxNoteFn
  canAdd?: boolean
}>

/**
 * IBX-01-T6: never render a raw user id. The server resolves the author's
 * current display name inside the Organization; an unresolvable author is an
 * opaque "Unknown user", not an id fragment and not an email.
 */
function authorLabel(note: InboxNoteView, currentUserId?: string): string {
  if (note.userId === currentUserId) return 'You'
  return note.displayName ?? 'Unknown user'
}

function formatRelativeTime(date: Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

export function InboxNotesThread({
  notes,
  inboxItemId,
  expectedCommandRevision,
  recoverConflict,
  currentUserId,
  onNoteAdded,
  addInboxNote,
  canAdd = true,
}: Props) {
  // The success callback advances the cached command fence synchronously and
  // refreshes notes/activity through the Inbox cache policy.
  const addNote = useActionMutation(addInboxNote, {
    successMessage: 'Note added',
    onSuccess: (_note, input) => {
      onNoteAdded(input.data.expectedCommandRevision + 1)
    },
    recover: recoverConflict,
  })

  const form = useForm({
    defaultValues: { text: '' },
    validators: { onSubmit: addInboxNoteFormDto },
    onSubmit: async ({ value }) => {
      const parsed = addInboxNoteFormDto.parse(value)
      await addNote({
        data: { inboxItemId, text: parsed.text, expectedCommandRevision },
      })
      form.reset()
    },
  })

  // Sort notes newest first — FE-4 FIX: wrap in useMemo
  const sortedNotes = useMemo(
    () =>
      [...notes].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [notes],
  )

  return (
    <div className="flex flex-col gap-3">
      {/* BQC-6.8: h2 — page outline is h1 (list header) → h2 (detail sections);
          the previous h3 skipped a level (axe heading-order). */}
      <h2 className="text-sm font-medium text-foreground">Notes ({notes.length})</h2>

      {/* Notes list */}
      {sortedNotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <div className="max-h-60 space-y-3 overflow-y-auto">
          {sortedNotes.map((note) => (
            <div key={note.id} className="rounded-md border bg-muted/30 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <User className="size-3" />
                <span className="font-medium">{authorLabel(note, currentUserId)}</span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatRelativeTime(note.createdAt)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{note.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add note form */}
      {canAdd && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
          className="flex flex-col gap-2"
        >
          <FormErrorBanner error={addNote.error} />
          <form.Field name="text">
            {(field: BaseFieldApiTextarea) => (
              <>
                <FormTextarea
                  field={field}
                  id="inbox-note-text"
                  label="Add a note"
                  placeholder="Add a note…"
                  rows={3}
                  maxLength={5_000}
                  disabled={addNote.isPending}
                />
                <div className="flex justify-end">
                  <SubmitButton
                    mutation={addNote}
                    form={form}
                    disabled={!field.state.value?.trim()}
                  >
                    <Send className="size-3.5" />
                    Add note
                  </SubmitButton>
                </div>
              </>
            )}
          </form.Field>
        </form>
      )}
    </div>
  )
}
