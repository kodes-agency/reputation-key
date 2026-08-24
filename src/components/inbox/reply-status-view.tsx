// Inbox detail — reply status view selection (extracted from reply-form.tsx
// to keep both files under the max-lines budget).

import type { getReplyFn } from '#/contexts/review/server/reply'
import { ReplyCompose } from './reply-editor-compose'
import { ReviewReplyApproved, ReviewReplyMirror } from './reply-editor-views'
import { ReplyPendingApproval, ReplyPublishFailed } from './reply-editor-actions'
import { ReplyRejectedWithEdit } from './reply-rejected-edit'
import { ReplyPublishedWithEdit } from './reply-published-edit'
import type { ReplyTone, ReplySuggestionResult } from './reply-editor-compose'
import type { ReplyLanguageTarget } from './reply-language-options'

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
  propertyId: string
  view: ResolvedReplyView
  isSaving: boolean
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  canDetectReviewLanguage: boolean
  onSaveDraft: (
    text: string,
    provenanceToken?: string,
    replyLanguageTag?: string,
  ) => Promise<unknown>
  onSubmitReply: () => Promise<unknown>
  onDeleteDraft: (() => Promise<unknown>) | undefined
  onApprove: () => Promise<unknown>
  onReject: (reason?: string) => Promise<unknown>
  onRetry: () => Promise<unknown>
  onSaveEdit: (text: string) => Promise<unknown>
  onGenerateSuggestion?: (
    tone: ReplyTone,
    target: ReplyLanguageTarget,
  ) => Promise<ReplySuggestionResult>
}>

/** Renders the reply in its current state (compose / read-only status views). */
export function ReplyStatusView({
  propertyId,
  view,
  isSaving,
  propertyDefaultReplyLanguage,
  reviewReplyLanguage,
  canDetectReviewLanguage,
  onSaveDraft,
  onSubmitReply,
  onDeleteDraft,
  onApprove,
  onReject,
  onRetry,
  onSaveEdit,
  onGenerateSuggestion,
}: ReplyStatusViewProps) {
  const languageProps = {
    propertyDefaultReplyLanguage,
    reviewReplyLanguage,
    canDetectReviewLanguage,
  }
  switch (view.kind) {
    case 'compose':
      return (
        <ReplyCompose
          propertyId={propertyId}
          initialText={view.reply?.text ?? ''}
          initialLanguageTag={view.reply?.replyLanguageTag ?? null}
          initialAiGenerated={view.reply?.aiGenerated ?? false}
          {...languageProps}
          isSaving={isSaving}
          onSaveDraft={onSaveDraft}
          onSubmit={onSubmitReply}
          onDelete={onDeleteDraft}
          onGenerateSuggestion={onGenerateSuggestion}
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
        <ReplyPublishedWithEdit
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
        <ReplyRejectedWithEdit
          propertyId={propertyId}
          reply={view.reply}
          isSaving={isSaving}
          {...languageProps}
          onSaveDraft={onSaveDraft}
          onSubmitReply={onSubmitReply}
          onDeleteDraft={onDeleteDraft}
          onGenerateSuggestion={onGenerateSuggestion}
        />
      )
    case 'none':
      return null
  }
}
