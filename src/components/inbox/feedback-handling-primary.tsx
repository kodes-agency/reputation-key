// Inbox detail — the feedback item's primary, and the dialog behind it.
//
// This is the stateful half of what `feedback-handling-card.tsx` used to be.
// The card is deleted (row 10): its badge is the case strip's status chip, its
// outcome record is a `handling_outcome` thread event, and the action it hosted
// is region 4's `singleModePrimarySlot`. What has no other home is the wiring —
// which dialog is open, which of the two commands a decision routes to, and the
// permission pair that decides whether there is an action at all — so it lives
// here rather than in `inbox-detail-content.tsx`, which is already the pane's
// orchestrator and is within ten lines of the 300-line gate.

import { useState } from 'react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { FeedbackHandlingBody } from './feedback-handling-body'
import {
  FeedbackHandlingDialog,
  type FeedbackHandlingDecision,
} from './feedback-handling-dialog'
import {
  submitFeedbackHandlingDecision,
  type FeedbackHandlingDialogMode,
} from './feedback-handling-submit'
import type {
  FeedbackHandlingState,
  InboxItem,
} from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'
import type { ReactNode } from 'react'

type Props = Readonly<{
  item: InboxItem
  state: FeedbackHandlingState
  markFeedbackHandled: InboxDetailState['markFeedbackHandled']
  correctFeedbackHandlingOutcome: InboxDetailState['correctFeedbackHandlingOutcome']
}>

/**
 * Region 4's primary for a private-feedback item: `Mark as handled` on an open
 * cycle, `Correct outcome` on a handled one, and the existing dialog for both.
 *
 * The composer is note-only for these items, and the note form's submit files a
 * NOTE — nothing in the region acts on the item. That is the whole reason the
 * region takes a primary from a slot at all, and why this component is mounted
 * inside it rather than in the thread: the action belongs where the manager is
 * already working, not in a section of its own halfway up the scroller.
 *
 * Nothing about the two commands changes here. `submitFeedbackHandlingDecision`
 * is reused verbatim, so both still carry the four revisions the caller
 * observed (and a correction the two that pin the fact it supersedes), and both
 * still go to `useFeedbackHandlingMutations` WITHOUT
 * `withFreshCommandRevision`: a handling outcome is a decision about an exact
 * cycle, so a conflict is a visible refusal rather than a replay against a
 * newer state. Wrapping them to match the reply and status commands would be a
 * correctness regression, not a consistency fix.
 */
export function FeedbackHandlingPrimary({
  item,
  state,
  markFeedbackHandled,
  correctFeedbackHandlingOutcome,
}: Props): ReactNode {
  const { can } = usePermissions()
  const [dialogMode, setDialogMode] = useState<FeedbackHandlingDialogMode>(null)
  const current = state.currentOutcome
  // The client half of the pair the server enforces at four layers. It is
  // redundant by construction — `detail.feedbackHandling` is null for anyone
  // without both permissions on this property, so a read-only caller arrives
  // with no state and this component is never rendered — but it is the local
  // one, and a Storybook fixture or a future caller that hands over state it
  // was given for another purpose would otherwise paint an action the server
  // refuses. Both permissions, not either: `canHandleInboxSource` is an AND.
  const canHandle = can('inbox.write') && can('feedback.handle')
  const isCorrection = dialogMode === 'correct'
  const mutation = isCorrection ? correctFeedbackHandlingOutcome : markFeedbackHandled

  const confirm = (decision: FeedbackHandlingDecision) =>
    submitFeedbackHandlingDecision({
      mode: dialogMode,
      item,
      state,
      decision,
      markFeedbackHandled,
      correctFeedbackHandlingOutcome,
    })

  return (
    <>
      <FeedbackHandlingBody
        state={state}
        canHandle={canHandle}
        onMark={() => setDialogMode('mark')}
        onCorrect={() => setDialogMode('correct')}
      />

      {dialogMode ? (
        // The key is load-bearing and is the card's verbatim: it remounts the
        // dialog, which is what resets the TanStack Form defaults between a
        // mark and a correction, and between two successive corrections.
        // Without it the second correction opens with the first one's outcome
        // still selected. The dialog itself is portalled, so it is unaffected
        // by the region's own scroller and clipping.
        <FeedbackHandlingDialog
          key={`${dialogMode}-${current?.id ?? 'open'}`}
          mode={dialogMode}
          open
          onOpenChange={(open) => {
            if (!open) setDialogMode(null)
          }}
          initialOutcome={isCorrection ? current?.outcome : undefined}
          initialNote={isCorrection ? current?.internalNote : null}
          mutation={mutation}
          onConfirm={confirm}
        />
      ) : null}
    </>
  )
}
