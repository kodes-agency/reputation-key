import { Button } from '#/components/ui/button'
import { feedbackHandlingAction } from './feedback-handling-presentation'
import type { FeedbackHandlingState } from '#/contexts/inbox/application/public-api'
import type { ReactNode } from 'react'

type CloseReason = NonNullable<FeedbackHandlingState['closeReason']>

/**
 * The two close reasons for which there is no action, ever.
 *
 * `handling-outcome-authority.ts` refuses a manager outcome — and a manual
 * reopen — for any item that has ever closed a cycle as withdrawn or
 * ineligible, on the ground that recording one would fabricate evidence of
 * human judgement that never happened. So this is not a state waiting for a
 * button; it is a state whose button can never exist, and the blank where it
 * would be needs a reason or it reads as a bug.
 *
 * `source_ineligible` no longer falls through to the generic sentence, which
 * ends `Reopen it if more follow-up is needed` — advice the server refuses for
 * exactly these two reasons. That was a bug in the deleted card, ported no
 * further.
 *
 * The withdrawn sentence is verbatim: `inbox-handling-cycle.spec.ts:369-377`
 * asserts it, and it is the one true thing to say about that state.
 */
const PERMANENT_NO_OUTCOME_SENTENCES: Readonly<Partial<Record<CloseReason, string>>> = {
  guest_withdrawn:
    'This feedback was withdrawn by the guest. No manager outcome was recorded.',
  source_ineligible:
    'This feedback is no longer available. No manager outcome can be recorded.',
}

/**
 * Closed with no outcome for a reason that does not forbid one — a cycle
 * superseded by a newer guest submission, or a close this client does not know
 * the word for. Reopening is genuinely the way forward here.
 *
 * The caveat a reviewer should know: `closeReason` is the CURRENT cycle's
 * latest close transition, while the refusal above scans EVERY cycle of the
 * item (`selectSourceUnavailableCloseReasons` is unbounded by cycle on
 * purpose). An item withdrawn in cycle 1 whose cycle 2 closed as superseded
 * therefore reads this sentence and is still refused a reopen. Fixing that
 * needs the server to carry the item-wide list; the client cannot derive it.
 */
const CLOSED_WITHOUT_OUTCOME =
  'This feedback is closed without a manager outcome. Reopen it if more follow-up is needed.'

const noOutcomeSentence = (closeReason: FeedbackHandlingState['closeReason']): string =>
  (closeReason === null ? undefined : PERMANENT_NO_OUTCOME_SENTENCES[closeReason]) ??
  CLOSED_WITHOUT_OUTCOME

/**
 * The action, at the foot of region 4 and right-aligned under the note form's
 * own submit, so the two read as one column of controls.
 *
 * `variant="default"` — row 10's word "primary", literally. This is the action
 * the manager opened the item to take. Whether `Add note` is demoted to
 * `outline` beside it is NOT this file's call: `InboxNotesThread` is shared
 * with review items, where the note submit is the only action in note mode and
 * must stay the accent. So the host that pairs the two nodes decides, off the
 * same `feedbackHandlingAction` predicate this file branches on — see
 * `inbox-detail-content.tsx`, which demotes for `correct` only. `mark` is
 * offered off the CURRENT cycle while the server's refusal scans every cycle
 * of the item (the caveat on `CLOSED_WITHOUT_OUTCOME` above, from the other
 * side), so it can be an action that is refused every time it is taken, and
 * the host will not let such an action hold the region's only accent. A state
 * with no action below leaves `Add note` primary for the plainer reason that
 * there is nothing else for the accent to be.
 *
 * `max-md:h-9` is row 20's 36 px control height over `size="sm"`'s 32 — the
 * height of the note form's `Add note` directly above it (a default-size
 * `Button`, `inbox-notes-thread.tsx`) and of the reply footer's controls
 * (`reply-composer-footer.tsx`), so region 4's column of controls keeps one
 * height. v1's row 15 had made it 44 (`max-md:h-11`), which on a feedback item
 * put a 44 px primary under a 36 px `Add note`. Measured in Chromium against
 * Storybook dev (`inbox-mobile-390--feedback-open`) at 390 and 320: 44 px tall
 * before, 36 after.
 */
function ActionFoot({
  label,
  onClick,
}: Readonly<{ label: string; onClick: () => void }>): ReactNode {
  return (
    <div className="flex shrink-0 justify-end">
      <Button size="sm" variant="default" className="max-md:h-9" onClick={onClick}>
        {label}
      </Button>
    </div>
  )
}

type Props = Readonly<{
  state: FeedbackHandlingState
  canHandle: boolean
  onMark: () => void
  onCorrect: () => void
}>

/**
 * What a handling cycle offers, as one node at the foot of the composer.
 *
 * This was the body of a bordered section with an icon band, a heading, a
 * subtitle and a badge — the last of finding 1's six section grammars. All of
 * that chrome is gone and what it held is redistributed: the badge is the case
 * strip's status chip, and the `Current outcome` box and the `Outcome history`
 * list are `handling_outcome` rows in the thread, where they interleave with
 * the assignment and escalation events that happened around them instead of
 * duplicating them in a side list. The card's subtitle ("Record the manager
 * outcome while keeping the guest's rating unchanged.") is deleted rather than
 * moved: it explained the card to itself, the button's verb carries the first
 * half, and the dialog's own description carries the rest at the moment it
 * matters. Row 8's rule is that explanations render by exception.
 *
 * What is left is four states and, by exception, the one sentence a state needs
 * when it has no action. Which action a state offers is `feedbackHandlingAction`
 * and lives next door, because the host that pairs this node with the note form
 * has to ask the same question to place the region's accent; the branch order
 * and the reason it is load-bearing are documented there.
 */
export function FeedbackHandlingBody({
  state,
  canHandle,
  onMark,
  onCorrect,
}: Props): ReactNode {
  // No permission, no foot at all — not a disabled button, and not an
  // explanation of an affordance this reader never had (row 8). Production
  // cannot reach this: the server null-gates `detail.feedbackHandling` on the
  // same permission pair, so a caller without it arrives with no state and the
  // pane passes no slot. A Storybook fixture can, and there the region still
  // takes its own scroller — the slot is a non-null node whichever way this
  // returns, and the alternative is a third copy of the permission rule in the
  // pane. Harmless: a scroller with nothing below it to protect.
  if (!canHandle) return null

  const action = feedbackHandlingAction(state)
  if (action === 'mark') {
    return <ActionFoot label="Mark as handled" onClick={onMark} />
  }

  if (action === 'correct') {
    return <ActionFoot label="Correct outcome" onClick={onCorrect} />
  }

  return (
    <p className="shrink-0 text-xs leading-5 text-muted-foreground">
      {noOutcomeSentence(state.closeReason)}
    </p>
  )
}
