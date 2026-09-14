import type {
  FeedbackHandlingState,
  InboxItem,
  PrivateFeedbackHandlingOutcome,
} from '#/contexts/inbox/application/public-api'

const OUTCOME_LABELS = {
  follow_up_completed: 'Follow-up completed',
  follow_up_attempted: 'Follow-up attempted',
  handled_with_team: 'Handled with the team',
  reviewed_no_additional_step: 'Reviewed — no additional step',
  content_concern_reviewed: 'Content concern reviewed',
} as const satisfies Readonly<Record<PrivateFeedbackHandlingOutcome, string>>

/**
 * The label for one controlled outcome, or `undefined` for a value this build
 * has no word for.
 *
 * `outcome` reaches the client as an unvalidated cast out of a `varchar`
 * column — in the detail bundle's `currentOutcome` exactly as in every history
 * row — so a union widened server-side arrives in a manager's cached bundle
 * with no client deploy and this index misses. The declared return used to be
 * `string`, which is a lie `noUncheckedIndexedAccess` being off lets
 * TypeScript keep: it made the one caller that guards look redundant and the
 * one that did not look correct. Each caller decides what to print instead;
 * both are in this file.
 */
export const feedbackHandlingOutcomeLabel = (
  outcome: PrivateFeedbackHandlingOutcome,
): string | undefined =>
  // Own properties only: `OUTCOME_LABELS['constructor']` is a function, and the
  // callers' `undefined` check is the whole of their unknown-outcome guard.
  Object.hasOwn(OUTCOME_LABELS, outcome) ? OUTCOME_LABELS[outcome] : undefined

/**
 * Which action, if any, a handling cycle offers — the one place that decides it.
 *
 * `feedback-handling-body.tsx` renders it, and the host that pairs that node
 * with the note form reads it to place the region's accents
 * (`inbox-detail-content.tsx`). Those readers must never disagree, which is why
 * this is a shared predicate and not an `if` in each of them.
 *
 * Offering an action and TAKING the region's only accent are two different
 * questions, and only `correct` answers both. A correction supersedes an
 * outcome the server has already accepted for this item, so it is known to be
 * permitted. `mark` is not: this function reads the current cycle alone
 * (`status === 'open'`), while `handling-outcome-authority.ts` refuses an
 * outcome forever, ITEM-wide, once any cycle has closed as `guest_withdrawn` or
 * `source_ineligible` — and such an item can still acquire a later open cycle.
 * So `mark` can be an action refused every time it is taken, and the host
 * leaves `Add note` its own accent beside it rather than steering every manager
 * into the one button that cannot complete. The split is the host's; this
 * function only says which action exists.
 *
 * Branch order is load-bearing and is the deleted card's, unchanged. `open`
 * first: a reopened cycle carries no outcome of its own (history is scoped to
 * `head.currentCycleNumber`, feedback-handling.store.ts:294), so `mark` is the
 * only honest offer there. Then a recorded outcome, because a correction can
 * only supersede one — `submitFeedbackHandlingDecision` resolves silently with
 * no `currentOutcome` to pin. Everything left is a close that carries no
 * outcome, and `null` is the answer the caller explains by exception.
 */
export const feedbackHandlingAction = (
  state: FeedbackHandlingState,
): 'mark' | 'correct' | null => {
  if (state.status === 'open') return 'mark'
  return state.currentOutcome ? 'correct' : null
}

type HandlingCloseReason = NonNullable<FeedbackHandlingState['closeReason']>

/**
 * The two closes after which no manager outcome can ever exist.
 *
 * `domain/handling-outcome-authority.ts` refuses both a manager outcome and a
 * manual reopen for them forever (`SOURCE_UNAVAILABLE_CLOSE_REASONS`), on the
 * ground that recording one would fabricate evidence of human judgement that
 * never happened. Components may not import `inbox/domain`, so the two words
 * are re-spelled here, as `feedback-handling-body.tsx` already re-spells them
 * for its own sentences. `satisfies` is what keeps the copies honest: a rename
 * in the close-reason union fails the build here instead of silently matching
 * nothing and quietly restoring the wrong word to the chip.
 */
