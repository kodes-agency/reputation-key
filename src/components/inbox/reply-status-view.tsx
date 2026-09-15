// Inbox detail — which reply EDITOR the pane renders, if any.
//
// `resolveReplyView` stays the one place the reply's lifecycle is read: the
// thread message (`reply-message-view.ts`) and this switch both key off it, so
// a state can never be a message in one place and something else in the other.
// Every read-only state now belongs to the thread; what is left here is the
// composer's own compose state plus the one editor an existing reply opens.

import { useEffect, useRef } from 'react'
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'
import { putCaretIn } from './composer-caret'
import { ReplyCompose, type ReplyComposeProps } from './reply-editor-compose'
import { ReplyPublishedEditor } from './reply-published-edit'
import type { ReplySuggestionGenerate } from './reply-suggestion-contract'
import type { ReviewLanguageReadiness } from './reply-language-options'

export type ReplyData = InboxItemDetailResult['reply']
type GoogleObservedReplyView = Extract<
  NonNullable<ReplyData>,
  { kind: 'google_observation' }
>
type ReplyEntityView = Exclude<NonNullable<ReplyData>, GoogleObservedReplyView>

/**
 * Which existing reply is being edited, if any. The state itself is owned by
 * `inbox-detail-content.tsx`, which re-exports this type; it is declared here
 * because this switch is what consumes it, and declaring it in the owner would
 * point the module graph back up at the pane.
 *
 * `published` is the only member. A `'rejected'` target was unreachable: the
 * pane raised it in the `.then` of the reopening `draftReplyFn` call, and
 * `useActionMutation` awaits its `onSuccess` — which write-through patches
 * `status: 'draft'` into the detail cache — before `mutateAsync` resolves. So
 * every render that could have seen the target had already re-resolved the
 * reply to `compose`. The composer is the rejected reply's editor, seeded from
 * the refused text; nothing was lost by deleting the branch that never ran.
 */
export type ReplyEditTarget = 'published' | null

/** Which read-only/compose view a reply renders as (keeps ReplyEditor under budget). */
type ResolvedReplyView =
  | Readonly<{ kind: 'compose'; reply: ReplyEntityView | null }>
  | Readonly<{ kind: 'pending'; reply: ReplyEntityView }>
  | Readonly<{ kind: 'approved'; reply: ReplyEntityView }>
  | Readonly<{
      kind: 'mirror'
      reply: GoogleObservedReplyView | ReplyEntityView
    }>
  | Readonly<{ kind: 'published'; reply: ReplyEntityView }>
  | Readonly<{ kind: 'failed-check'; reply: ReplyEntityView }>
  | Readonly<{ kind: 'failed-retry'; reply: ReplyEntityView }>
  | Readonly<{ kind: 'rejected'; reply: ReplyEntityView }>
  | Readonly<{ kind: 'none' }>

export function resolveReplyView(reply: ReplyData | null): ResolvedReplyView {
  if (reply?.kind === 'google_observation') return { kind: 'mirror', reply }
  if (!reply || reply.status === 'draft') return { kind: 'compose', reply }
  if (reply.status === 'pending_approval') return { kind: 'pending', reply }
  if (reply.status === 'approved') return { kind: 'approved', reply }
  // A google_sync mirror is always provider-published and read-only here —
  // never the compose box, never actions (editing is a future feature).
  if (reply.source === 'google_sync') return { kind: 'mirror', reply }
  if (reply.status === 'published') return { kind: 'published', reply }
  if (reply.status === 'publish_failed') {
    // One kind for every ambiguous-descended reply, whether the automatic read
    // ladder still runs (`reconcileDueAt` set) or has ended: both offer only
    // Check. The presenter (`reply-message-view.ts`) splits the words and tone.
    return reply.publicationState === 'ambiguous' ||
      reply.publicationLastErrorClass === 'ambiguous'
      ? { kind: 'failed-check', reply }
      : { kind: 'failed-retry', reply }
  }
  if (reply.status === 'rejected') return { kind: 'rejected', reply }
  return { kind: 'none' }
}

