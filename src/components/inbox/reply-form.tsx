// Server import exception per src/components/CONTEXT.md "Server-function boundary" —
// this editor coordinates the reply command family plus template-list/load actions.
// Value imports stay centralized here to avoid prop drilling through every status view.

import {
  draftReplyFn,
  submitReplyFn,
  approveReplyFn,
  rejectReplyFn,
  deleteReplyFn,
  retryPublishFn,
  editPublishedReplyFn,
  listReplyTemplatesFn,
  loadReplyTemplateFn,
} from '#/contexts/review/server/reply'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { ReplyStatusView, resolveReplyView } from './reply-status-view'
import type { ReplyData } from './reply-status-view'
import type { InboxReplyCacheChange } from './inbox-cache-policy'
import type { ReviewLanguageReadiness } from './reply-language-options'

import type { generateReplySuggestionFn } from '#/contexts/ai/server/reply-suggestion'
export type { ReplyData } from './reply-status-view'

type ReplyEditorProps = Readonly<{
  propertyId: string
  reviewId: string
  reply: ReplyData | null
  loading: boolean
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  reviewLanguageReadiness: ReviewLanguageReadiness
  onReplyChanged: (change: InboxReplyCacheChange) => void
  generateReplySuggestion?: typeof generateReplySuggestionFn
}>

export function ReplyEditor({
  propertyId,
  reviewId,
  reply,
  loading,
  propertyDefaultReplyLanguage,
  reviewReplyLanguage,
  reviewLanguageReadiness,
  onReplyChanged,
  generateReplySuggestion,
}: ReplyEditorProps) {
  const draft = useActionMutation(draftReplyFn, {
    onSuccess: (reply) => onReplyChanged({ kind: 'draft_saved', reply }),
  })
  const submit = useActionMutation(submitReplyFn, {
    successMessage: 'Submitted for approval',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const approve = useActionMutation(approveReplyFn, {
    successMessage: 'Confirmation recorded. Waiting for Google',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const reject = useActionMutation(rejectReplyFn, {
    successMessage: 'Reply rejected',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const del = useActionMutation(deleteReplyFn, {
    successMessage: 'Reply deleted',
    onSuccess: () => onReplyChanged({ kind: 'state_changed', reply: null }),
  })
  const check = useActionMutation(retryPublishFn, {
    successMessage: 'Google check complete',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const retry = useActionMutation(retryPublishFn, {
    successMessage: 'Publishing restarted',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const edit = useActionMutation(editPublishedReplyFn, {
    successMessage: 'Update confirmed. Waiting for Google',
    onSuccess: (reply) => onReplyChanged({ kind: 'state_changed', reply }),
  })
  const listTemplates = useActionMutation(listReplyTemplatesFn)
  const loadTemplate = useActionMutation(loadReplyTemplateFn, {
    onSuccess: (reply) => onReplyChanged({ kind: 'draft_saved', reply }),
  })
  const isSaving = [submit, approve, reject, del, check, retry, edit].some(
    (mutation) => mutation.isPending,
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
      propertyId={propertyId}
      view={resolveReplyView(reply)}
      isSaving={isSaving}
      propertyDefaultReplyLanguage={propertyDefaultReplyLanguage}
      reviewReplyLanguage={reviewReplyLanguage}
      reviewLanguageReadiness={reviewLanguageReadiness}
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
      onCheck={() => check({ data: { reviewId } })}
      onRetry={() => retry({ data: { reviewId } })}
      onSaveEdit={(text) => edit({ data: { reviewId, text } })}
      onListTemplates={(targetLanguage) =>
        listTemplates({ data: { reviewId, targetLanguage } })
      }
      onLoadTemplate={(templateId, targetLanguage) =>
        loadTemplate({
          data: { reviewId, templateId, targetLanguage },
        })
      }
      onGenerateSuggestion={
        generateReplySuggestion
          ? (tone, targetLanguage, templateOnly) =>
              generateReplySuggestion({
                data: {
                  reviewId,
                  tone,
                  targetLanguage,
                  idempotencyKey: crypto.randomUUID(),
                  ...(templateOnly ? { templateOnly: true } : {}),
                },
              })
          : undefined
      }
    />
  )
}
