import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { InboxCaseToolbar } from './inbox-case-toolbar'
import { buildInboxCaseToolbarProps, itemCommandFence } from './inbox-case-toolbar-props'
import { InboxReopenDialog } from './inbox-reopen-dialog'
import { offeredModes } from './composer-policy'
import { resolveReplyView } from './reply-status-view'
import { useReplyActions } from './use-reply-actions'
import { useOnDemandReviewAnalysis } from './use-on-demand-review-analysis'
import {
  useInboxComposerController,
  type ComposerFocusBox,
} from './use-inbox-composer-controller'
import { withFreshCommandRevision, type InboxDetailState } from './use-inbox-detail'
import type { InboxAssignmentOption } from './inbox-owner-view'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import type { NoteDraft } from './composer-policy'
import { DetailComposerRegion, DetailThreadRegion } from './inbox-detail-regions'
import { inboxDetailFeedbackPresentation } from './inbox-detail-feedback'
import type { InboxDetailFns } from './types'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

// `ReplyEditTarget` and `ComposerMode` are this pane's state and reach their
// consumers from here, but both are DECLARED beside the control that reads them
// (`reply-status-view.tsx`, `composer-mode-row.tsx`) so the module graph keeps
// pointing downward rather than back up at the pane.
export type { ReplyEditTarget } from './reply-status-view'
export type { ComposerMode } from './reply-composer'

/** How the page's `r` / `n` shortcuts reach this pane's composer. */
export type { ComposerFocusBox } from './use-inbox-composer-controller'

export type DetailContentProps = Readonly<{
  currentItem: InboxItem
  /**
   * The pane's server state and its six item commands, as ONE prop.
   *
   * Ten of these used to be spelled out individually — `detail`, `notes`, the
   * two cache callbacks and all six commands — and both callers
   * (`inbox-detail-panel.tsx`, `inbox-detail-sheet.tsx`) hand-copied the same
   * ten lines off the object they already held, so adding a seventh command
   * meant editing three files identically. `notesUnavailable` would have been
   * the eleventh. The prop types even spelled
   * themselves as `InboxDetailState['updateStatus']`, which is the object
   * admitting it was the real unit.
   *
   * `currentItem` stays separate on purpose: the panel supplies its own
   * non-null fallback item while the state's is `InboxItem | null`.
   */
  detailState: InboxDetailState
  detailFns: InboxDetailFns
  /**
   * The signed-in viewer. The toolbar's owner control reads `name` for the
   * viewer's own initials (plan v2.1 row 4); the thread still takes only the id
   * (`note-message.tsx` says `You` by comparing it), so it gets
   * `currentUser?.id` below rather than a second prop threaded from the page.
   */
  currentUser?: InboxCurrentUser
  assignmentOptions?: ReadonlyArray<InboxAssignmentOption>
  /**
   * Filled in with this pane's "set the mode and take the caret" callback while
   * it is mounted. The `r` / `n` shortcuts are bound on `window` by the page,
   * which is above the pane and cannot reach `mode` — and the pane is below the
   * page, so it cannot reach the binding. A box passed down and written from
   * here is the shorter of the two wires, and it re-subscribes nothing.
   */
  composerFocusRef?: ComposerFocusBox
}>

/**
 * Regions 2, 3 and 4 of the pane: the case toolbar, the thread's scroller, and
 * the pinned composer as a sibling below it. The panel and the sheet supply
 * region 1 (the header) and the bounded flex column all three sit in —
 * `overflow-hidden` there, `shrink-0` on the toolbar and the composer,
 * `min-h-0 flex-1` on the scroller, so the composer can never be pushed out of
 * the column. The composer bounds itself at a share of the column and scrolls
 * inside that (`reply-composer.tsx`), so the column's own content never
 * exceeds it: nothing can scroll the header or the toolbar out of the pane.
 */
