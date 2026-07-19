// Server import exception per CONTEXT.md:48 — 7 mutations (draft/submit/
// approve/reject/delete/retryPublish/editPublishedReply), above the ≥5
// threshold. Value-imports from #/contexts/review/server/reply are deliberate
// to avoid prop drilling.

import {
  draftReplyFn,
  submitReplyFn,
  approveReplyFn,
  rejectReplyFn,
  deleteReplyFn,
  retryPublishFn,
  editPublishedReplyFn,
} from '#/contexts/review/server/reply'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { ReplyStatusView, resolveReplyView } from './reply-status-view'
import type { ReplyData } from './reply-status-view'

export type { ReplyData } from './reply-status-view'

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
  const edit = useActionMutation(editPublishedReplyFn, {
    successMessage: 'Reply updated — republishing',
    onSuccess: onReplyChanged,
  })
  const isSaving = [draft, submit, approve, reject, del, retry, edit].some(
    (m) => m.isPending,
  )

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
      onSaveEdit={(text) => edit({ data: { reviewId, text } })}
    />
  )
}