const PERMANENTLY_UNHANDLEABLE_CLOSES = [
  'guest_withdrawn',
  'source_ineligible',
] as const satisfies ReadonlyArray<HandlingCloseReason>

/**
 * Whether THIS cycle's own close is one the domain refuses an outcome for.
 *
 * Recognition, never permission. `closeReason` is the current cycle's latest
 * close transition, while the server's refusal scans every close reason ever
 * recorded against the item (`selectSourceUnavailableCloseReasons` is unbounded
 * by cycle on purpose). `false` therefore means "this client cannot tell", not
 * "an outcome is permitted": an item withdrawn in cycle 1 whose cycle 2 closed
 * as superseded answers `false` here and is still refused by the server. Only
 * the server can carry the item-wide list, so the caller must read a `false`
 * as the absence of a recognised case and nothing more.
 */
const isPermanentlyUnhandleableClose = (
  closeReason: FeedbackHandlingState['closeReason'],
): boolean =>
  closeReason !== null &&
  PERMANENTLY_UNHANDLEABLE_CLOSES.some((reason) => reason === closeReason)

/**
 * The case strip's work-status chip for a private-feedback item (row 10):
 * `Needs attention` / `Handled · <outcome>` / `Closed — no outcome`.
 *
 * The outcome is `currentOutcome`, and `currentOutcome` is `history.at(-1)`
 * over the CURRENT cycle ordered by `outcomeRevision`
 * (`infrastructure/feedback-handling.store.ts:89-101, 225-243`). Both halves
 * matter. A correction SUPERSEDES rather than rewrites — it appends a fact
 * carrying `supersedesOutcomeId` and a higher revision — so the corrected
 * outcome is already what this reads and nothing has to walk `history`. And the
 * cycle scope is why a reopened item reads `Needs attention` again instead of
 * the outcome that closed cycle 1: cycle 2 arrives `open`, with an empty history
 * and a null `currentOutcome`, while the prior cycle's facts stay in Handling
 * History where the thread shows them.
 *
 * Four things leave a closed cycle without an outcome to name, and each has its
 * own honest word:
 *
 *  * the caller may READ private feedback but not HANDLE it, so the server
 *    withholds `feedbackHandling` entirely (`get-inbox-item-detail.ts:133-155`)
 *    and the open/handled word comes from `item.status` instead. This is the
 *    permission split PR 1 fixed by discriminating on `sourceType`, and it is
 *    why the fallback here is `itemStatus` and not a second `sourceType` test.
 *    There is no `closeReason` on that path to branch on, so it reads the bare
 *    `Handled` it always did — saying less, never something false;
 *  * the cycle closed as withdrawn or source-ineligible. The domain refuses a
 *    manager outcome for it FOREVER, so `Handled` would assert a judgement that
 *    can never exist — the very claim the deleted card was criticised for.
 *    That case reads `Closed — no outcome`;
 *  * the cycle closed with no outcome for some other reason — superseded by a
 *    newer guest submission, or a close this build has no word for. A reopen
 *    can still produce a real outcome there, so the honest word is `Handled`.
 *    It is NOT `Closed — no outcome`, because arriving here does not prove
 *    handling is permitted: see `isPermanentlyUnhandleableClose`;
 *  * an outcome IS recorded but its value is not in this build's union. That is
 *    the fourth case, and the one the enumeration used to omit while claiming
 *    `Handled · undefined` was unreachable. It is reachable —
 *    `feedbackHandlingOutcomeLabel` is a map index over a value cast straight
 *    out of `varchar` — and it renders into the chip's accessible name, not
 *    just its text. The outcome word is dropped; `Handled` is still true, and
 *    unlike a thread row the chip cannot fall silent, because the item is
 *    closed and the strip has to say so.
 */