type ReplyStatusViewProps = Readonly<{
  propertyId: string
  view: ResolvedReplyView
  editTarget: ReplyEditTarget
  /**
   * A bumped counter, not a flag: "the pane was asked to put the caret in the
   * composer". `0` means never asked. A flag fires its effect only on the
   * rising edge, which would let `r` work exactly once per pane; a counter can
   * be raised again from the same state.
   *
   * Only the composer needs telling. It is also what an item with a plain
   * draft opens on, and stealing focus on every change of selection would be
   * its own defect. Reopening a rejected reply lands here rather than in an
   * editor of its own — the drafted reply re-resolves the view to `compose`
   * first — so this is also what keeps Edit & resubmit from dropping focus on
   * `<body>` when the button it was on unmounts.
   */
  caretRequest: number
  isSaving: boolean
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  reviewLanguageReadiness: ReviewLanguageReadiness
  onSaveDraft: (
    text: string,
    provenanceToken?: string,
    replyLanguageTag?: string,
  ) => Promise<unknown>
  onSubmitReply: () => Promise<unknown>
  onDeleteDraft: (() => Promise<unknown>) | undefined
  onSaveEdit: (text: string) => Promise<unknown>
  /** The editor closed itself — saved or cancelled. Clears the edit target. */
  onEditDone: () => void
  onGenerateSuggestion?: ReplySuggestionGenerate
  onListTemplates: NonNullable<ReplyComposeProps['onListTemplates']>
  onLoadTemplate: NonNullable<ReplyComposeProps['onLoadTemplate']>
}>

/** Renders the reply's writable surface: the composer, or an open editor. */
export function ReplyStatusView({
  propertyId,
  view,
  editTarget,
  caretRequest,
  isSaving,
  propertyDefaultReplyLanguage,
  reviewReplyLanguage,
  reviewLanguageReadiness,
  onSaveDraft,
  onSubmitReply,
  onDeleteDraft,
  onSaveEdit,
  onEditDone,
  onGenerateSuggestion,
  onListTemplates,
  onLoadTemplate,
}: ReplyStatusViewProps) {
  const composeRef = useRef<HTMLDivElement>(null)
  /**
   * The counter variant of `useEditorOpenFocus` (`reply-editor-views.tsx`),
   * which the published editor still uses for its own mount.
   *
   * The focus itself goes through `putCaretIn`, which moves region 4's own
   * scroller and refuses to touch anything above it. It used to be
   * `focus({ preventScroll: true })` followed by `field.scrollIntoView({ block:
   * 'nearest' })`, and that second call scrolled the wrong box: it walks every
   * scrollable ancestor, an `overflow: hidden` box is still programmatically
   * scrollable, and the pane's column is exactly that — so asking for the caret
   * scrolled the header and the case strip out of the pane for good.
   */
  useEffect(() => {
    if (caretRequest === 0) return
    const field = composeRef.current?.querySelector('textarea')
    if (field) putCaretIn(field)
  }, [caretRequest])
  const languageProps = {
    propertyDefaultReplyLanguage,
    reviewReplyLanguage,
    reviewLanguageReadiness,
  }
  switch (view.kind) {
    case 'compose':
      return (
        // The classes are not decoration: this wrapper exists only to hold the
        // ref above, and an unclassed `div` is a BLOCK box with
        // `min-height: auto`, which a flex item cannot shrink below its
        // content. Dropped into region 4's chain it was the one link that
        // refused to give, so the composer's own scroller never absorbed
        // anything and `Submit for approval` was pushed out of the region:
        // measured at 390x844 with the language-readiness alert showing (an
        // alert plan v2.1 row 18 has since folded into the assist menus), the
        // primary sat 46-90 px BELOW the fold. `flex min-h-0 grow basis-auto
        // flex-col` makes the wrapper transparent to the chain — the same four
        // utilities `ReplyCompose`'s own root carries, for the same reason.
        <div ref={composeRef} className="flex min-h-0 grow basis-auto flex-col">
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
            onListTemplates={onListTemplates}
            onLoadTemplate={onLoadTemplate}
          />
        </div>
      )
    // `published` is the ONLY state this editor opens on. `failed-retry` used
    // to share it, but `editPublishedReply` refuses any reply that is not
    // `published` and `REPLY_TRANSITIONS.publish_failed` has no `draft`, so no
    // server path exists today that changes the text of a publish-failed
    // reply. Try again is its whole action list.
    case 'published':
      return editTarget === 'published' ? (
        <ReplyPublishedEditor
          reply={view.reply}
          isSaving={isSaving}
          onSaveEdit={onSaveEdit}
          onClose={onEditDone}
        />
      ) : null
    // `rejected` has NO arm, and needs none. Reopening one is a real
    // `draftReplyFn` round trip whose cache patch lands before the pane hears
    // that it resolved, so a rejected reply is already a draft by the time any
    // surface could mount for it — the `compose` case above is what renders,
    // seeded from the refused text. The editor that used to stand here could
    // only ever have been reached by a render that does not happen.
    //
    // Every other state is read-only, and reads as a message in the thread.
    default:
      return null
  }
}
