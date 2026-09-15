// Inbox detail — reply orchestrator. The reply command family lives in
// `use-reply-actions.ts`, which carries the sanctioned server-import exception
// (src/components/CONTEXT.md "Server-function boundary"): the read-only states
// render in the thread while the draft lives in the composer, so the mutations
// cannot belong to either one. This file only routes the current reply state to
// its view and hands the actions on.
//
// It does NOT build those actions. `useReplyActions` is called once, by
// `inbox-detail-content.tsx`, and the bag arrives here as a prop: the thread's
// message and this editor are co-mounted whenever an editor is open, and two
// `useMutation` sets would give them two independent `isSaving` flags — a write
// started in one surface leaving the other's buttons live on the same reply.

import { ReplyStatusView, resolveReplyView } from './reply-status-view'
import type { ReplyData, ReplyEditTarget } from './reply-status-view'
import type { ReplyActions } from './use-reply-actions'
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
  /** Which existing reply this editor is opened on — the pane's state, not
   *  this component's: the thread's message is what raises it. */
  editTarget: ReplyEditTarget
  /** Bumped when the pane is asked to put the caret in the composer — by a
   *  click in the thread or by the `r` shortcut. A counter, not a flag, so the
   *  same ask can be repeated: the composer is mounted for every draft, and
   *  only the pane knows which of those the user actually asked for. */
  caretRequest: number
  /** The pane's single reply command family — never rebuilt here. */
  actions: ReplyActions
  onEditDone: () => void
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
  editTarget,
  caretRequest,
  actions,
  onEditDone,
  generateReplySuggestion,
}: ReplyEditorProps) {
  if (loading) {
    // No `border-t` any more: this placeholder sits inside region 4, which
    // draws the rule that used to separate the composer from the thread.
    return <p className="text-sm text-muted-foreground">Loading reply...</p>
  }

  return (
    <ReplyStatusView
      propertyId={propertyId}
      view={resolveReplyView(reply)}
      editTarget={editTarget}
      caretRequest={caretRequest}
      isSaving={actions.isSaving}
      propertyDefaultReplyLanguage={propertyDefaultReplyLanguage}
      reviewReplyLanguage={reviewReplyLanguage}
      reviewLanguageReadiness={reviewLanguageReadiness}
      onSaveDraft={actions.saveDraft}
      onSubmitReply={actions.submitReply}
      // A missing reply has no draft to delete, so the composer shows no Delete.
      onDeleteDraft={reply ? actions.deleteDraft : undefined}
      onSaveEdit={actions.saveEdit}
      onEditDone={onEditDone}
      onListTemplates={actions.listTemplates}
      onLoadTemplate={actions.loadTemplate}
      onGenerateSuggestion={
        generateReplySuggestion
          ? (tone, targetLanguage, templateOnly, idempotencyKey) =>
              generateReplySuggestion({
                data: {
                  reviewId,
                  tone,
                  targetLanguage,
                  // The composer owns the key (`use-reply-suggestion.ts`): a
                  // busy retry or a repeated click reuses it, Regenerate does not.
                  idempotencyKey,
                  ...(templateOnly ? { templateOnly: true } : {}),
                },
              })
          : undefined
      }
    />
  )
}
