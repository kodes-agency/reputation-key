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
import { ReviewReplyApproved, ReviewReplyPublished } from './reply-editor-views'
import {
  ReplyPendingApproval,
  ReplyPublishFailed,
  ReviewReplyRejected,
} from './reply-editor-actions'

export type ReplyData = Awaited<ReturnType<typeof getReplyFn>>

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

  if (!reply || reply.status === 'draft') {
    return (
      <ReplyCompose
        initialText={reply?.text ?? ''}
        isSaving={isSaving}
        onSaveDraft={(text) => draft({ data: { reviewId, text } })}
        onSubmit={(text) =>
          draft({ data: { reviewId, text } }).then(() => submit({ data: { reviewId } }))
        }
        onDelete={reply ? () => del({ data: { reviewId } }) : undefined}
      />
    )
  }

  if (reply.status === 'pending_approval') {
    return (
      <ReplyPendingApproval
        reply={reply}
        isSaving={isSaving}
        onApprove={() => approve({ data: { reviewId } })}
        onReject={(reason) => reject({ data: { reviewId, reason } })}
      />
    )
  }

  if (reply.status === 'approved') return <ReviewReplyApproved reply={reply} />
  if (reply.status === 'published') return <ReviewReplyPublished reply={reply} />

  if (reply.status === 'publish_failed') {
    return (
      <ReplyPublishFailed
        reply={reply}
        isSaving={isSaving}
        onRetry={() => retry({ data: { reviewId } })}
      />
    )
  }

  if (reply.status === 'rejected') {
    return (
      <ReviewReplyRejected reply={reply} isSaving={isSaving} onEditResubmit={() => {}} />
    )
  }

  return null
}
