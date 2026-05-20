// Inbox notes thread — displays notes and add-note form within the detail panel
import { useState } from 'react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
// exception: server fn used directly — component is 3 levels deep (route → sheet → content → notes),
// prop drilling >2 levels is worse than direct server fn import here
import { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { Send, Clock, User } from 'lucide-react'
import type { InboxNote } from '#/contexts/inbox/application/public-api'

type Props = Readonly<{
  notes: ReadonlyArray<InboxNote>
  inboxItemId: string
  currentUserId?: string
  onNoteAdded: () => void
}>

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
  currentUserId,
  onNoteAdded,
}: Props) {
  const [noteText, setNoteText] = useState('')

  const addNote = useMutationAction(addInboxNoteFn, {
    successMessage: 'Note added',
    onSuccess: () => {
      setNoteText('')
      onNoteAdded()
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = noteText.trim()
    if (!trimmed) return
    addNote({
      data: {
        inboxItemId,
        text: trimmed,
      },
    })
  }

  // Sort notes newest first
  const sortedNotes = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-medium text-foreground">Notes ({notes.length})</h4>

      {/* Notes list */}
      {sortedNotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <div className="max-h-60 space-y-3 overflow-y-auto">
          {sortedNotes.map((note) => (
            <div key={note.id} className="rounded-md border bg-muted/30 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <User className="size-3" />
                <span className="font-medium">
                  {note.authorUserId === currentUserId
                    ? 'You'
                    : `${note.authorUserId.slice(0, 8)}…`}
                </span>
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <Textarea
          placeholder="Add a note…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={3}
          className="resize-none text-sm"
          disabled={addNote.isPending}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={addNote.isPending || !noteText.trim()}
          >
            <Send className="size-3.5" />
            Add Note
          </Button>
        </div>
      </form>
    </div>
  )
}
