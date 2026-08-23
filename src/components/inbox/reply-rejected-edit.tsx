import { useState } from 'react'
import { ReplyCompose } from './reply-editor-compose'
import { ReviewReplyRejected } from './reply-editor-actions'
import type { ReplyData } from './reply-status-view'
import type { ReplySuggestionResult, ReplyTone } from './use-reply-suggestion'
import type { ReplyLanguageTarget } from './reply-language-options'

type Props = Readonly<{
  reply: NonNullable<ReplyData>
  isSaving: boolean
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  onSaveDraft: (
    text: string,
    provenanceToken?: string,
    replyLanguageTag?: string,
  ) => Promise<unknown>
  onSubmitReply: () => Promise<unknown>
  onDeleteDraft?: () => Promise<unknown>
  onGenerateSuggestion?: (
    tone: ReplyTone,
    target: ReplyLanguageTarget,
  ) => Promise<ReplySuggestionResult>
}>

export function ReplyRejectedWithEdit(props: Props) {
  const [editing, setEditing] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!editing) {
    return (
      <div className="space-y-2">
        <ReviewReplyRejected
          reply={props.reply}
          isSaving={props.isSaving || preparing}
          onEditResubmit={() => {
            setPreparing(true)
            setError(null)
            void props
              .onSaveDraft(
                props.reply.text,
                undefined,
                props.reply.replyLanguageTag ?? undefined,
              )
              .then(() => setEditing(true))
              .catch(() => setError('The rejected reply could not be reopened.'))
              .finally(() => setPreparing(false))
          }}
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  }
  return (
    <ReplyCompose
      initialText={props.reply.text}
      initialLanguageTag={props.reply.replyLanguageTag ?? null}
      initialAiGenerated={props.reply.aiGenerated}
      propertyDefaultReplyLanguage={props.propertyDefaultReplyLanguage}
      reviewReplyLanguage={props.reviewReplyLanguage}
      isSaving={props.isSaving}
      onSaveDraft={props.onSaveDraft}
      onSubmit={props.onSubmitReply}
      onDelete={props.onDeleteDraft}
      onGenerateSuggestion={props.onGenerateSuggestion}
    />
  )
}
