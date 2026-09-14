import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { InboxCaseToolbar } from './inbox-case-toolbar'
import { buildInboxCaseToolbarProps, itemCommandFence } from './inbox-case-toolbar-props'
import { InboxNotesThread } from './inbox-notes-thread'
import { InboxReopenDialog } from './inbox-reopen-dialog'
import { InboxThread } from './inbox-thread'
import { reviewLanguageReadiness } from './reply-language-options'
import { ReplyComposer } from './reply-composer'
import { hasPendingComposerWork, liveEditTarget, offeredModes } from './composer-policy'
import { ReplyEditor } from './reply-form'
import { resolveReplyView } from './reply-status-view'
import { FeedbackHandlingPrimary } from './feedback-handling-primary'
import { feedbackHandlingAction } from './feedback-handling-presentation'
import { useReplyActions } from './use-reply-actions'
import { withFreshCommandRevision, type InboxDetailState } from './use-inbox-detail'
import type { ComposerMode } from './reply-composer'
import type { InboxAssignmentOption } from './inbox-owner-view'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import type { InboxReplyCacheChange } from './inbox-cache-policy'
import type { ReplyEditTarget } from './reply-status-view'
import type {
  CaretRequest,
  NoteDraft,
  ReopenState,
  ReplyEditState,
} from './composer-policy'
import type { ThreadReplyActions } from './inbox-thread'
import type { InboxDetailFns } from './types'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNoteView,
} from '#/contexts/inbox/application/public-api'

// `ReplyEditTarget` and `ComposerMode` are this pane's state and reach their
// consumers from here, but both are DECLARED beside the control that reads them
// (`reply-status-view.tsx`, `composer-mode-row.tsx`) so the module graph keeps
// pointing downward rather than back up at the pane.
export type { ReplyEditTarget } from './reply-status-view'
export type { ComposerMode } from './reply-composer'

/** How the page's `r` / `n` shortcuts reach this pane's composer. */
export type ComposerFocusBox = { current: ((mode: ComposerMode) => void) | null }

