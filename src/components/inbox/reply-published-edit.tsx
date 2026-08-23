import { useState } from 'react'
import { ReviewReplyPublished, ReviewReplyPublishedEditor } from './reply-editor-views'
import type { ReplyData } from './reply-status-view'

type Props = Readonly<{
  reply: NonNullable<ReplyData>
  isSaving: boolean
  onSaveEdit: (text: string) => Promise<unknown>
}>

export function ReplyPublishedWithEdit({ reply, isSaving, onSaveEdit }: Props) {
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return <ReviewReplyPublished reply={reply} onEdit={() => setEditing(true)} />
  }
  return (
    <ReviewReplyPublishedEditor
      reply={reply}
      isSaving={isSaving}
      onSave={async (text) => {
        await onSaveEdit(text)
        setEditing(false)
      }}
      onCancel={() => setEditing(false)}
    />
  )
}