export function feedbackHandlingStatusLabel(
  handling: FeedbackHandlingState | null,
  itemStatus: InboxItem['status'],
): string {
  // Handled-vs-open comes from the handling cycle when the caller may read it,
  // and from the item's own status when it is withheld.
  if ((handling?.status ?? itemStatus) !== 'closed') return 'Needs attention'

  const recorded = handling?.currentOutcome
  if (recorded) {
    // A recorded outcome is read out even on a cycle the domain would now
    // refuse: the judgement demonstrably happened, and the refusal only stops
    // new ones. Dropping it would hide a fact, not avoid asserting one.
    const outcome = feedbackHandlingOutcomeLabel(recorded.outcome)
    return outcome === undefined ? 'Handled' : `Handled · ${outcome}`
  }

  if (handling !== null && isPermanentlyUnhandleableClose(handling.closeReason)) {
    return 'Closed — no outcome'
  }
  return 'Handled'
}

/**
 * `FeedbackHandlingDeadlineResult` lives in `inbox/domain`, which components
 * may not import, and `application/public-api.ts` does not re-export it.
 * Indexing the state's own history is the one legal spelling (precedent:
 * `feedback-handling-body.tsx:5`, which indexes the same state type for the
 * close-reason union).
 */
export type FeedbackHandlingDeadlineResult =
  FeedbackHandlingState['history'][number]['deadlineResult']

// A quiet qualifier, never a verdict. `not_measured` is NOT a miss: it means
// the cycle carried no measured handling target at all — either no target row
// was written for it, or the row's `performanceEligibility` excluded it
// (`stopPrivateFeedbackTarget`, response-target.store.ts) — so the clause has
// to report the absence of a measurement rather than a failed one. 'timing
// result' is the phrase the correction dialog already uses for this field.
const DEADLINE_CLAUSES = {
  on_time: 'on time',
  late: 'late',
  not_measured: 'timing not measured',
} as const satisfies Readonly<Record<FeedbackHandlingDeadlineResult, string>>

/**
 * The three fields of a `handling_outcome` history entry that decide its
 * sentence. Deliberately structural and note-free: `internalNote` is absent —
 * not null — whenever the reader may not see it, and nothing about the
 * sentence may vary with it.
 */
export type FeedbackHandlingOutcomeEvent = Readonly<{
  outcome: PrivateFeedbackHandlingOutcome
  deadlineResult: FeedbackHandlingDeadlineResult
  /** Non-null when this entry replaces an earlier outcome: a correction. */
  supersedesOutcomeId: string | null
}>

export type FeedbackHandlingOutcomeEventPresentation = Readonly<{
  /** `Handled — <outcome>`, or `Outcome corrected — <outcome>` for a correction. */
  sentence: string
  /** The first completion's timing, in lower case. `null` on a correction. */
  deadlineClause: string | null
}>

/**
 * One `handling_outcome` entry as a past-tense event sentence.
 *
 * A correction preserves the first completion's instant AND its timing result
 * verbatim — `correctFeedbackHandlingOutcomeFact` spreads the previous fact and
 * re-pins `completionAt` and `deadlineResult` (domain/feedback-handling.ts) —
 * so only a first outcome may claim to have met or missed a deadline. Carrying
 * the clause onto a correction would assert a second, later completion that
 * never happened.
 *
 * `outcome` and `deadlineResult` are cast straight out of `varchar` columns by
 * the history repository, so a union widened server-side reaches a manager's
 * cached bundle without a client deploy. An unknown outcome is silence — the
 * caller drops the row rather than print `Handled — undefined` — while an
 * unknown timing result only drops the clause, because the outcome sentence is
 * still true without it.
 */
export function presentFeedbackHandlingOutcomeEvent(
  event: FeedbackHandlingOutcomeEvent,
): FeedbackHandlingOutcomeEventPresentation | null {
  const outcome = feedbackHandlingOutcomeLabel(event.outcome)
  if (!outcome) return null
  if (event.supersedesOutcomeId !== null) {
    return { sentence: `Outcome corrected — ${outcome}`, deadlineClause: null }
  }
  return {
    sentence: `Handled — ${outcome}`,
    deadlineClause: DEADLINE_CLAUSES[event.deadlineResult] ?? null,
  }
}
