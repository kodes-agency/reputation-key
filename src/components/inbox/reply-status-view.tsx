// Inbox detail — reply status view selection (extracted from reply-form.tsx
// to keep both files under the max-lines budget).

import { useState } from 'react'
import type { getReplyFn } from '#/contexts/review/server/reply'
import { ReplyCompose } from './reply-editor-compose'
import {
  ReviewReplyApproved,
  ReviewReplyPublished,
  ReviewReplyPublishedEditor,
  ReviewReplyMirror,
} from './reply-editor-views'
import {
  ReplyPendingApproval,
  ReplyPublishFailed,
  ReviewReplyRejected,
} from './reply-editor-actions'

export type ReplyData = Awaited<ReturnType<typeof getReplyFn>>

/** Which read-only/compose view a reply renders as (keeps ReplyEditorInner under the complexity budget). */
type ResolvedReplyView =
  | Readonly<{ kind: 'compose'; reply: ReplyData | null }>
  | Readonly<{ kind: 'pending'; reply: NonNullable<ReplyData> }>
  | Readonly<{ kind: 'approved'; reply: NonNullable<ReplyData> }>
  | Readonly<{ kind: 'mirror'; reply: NonNullable<ReplyData> }>
  | Readonly<{ kind: 'published'; reply: NonNullable<ReplyData> }>
  | Readonly<{ kind: 'failed'; reply: NonNullable<ReplyData> }>
  | Readonly<{ kind: 'rejected'; reply: NonNullable<ReplyData> }>
  | Readonly<{ kind: 'none' }>

export function resolveReplyView(reply: ReplyData | null): ResolvedReplyView {
  if (!reply || reply.status === 'draft') return { kind: 'compose', reply }
  if (reply.status === 'pending_approval') return { kind: 'pending', reply }
  if (reply.status === 'approved') return { kind: 'approved', reply }
  // A google_sync mirror is always provider-published and read-only here —
  // never the compose box, never actions (editing is a future feature).
  if (reply.source === 'google_sync') return { kind: 'mirror', reply }
  if (reply.status === 'published') return { kind: 'published', reply }
  if (reply.status === 'publish_failed') return { kind: 'failed', reply }
  if (reply.status === 'rejected') return { kind: 'rejected', reply }
  return { kind: 'none' }
}

type ReplyStatusViewProps = Readonly<{
  view: ResolvedReplyView
  isSaving: boolean
  onSaveDraft: (text: string) => Promise<unknown>
  onSubmitReply: (text: string) => Promise<unknown>
  onDeleteDraft: (() => Promise<unknown>) | undefined
  onApprove: () => Promise<unknown>
  onReject: (reason?: string) => Promise<unknown>
  onRetry: () => Promise<unknown>
  onSaveEdit: (text: string) => Promise<unknown>
}>

/** Renders the reply in its current state (compose / read-only status views). */
export function ReplyStatusView({
  view,
  isSaving,
  onSaveDraft,
  onSubmitReply,
  onDeleteDraft,
  onApprove,
  onReject,
  onRetry,
  onSaveEdit,
}: ReplyStatusViewProps) {
  switch (view.kind) {
    case 'compose':
      return (
        <ReplyCompose
          initialText={view.reply?.text ?? ''}
          isSaving={isSaving}
          onSaveDraft={onSaveDraft}
          onSubmit={onSubmitReply}
          onDelete={onDeleteDraft}
        />
      )
    case 'pending':
      return (
        <ReplyPendingApproval
          reply={view.reply}
          isSaving={isSaving}
          onApprove={onApprove}
          onReject={onReject}
        />
      )
    case 'approved':
      return <ReviewReplyApproved reply={view.reply} />
    case 'mirror':
      return <ReviewReplyMirror reply={view.reply} />
    case 'published':
      return (
        <PublishedWithEdit
          reply={view.reply}
          isSaving={isSaving}
          onSaveEdit={onSaveEdit}
        />
      )
    case 'failed':
      return (
        <ReplyPublishFailed reply={view.reply} isSaving={isSaving} onRetry={onRetry} />
      )
    case 'rejected':
      return (
        <ReviewReplyRejected
          reply={view.reply}
          isSaving={isSaving}
          onEditResubmit={() => {}}
        />
      )
    case 'none':
      return null
  }
}

/** Published reply with an inline edit mode (edit-and-republish). */
function PublishedWithEdit({
  reply,
  isSaving,
  onSaveEdit,
}: Readonly<{
  reply: NonNullable<ReplyData>
  isSaving: boolean
  onSaveEdit: (text: string) => Promise<unknown>
}>) {
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