export function InboxDetailContent({
  currentItem,
  detailState,
  detailFns,
  currentUser,
  assignmentOptions = [],
  composerFocusRef,
}: DetailContentProps) {
  const {
    detail,
    notes,
    notesUnavailable,
    onNoteAdded,
    onReplyMutated,
    updateStatus,
    escalate,
    resolveEscalation,
    assign,
    markFeedbackHandled,
    correctFeedbackHandlingOutcome,
  } = detailState
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  useOnDemandReviewAnalysis({
    item: currentItem,
    detail,
    request: detailFns.requestReviewAnalysisNow,
  })
  const [reopenOpen, setReopenOpen] = useState(false)
  /**
   * The half-typed internal note, and the item it was typed about.
   *
   * It lives HERE, above the composer's mode switch. That switch no longer
   * destroys the form — both panels are force-mounted now, which is the fix for
   * the reply half of the same defect — but the form is still keyed by item, so
   * this is what carries a note across a change of selection and back. The form
   * owns the live value while it is mounted; this is what it seeds from, so the
   * cost is one pane render per keystroke and no more.
   */
  const [noteDraft, setNoteDraft] = useState<NoteDraft>({
    itemId: currentItem.id,
    text: '',
  })
  const canManageReplies = can('reply.manage')
  const canAddNotes = can('inbox.write')
  const modes = offeredModes(
    currentItem.sourceType === 'review' && canManageReplies,
    canAddNotes,
  )
  // The reopen dialog's fence. The toolbar's own commands are fenced, and
  // locked on all six item commands, inside `buildInboxCaseToolbarProps` —
  // the one spelling of both, unit-tested in `inbox-case-toolbar-props.test.ts`.
  const expected = itemCommandFence(currentItem)
  // One reply command family for the whole pane — built HERE and passed to
  // both surfaces. The thread's message and the editor below it are co-mounted
  // whenever an editor is open, so a second `useReplyActions` would give them
  // two independent `isSaving` flags and let a write started in one surface
  // leave the other's buttons live on the same reply.
  const replyActions = useReplyActions({
    reviewId: currentItem.sourceId,
    onReplyChanged: onReplyMutated,
  })
  const reply = detail?.reply ?? null
  const replyView = resolveReplyView(reply)
  const {
    mode,
    setMode,
    edit,
    editTarget,
    setEdit,
    focusComposer,
    caretFor,
    threadReplyActions,
  } = useInboxComposerController({
    itemId: currentItem.id,
    modes,
    reply,
    replyKind: replyView.kind,
    replyActions,
    composerFocusRef,
  })

  /**
   * Region 4's primary for a feedback item (row 10), and the ONE expression
   * both halves of the region's accent are derived from.
   *
   * The guard is here rather than inside the component because the REGION
   * reads this prop for more than its contents: a non-null slot is what moves
   * the note form into its own scroller so the primary stays pinned at the
   * foot, and a component that renders nothing would buy that geometry for
   * every single-mode review composer too. `sourceType` as well as the state,
   * because the server null-gates `feedbackHandling` on the handling pair and
   * only for feedback items — stated where a reviewer can check it against
   * `modes`.
   *
   * `feedbackHandlingAction` decides whether there is a BUTTON here or only
   * the sentence a state with no action carries, and the note form's variant
   * reads the same answer off the same state.
   *
   * Only `correct` demotes `Add note`. A correction supersedes an outcome the
   * server has already accepted for this item, so that action is known to be
   * permitted and row 10's one-accent-on-the-action holds. `mark` is NOT known
   * to be permitted: `feedbackHandlingAction` reads the current cycle alone
   * (`status === 'open'`), while `handling-outcome-authority.ts` refuses an
   * outcome — forever, item-wide — once any cycle has closed as
   * `guest_withdrawn` or `source_ineligible`, and such an item can still
   * acquire a later open cycle. The refusal lands inside the write
   * transaction, after the dialog has collected an outcome and an internal
   * note, and the note is discarded with it. Painting that button as the
   * region's ONLY accent would be the pane steering every manager into the one
   * action it can never complete, so `Add note` — which always works — keeps
   * its own accent beside it. The real fix is a server field; it is recorded
   * in the plan's open questions.
   *
   * The permission pair is `inbox.write ∧ feedback.handle` —
   * `canHandleInboxSource`'s own conjunction (inbox-access.ts:36). Read here
   * as well as inside `FeedbackHandlingPrimary` because only the pane can see
   * both controls, and it cannot place the accent without knowing whether the
   * action is there to take it.
   */
  const feedback = inboxDetailFeedbackPresentation({
    item: currentItem,
    detail,
    canAddNotes,
    canHandleFeedback: can('feedback.handle'),
    markFeedbackHandled,
    correctFeedbackHandlingOutcome,
  })

  const addInboxNote = withFreshCommandRevision(
    queryClient,
    currentItem.id,
    detailFns.addInboxNote,
  )

  return (
    <>
      {/* Region 2 (plan v2.1 rows 2-6). The bag is built by a pure selector
          rather than inline: this file was at 296 of 300 counted lines, and row
          5 routes `escalate` / `resolveEscalation` here from the header. */}
      <InboxCaseToolbar
        {...buildInboxCaseToolbarProps({
          item: currentItem,
          detail,
          assignmentOptions,
          currentUser,
          onReopen: () => setReopenOpen(true),
          updateStatus,
          escalate,
          resolveEscalation,
          assign,
          markFeedbackHandled,
          correctFeedbackHandlingOutcome,
        })}
      />

      <DetailThreadRegion
        currentItem={currentItem}
        detail={detail}
        notes={notes}
        notesUnavailable={notesUnavailable}
        currentUserId={currentUser?.id}
        getInboxItemHistory={detailFns.getInboxItemHistory}
        replyActions={threadReplyActions}
        reopen={edit.reopen}
      />

      <DetailComposerRegion
        currentItem={currentItem}
        detail={detail}
        detailFns={detailFns}
        modes={modes}
        mode={mode}
        setMode={setMode}
        editTarget={editTarget}
        reopen={edit.reopen}
        replyView={replyView}
        replyActions={replyActions}
        noteDraft={noteDraft}
        setNoteDraft={setNoteDraft}
        onNoteAdded={onNoteAdded}
        addInboxNote={addInboxNote}
        canAddNotes={canAddNotes}
        handlingAction={feedback.action}
        feedbackPrimary={feedback.primary}
        focusComposer={focusComposer}
        caretFor={caretFor}
        onEditDone={() => setEdit(null)}
      />

      <InboxReopenDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        pending={updateStatus.isPending}
        onConfirm={({ reason, explanation }) =>
          updateStatus({
            data: {
              ...expected,
              status: 'open',
              reopenReason: reason,
              reopenExplanation: explanation,
            },
          })
        }
      />
    </>
  )
}