export type DetailContentProps = Readonly<{
  currentItem: InboxItem
  detail: InboxItemDetailResult | null
  notes: ReadonlyArray<InboxNoteView>
  onNoteAdded: (resultingCommandRevision: number) => void
  onReplyMutated: (change: InboxReplyCacheChange) => void
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
  updateStatus: InboxDetailState['updateStatus']
  escalate: InboxDetailState['escalate']
  resolveEscalation: InboxDetailState['resolveEscalation']
  assign: InboxDetailState['assign']
  markFeedbackHandled: InboxDetailState['markFeedbackHandled']
  correctFeedbackHandlingOutcome: InboxDetailState['correctFeedbackHandlingOutcome']
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
  detail,
  notes,
  onNoteAdded,
  onReplyMutated,
  detailFns,
  currentUser,
  assignmentOptions = [],
  composerFocusRef,
  updateStatus,
  escalate,
  resolveEscalation,
  assign,
  markFeedbackHandled,
  correctFeedbackHandlingOutcome,
}: DetailContentProps) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const [reopenOpen, setReopenOpen] = useState(false)
  const [replyEdit, setReplyEdit] = useState<ReplyEditState>({
    itemId: currentItem.id,
    target: null,
    reopen: 'idle',
  })
  /**
   * Which composer surface is on screen. Session state, deliberately NOT reset
   * per selection: it is a working preference, not a fact about the item, and
   * the composer's own `resolveMode` is what reconciles a mode the next item
   * does not offer (a feedback item is note-only).
   */
  const [mode, setMode] = useState<ComposerMode>('reply')
  /**
   * "Put the caret in this surface" — a bumped counter, not a flag, because
   * `r` and `n` have to be able to ask twice and an effect on a boolean only
   * fires on its rising edge. `seq: 0` is the initial "nobody has asked".
   */
  const [caret, setCaret] = useState<CaretRequest>({
    itemId: currentItem.id,
    mode: 'reply',
    seq: 0,
  })
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
  const replyView = resolveReplyView(detail?.reply ?? null)
  // A different item is a different reply: an open editor — or a failed reopen
  // — from the previous selection must never carry over to this one.
  const edit =
    replyEdit.itemId === currentItem.id
      ? replyEdit
      : ({ itemId: currentItem.id, target: null, reopen: 'idle' } as const)
  const editTarget = liveEditTarget(replyView.kind, edit.target)
  const setEdit = (target: ReplyEditTarget, reopen: ReopenState = 'idle') =>
    setReplyEdit({ itemId: currentItem.id, target, reopen })

  /**
   * Region 4's focus, as `r` and `n` need it: the mode and the caret move
   * together. A mode this item does not offer is refused here rather than
   * setting state nothing can render — the pane is the only place that knows
   * which surfaces exist, so the page binds both keys unconditionally.
   *
   * The second refusal mirrors the region's own: `reply-composer.tsx` drops
   * every mode switch while an edit is open, so that the pane's `mode` can
   * never disagree with what is on screen — but it can only drop the ones that
   * arrive through `onValueChange`. This writes `mode` directly, so without the
   * same check `n` during a live edit changed the pane's mode with nothing
   * visible happening, and then cancelling the edit dropped the manager into
   * the note form instead of back on the reply box.
   */
  const focusComposer = (next: ComposerMode) => {
    if (!modes.includes(next)) return
    if (editTarget !== null && next !== 'reply') return
    setMode(next)
    setCaret((previous) => ({
      itemId: currentItem.id,
      mode: next,
      seq: previous.seq + 1,
    }))
  }
  /** `0` for a surface that was not asked for — or asked for on another item. */
  const caretFor = (surface: ComposerMode) =>
    caret.itemId === currentItem.id && caret.mode === surface ? caret.seq : 0

  // Republished on every commit so the closure the shortcuts call can never
  // hold a stale `modes`. Two ref writes; nothing re-subscribes.
  useEffect(() => {
    if (!composerFocusRef) return
    composerFocusRef.current = focusComposer
    // Only ours: on the one commit where both surfaces exist, the second to
    // mount wins and the first must not null out its registration on the way
    // out. (`handleInboxShortcut` is mobile-dead, so in practice only the
    // desktop panel ever registers.)
    return () => {
      if (composerFocusRef.current === focusComposer) composerFocusRef.current = null
    }
  })

  /**
   * Edit & resubmit is a server round trip, not a local flip: `draftReplyFn` is
   * what moves the row out of `rejected`, and it legitimately rejects (409)
   * when an AI draft has gone stale. A silent failure would leave the reply
   * rejected and the next Submit would fail, so the failure is stated.
   *
   * Success raises no edit target. `useActionMutation` awaits its `onSuccess`
   * — the write-through cache patch that lands `status: 'draft'` — before
   * `mutateAsync` resolves, so by the time this `.then` runs the reply has
   * already re-resolved to `compose`. The composer IS the rejected reply's
   * editor, seeded from the refused text; all that is left to do is show it and
   * hand it the caret the unmounted Edit & resubmit button dropped.
   */
  const reopenRejectedReply = () => {
    const rejected = detail?.reply
    if (!rejected || rejected.kind === 'google_observation') return
    setEdit(null, 'pending')
    void replyActions
      .saveDraft(rejected.text, undefined, rejected.replyLanguageTag ?? undefined)
      .then(() => {
        setEdit(null)
        focusComposer('reply')
      })
      .catch(() => setEdit(null, 'failed'))
  }

  const threadReplyActions: ThreadReplyActions = {
    // The reopen draft is invisible to `isSaving` by design (an autosave must
    // never disable the action row), so its own flag joins it here.
    isSaving: replyActions.isSaving || edit.reopen === 'pending',
    // Edit reply is a disclosure, and the editor it discloses is a sibling of
    // the scroller the message sits in — the message cannot see it.
    isEditing: editTarget !== null,
    onApprove: replyActions.approve,
    onReject: replyActions.reject,
    onCheck: replyActions.check,
    onRetry: replyActions.retry,
    // Both raise the reply surface, so both move the composer to Reply mode.
    // The lock the region derives from `editTarget` would show it anyway, but
    // moving `mode` is what makes cancelling the edit land back on the reply
    // box instead of dropping the manager into the note form.
    onEditPublished: () => {
      setEdit('published')
      focusComposer('reply')
    },
    onEditRejected: reopenRejectedReply,
  }

  // The reply's writable surface. Every other state reads as a message in the
  // thread, so the region below it opens only for a draft or an open editor.
  const showReplyEditor = replyView.kind === 'compose' || editTarget !== null

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
  const handlingState =
    currentItem.sourceType === 'feedback' && canAddNotes && can('feedback.handle')
      ? (detail?.feedbackHandling ?? null)
      : null
  const handlingAction = handlingState ? feedbackHandlingAction(handlingState) : null
  const feedbackPrimary = handlingState ? (
    <FeedbackHandlingPrimary
      item={currentItem}
      state={handlingState}
      markFeedbackHandled={markFeedbackHandled}
      correctFeedbackHandlingOutcome={correctFeedbackHandlingOutcome}
    />
  ) : null

  /**
   * The notes themselves are messages in the thread; this is the write half,
   * region 4's Note mode.
   *
   * A mode switch no longer unmounts it: the composer's mode segment is a
   * Radix tab set, and both of its panels are force-mounted precisely so that
   * neither surface loses what is in it. `noteDraft` above that boundary is the
   * second line of defence, and the one that survives a change of selection.
   *
   * Still keyed by item, because the hoisted draft is not the only per-item
   * thing here: on a review→review change of selection React would otherwise
   * reuse the form instance and leave words typed about one item in a form now
   * fenced on the next one's id and revision.
   */
  const noteForm = (
    <InboxNotesThread
      key={currentItem.id}
      inboxItemId={currentItem.id}
      expectedCommandRevision={currentItem.commandRevision}
      onNoteAdded={onNoteAdded}
      addInboxNote={withFreshCommandRevision(
        queryClient,
        currentItem.id,
        detailFns.addInboxNote,
      )}
      canAdd={canAddNotes}
      draftText={noteDraft.itemId === currentItem.id ? noteDraft.text : ''}
      // Identity-checked, and the check has to be on `previous`: a filed note
      // clears the pane's copy from the form's `onSubmit`, which is a closure
      // frozen at the moment the form was last updated — so the `currentItem`
      // in scope here is the item the note was FILED against, not the one now
      // selected. Unconditional, that clear landed on a note half-typed about
      // whichever item the manager moved to while the request was in flight.
      onDraftChange={(text) =>
        setNoteDraft((previous) =>
          text === '' && previous.itemId !== currentItem.id
            ? previous
            : { itemId: currentItem.id, text },
        )
      }
      caretRequest={caretFor('note')}
      submitVariant={handlingAction === 'correct' ? 'outline' : 'default'}
    />
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-w-0 flex-col gap-6 p-5 lg:p-6">
          <InboxThread
            item={currentItem}
            detail={detail}
            notes={notes}
            currentUserId={currentUser?.id}
            getInboxItemHistory={detailFns.getInboxItemHistory}
            replyActions={threadReplyActions}
          />
          {edit.reopen === 'failed' ? (
            <p role="alert" className="text-xs text-destructive">
              The rejected reply could not be reopened.
            </p>
          ) : null}
        </div>
      </div>

      {/* Region 4, a SIBLING of the scroller rather than its last child: the
          composer is pinned and the thread scrolls under it. The region is
          mounted for the whole of an item the caller can write anything about,
          in every reply state — `showReplyEditor` gates the reply SLOT only, so
          a read-only reply never removes the `Internal note` control. */}
      {modes.length > 0 ? (
        <ReplyComposer
          mode={mode}
          onModeChange={setMode}
          modes={modes}
          hideUnavailableModesOnMobile={
            replyView.kind === 'mirror' || replyView.kind === 'published'
          }
          editTarget={editTarget}
          /**
           * Row 15's collapsed bar, passed unconditionally: the pane cannot
           * tell which surface it is in, and does not have to — the region
           * asks `useIsMobile()` itself, so this whole object is inert on the
           * desktop panel. The policy is `composer-policy.ts`; what is here
           * is only the four pieces of pane state it reads.
           */
          collapse={{
            itemId: currentItem.id,
            hasPendingWork: hasPendingComposerWork({
              itemId: currentItem.id,
              replyView,
              noteDraft,
              reopen: edit.reopen,
            }),
            onExpand: focusComposer,
          }}
          replySlot={
            showReplyEditor ? (
              <ReplyEditor
                key={currentItem.id}
                propertyId={currentItem.propertyId}
                reviewId={currentItem.sourceId}
                reply={detail?.reply ?? null}
                loading={!detail}
                propertyDefaultReplyLanguage={
                  detail?.propertyDefaultReplyLanguage ?? null
                }
                reviewReplyLanguage={detail?.reviewReplyLanguage ?? null}
                reviewLanguageReadiness={reviewLanguageReadiness(detail?.reviewText)}
                editTarget={editTarget}
                caretRequest={caretFor('reply')}
                actions={replyActions}
                onEditDone={() => setEdit(null)}
                generateReplySuggestion={detailFns.generateReplySuggestion}
              />
            ) : null
          }
          noteSlot={noteForm}
          singleModePrimarySlot={feedbackPrimary}
        />
      ) : null}

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
