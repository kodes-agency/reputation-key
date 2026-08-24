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

import type { generateReplySuggestionFn } from '#/contexts/ai/server/reply-suggestion'
export type { ReplyData } from './reply-status-view'

type InnerProps = Readonly<{
  propertyId: string
  reviewId: string
  reply: ReplyData | null
  loading: boolean
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  canDetectReviewLanguage: boolean
  onReplyChanged: (reply: ReplyData | null) => void
  generateReplySuggestion?: typeof generateReplySuggestionFn
}>

export function ReplyEditorInner({
  propertyId,
  reviewId,
  reply,
  loading,
  propertyDefaultReplyLanguage,
  reviewReplyLanguage,
  canDetectReviewLanguage,
  onReplyChanged,
  generateReplySuggestion,
}: InnerProps) {
  const draft = useActionMutation(draftReplyFn, {
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
  const isSaving = [submit, approve, reject, del, retry, edit].some((m) => m.isPending)

  if (loading) {
    return (
      <div className="border-t pt-4">
        <p className="text-sm text-muted-foreground">Loading reply...</p>
      </div>
    )
  }

  return (
    <ReplyStatusView
      propertyId={propertyId}
      view={resolveReplyView(reply)}
      isSaving={isSaving}
      propertyDefaultReplyLanguage={propertyDefaultReplyLanguage}
      reviewReplyLanguage={reviewReplyLanguage}
      canDetectReviewLanguage={canDetectReviewLanguage}
      onSaveDraft={(text, provenanceToken, replyLanguageTag) =>
        draft({
          data: {
            reviewId,
            text,
            ...(replyLanguageTag ? { replyLanguageTag } : {}),
            ...(provenanceToken ? { provenanceToken } : {}),
          },
        })
      }
      onSubmitReply={() => submit({ data: { reviewId } })}
      onDeleteDraft={reply ? () => del({ data: { reviewId } }) : undefined}
      onApprove={() => approve({ data: { reviewId } })}
      onReject={(reason) => reject({ data: { reviewId, reason } })}
      onRetry={() => retry({ data: { reviewId } })}
      onSaveEdit={(text) => edit({ data: { reviewId, text } })}
      onGenerateSuggestion={
        generateReplySuggestion
          ? (tone, targetLanguage) =>
              generateReplySuggestion({
                data: {
                  reviewId,
                  tone,
                  targetLanguage,
                  idempotencyKey: crypto.randomUUID(),
                },
              })
          : undefined
      }
    />
  )
}
