// Server import exception per CONTEXT.md:48 — 6 mutations (draft/submit/
// approve/reject/delete/retryPublish), above the ≥5 threshold. Value-imports
// from #/contexts/review/server/reply are deliberate to avoid prop drilling.

import {
  draftReplyFn,
  submitReplyFn,
  approveReplyFn,
  rejectReplyFn,
  deleteReplyFn,
  retryPublishFn,
  getReplyFn,
} from '#/contexts/review/server/reply'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { ReplyCompose } from './reply-editor-compose'
import {
  ReviewReplyApproved,
  ReviewReplyPublished,
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

function resolveReplyView(reply: ReplyData | null): ResolvedReplyView {
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

type InnerProps = Readonly<{
  reviewId: string
  reply: ReplyData | null
  loading: boolean
  onReplyChanged: (reply: ReplyData | null) => void
}>

export function ReplyEditorInner({
  reviewId,
  reply,
  loading,
  onReplyChanged,
}: InnerProps) {
  const draft = useActionMutation(draftReplyFn, {
    successMessage: 'Draft saved',
    onSuccess: onReplyChanged,
  })
  const submit = useActionMutation(submitReplyFn, {
    successMessage: 'Submitted for approval',
    onSuccess: onReplyChanged,
  })
  const approve = useActionMutation(approveReplyFn, {
    successMessage: 'Approved and publishing',
    onSuccess: onReplyChanged,
  })
  const reject = useActionMutation(rejectReplyFn, {
    successMessage: 'Reply rejected',
    onSuccess: onReplyChanged,
  })
  const del = useActionMutation(deleteReplyFn, {
    successMessage: 'Reply deleted',
    onSuccess: () => onReplyChanged(null),
  })
  const retry = useActionMutation(retryPublishFn, {
    successMessage: 'Retrying publish...',
    onSuccess: onReplyChanged,
  })
  const isSaving = [draft, submit, approve, reject, del, retry].some((m) => m.isPending)

  if (loading) {
    return (
      <div className="border-t pt-4">
        <p className="text-sm text-muted-foreground">Loading reply...</p>
      </div>
    )
  }

  return (
    <ReplyStatusView
      view={resolveReplyView(reply)}
      isSaving={isSaving}
      onSaveDraft={(text) => draft({ data: { reviewId, text } })}
      onSubmitReply={(text) =>
        draft({ data: { reviewId, text } }).then(() => submit({ data: { reviewId } }))
      }
      onDeleteDraft={reply ? () => del({ data: { reviewId } }) : undefined}
      onApprove={() => approve({ data: { reviewId } })}
      onReject={(reason) => reject({ data: { reviewId, reason } })}
      onRetry={() => retry({ data: { reviewId } })}
    />
  )
}

/** Renders the reply in its current state (compose / read-only status views). */
function ReplyStatusView({
  view,
  isSaving,
  onSaveDraft,
  onSubmitReply,
  onDeleteDraft,
  onApprove,
  onReject,
  onRetry,
}: Readonly<{
  view: ResolvedReplyView
  isSaving: boolean
  onSaveDraft: (text: string) => Promise<unknown>
  onSubmitReply: (text: string) => Promise<unknown>
  onDeleteDraft: (() => Promise<unknown>) | undefined
  onApprove: () => Promise<unknown>
  onReject: (reason?: string) => Promise<unknown>
  onRetry: () => Promise<unknown>
}>) {
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
      return <ReviewReplyPublished reply={view.reply} />
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
