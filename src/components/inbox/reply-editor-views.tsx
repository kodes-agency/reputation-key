// Inbox detail — read-only reply status views

import { useState } from 'react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import { formatDateTime } from './utils'

type ReplyView = Readonly<{
  text: string
  publishedAt: Date | null
  rejectionReason: string | null
}>

export function ReviewReplyApproved({ reply }: Readonly<{ reply: ReplyView }>) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Reply</h2>
        <Badge variant="outline">Publishing...</Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
    </div>
  )
}

export function ReviewReplyPublished({
  reply,
  onEdit,
}: Readonly<{ reply: ReplyView; onEdit?: () => void }>) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Reply</h2>
        <Badge className="bg-green-100 text-green-800">Published</Badge>
        {onEdit && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
      {reply.publishedAt && (
        <p className="text-xs text-muted-foreground">
          Published: {formatDateTime(reply.publishedAt)}
        </p>
      )}
    </div>
  )
}

/**
 * Inline editor for a published reply (edit-and-republish). Saving re-enters
 * the durable publication machine — the provider update is an upsert, so the
 * Google-visible reply is updated in place, never duplicated.
 */
export function ReviewReplyPublishedEditor({
  reply,
  isSaving,
  onSave,
  onCancel,
}: Readonly<{
  reply: ReplyView
  isSaving: boolean
  onSave: (text: string) => Promise<unknown>
  onCancel: () => void
}>) {
  const [text, setText] = useState(reply.text)
  const charCount = text.length
  const isOverLimit = charCount > MAX_REPLY_LENGTH
  const canSave = text.trim().length > 0 && !isOverLimit && !isSaving

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Edit published reply</h2>
        <Badge variant="outline">Republishes to Google</Badge>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        disabled={isSaving}
      />
      <div className="flex items-center justify-between">
        <span
          className={`text-xs ${isOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {charCount}/{MAX_REPLY_LENGTH}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={isSaving} onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSave} onClick={() => onSave(text)}>
            Save &amp; republish
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Read-only view of a google_sync mirror — a reply that was published via the
 * GBP UI (or synced in), so no internal reply exists. Rendered instead of the
 * compose box: without this, the panel invites a "first" reply that would
 * blindly overwrite the existing Google-visible reply via the upsert.
 */
export function ReviewReplyMirror({ reply }: Readonly<{ reply: ReplyView }>) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Reply</h2>
        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">
          Published on Google
        </Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
      {reply.publishedAt && (
        <p className="text-xs text-muted-foreground">
          Published: {formatDateTime(reply.publishedAt)} — via Google Business Profile
        </p>
      )}
    </div>
  )
}
