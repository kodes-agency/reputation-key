// Inbox detail pane — a private-feedback item, end to end (plan row 10).
//
// Row 10's claim is that a feedback item is not a different pane: it is the
// SAME four regions, with two words swapped and one control moved. That is only
// observable where all four regions are mounted together, which is why these
// stories are pane-level and not one per component — the strip's chip, the
// thread's events and the composer's primary all read from ONE
// `feedbackHandling` state, and component stories that fed each of them its own
// fixture would stay green while the pane wired them to three different things.
//
// `feedback-handling-card.tsx` is deleted here, and its four parts went four
// ways: the badge became the strip chip, the outcome record became
// `handling_outcome` thread events, the action became region 4's
// `singleModePrimarySlot`, and the description was deleted outright. Every
// story below asserts the surviving half AND the absence of the card's own
// chrome, because "the action still works" and "the card is really gone" are
// two different regressions and only the first one fails loudly.
//
// The storybook Vitest project compiles NO Tailwind, so every utility class in
// the tree is inert. Nothing below reads geometry — only content, roles,
// accessible names, document order, behaviour, and `data-variant`, which is not
// a style but the one record of the single-primary rule left in the DOM.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { feedbackId, userId } from '#/shared/domain/ids'
import { FeedbackHandlingPrimary } from './feedback-handling-primary'
import { InboxDetailContent } from './inbox-detail-content'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { InboxHistoryEntry } from './inbox-thread-model'
import type { InboxDetailFns } from './types'
import type { InboxDetailState } from './use-inbox-detail'
import type { getActivityTimelineFn } from '#/contexts/feed/server/activity'
import type {
  addInboxNoteFn,
  getInboxItemDetailFn,
  getInboxItemHistoryFn,
} from '#/contexts/inbox/server/inbox'
import type {
  FeedbackHandlingState,
  InboxItem,
  InboxItemDetailResult,
  InboxNote,
  InboxNoteView,
} from '#/contexts/inbox/application/public-api'

// ─── the copy this PR is responsible for ─────────────────────────────────────

/** The strip chip's two words (row 10), spelled once. */
const NEEDS_ATTENTION = 'Needs attention'

/**
 * The two names the e2e journeys reach for. Neither may move or be renamed.
 *
 * TWO specs pin them, not three: `inbox-triage.spec.ts:183-184` and
 * `activity-notification-facts.spec.ts:168-169`. (The triage spec spells the
 * button `Add Note`; Playwright's name matching is case-insensitive, so it
 * still resolves — the rendered name is `Add note`.) The "three e2e specs"
 * figure repeated across this folder is stale; see the PR report.
 */
const NOTE_PLACEHOLDER = 'Add a note…'
const NOTE_SUBMIT = 'Add note'

/** Region 4's item action, by state. Both names are pinned by the e2e specs. */
const MARK = 'Mark as handled'
const CORRECT = 'Correct outcome'

/**
 * The deleted card's own chrome. Each of these was a visible string a manager
 * could read off the resting pane; none of them may come back, in any region.
 *
 * The description is the one part that was deleted rather than relocated: its
 * first clause is the button's own verb, and the rest — that the guest's rating
 * stays unchanged — belongs in the dialog that actually changes something, so
 * the resting surface carries no standing reassurance at all (row 8).
 */
const CARD_HEADING = 'Feedback handling'
const CARD_OUTCOME_BOX = 'Current outcome'
const CARD_OUTCOME_LIST = 'Outcome history'
const CARD_DESCRIPTION = /Record the manager outcome/i

/** The `feedback-handling-body.tsx` sentences, verbatim. */
const WITHDRAWN_SENTENCE =
  'This feedback was withdrawn by the guest. No manager outcome was recorded.'
const INELIGIBLE_SENTENCE =
  'This feedback is no longer available. No manager outcome can be recorded.'
const REOPENABLE_SENTENCE =
  'This feedback is closed without a manager outcome. Reopen it if more follow-up is needed.'
/**
 * The clause the reopenable sentence ends with, on its own. `source_ineligible`
 * used to fall through to it in the deleted card — advice
 * `assertManualReopenPermitted` refuses for exactly that reason — so the
 * ineligible story asserts this substring is absent rather than the whole
 * sentence: a future edit to the generic wording must not quietly make that
 * assertion vacuous.
 */
const REOPEN_ADVICE = 'Reopen it if more follow-up is needed'

// ─── fixtures ────────────────────────────────────────────────────────────────

const SOURCE_DATE = new Date('2026-03-01T09:00:00Z')
const FEEDBACK_COMMENT = 'The shower in room 402 ran cold for two mornings.'
const INTERNAL_NOTE = 'Called the guest; they accepted a partial refund.'
const TEAM_NOTE = 'Maintenance booked for Thursday morning.'
// One prefix for every opaque id in this file, so a single `not.toContain`
// covers every place one could leak: an actor, a note author, an outcome's
// recorder.
const ADA_ID = 'user-ada-1111'

type HistoryUserId = NonNullable<InboxHistoryEntry['actorUserId']>
type OutcomeFact = NonNullable<FeedbackHandlingState['currentOutcome']>
/**
 * `HandlingCycleCloseReason` lives in `inbox/domain`, which components may not
 * import, and `application/public-api.ts` does not re-export it. Narrowing the
 * state's own field is the one legal spelling, and the same one
 * `feedback-handling-body.tsx` uses for its sentence map.
 */
type CloseReason = NonNullable<FeedbackHandlingState['closeReason']>

/**
 * Private feedback carries no submitter name — the fleet fixture's default is
 * one, and clearing it is what the real detail read returns.
 */
const openItem: InboxItem = {
  ...makeInboxItem({ id: 'fb-pane', sourceType: 'feedback', status: 'open', rating: 2 }),
  sourceDate: SOURCE_DATE,
  reviewerName: null,
}
/**
 * The same item once its cycle closed. `item.status` matters independently of
 * `feedbackHandling.status`: the chip's WORD comes from the handling state when
 * the caller may read it, but whether the chip is a menu at all is decided by
 * the item — so a fixture that closed one and not the other would describe a
 * state the server cannot produce.
 */
const closedItem: InboxItem = { ...openItem, status: 'closed' }

function detailFor(
  item: InboxItem,
  feedbackHandling: FeedbackHandlingState | null,
): InboxItemDetailResult {
  return {
    item,
    reviewText: null,
    reviewTranslatedText: null,
    reviewerProfilePhotoUrl: null,
    reviewContentStatus: null,
    // A review's field; feedback's own number is `feedbackRatingValue` below.
    reviewRating: null,
    feedbackComment: FEEDBACK_COMMENT,
    feedbackRatingValue: 2,
    reply: null,
    analysis: null,
    feedbackHandling,
    responseTarget: null,
  }
}

function outcomeFact(over: Partial<OutcomeFact> = {}): OutcomeFact {
  return {
    id: 'outcome-1',
    inboxItemId: openItem.id,
    organizationId: openItem.organizationId,
    propertyId: openItem.propertyId,
    feedbackId: feedbackId('fb-pane'),
    cycleNumber: 1,
    sourceRevision: 1,
    outcomeRevision: 1,
    outcome: 'follow_up_completed',
    internalNote: null,
    recordedBy: userId(ADA_ID),
    recordedAt: new Date('2026-03-02T08:00:00Z'),
    completionAt: new Date('2026-03-02T08:00:00Z'),
    deadlineResult: 'on_time',
    supersedesOutcomeId: null,
    ...over,
  }
}

const FIRST_OUTCOME = outcomeFact()
/**
 * The correction, as `correctFeedbackHandlingOutcomeFact` builds it: a NEW fact
 * with a higher revision naming the one it supersedes, and the first
 * completion's instant and timing result re-pinned verbatim. Both of those
 * carry-overs are load-bearing below — they are why the corrected row may not
 * print a timing clause of its own.
 */
const CORRECTION = outcomeFact({
  id: 'outcome-2',
  outcomeRevision: 2,
  outcome: 'handled_with_team',
  supersedesOutcomeId: FIRST_OUTCOME.id,
  recordedAt: new Date('2026-03-03T08:00:00Z'),
  completionAt: FIRST_OUTCOME.completionAt,
  deadlineResult: FIRST_OUTCOME.deadlineResult,
})

const OPEN_CYCLE: FeedbackHandlingState = {
  cycleNumber: 1,
  sourceRevision: 1,
  stateRevision: 1,
  status: 'open',
  closeReason: null,
  currentOutcome: null,
  history: [],
}

/**
 * `currentOutcome` is `history.at(-1)` over the current cycle ordered by
 * `outcomeRevision`, so a correction is already what it points at — which is
 * the whole reason the strip chip needs no knowledge of corrections.
 */
const HANDLED_CYCLE: FeedbackHandlingState = {
  ...OPEN_CYCLE,
  stateRevision: 2,
  status: 'closed',
  closeReason: 'private_feedback_handled',
  currentOutcome: FIRST_OUTCOME,
  history: [FIRST_OUTCOME],
}

const CORRECTED_CYCLE: FeedbackHandlingState = {
  ...HANDLED_CYCLE,
  stateRevision: 3,
  currentOutcome: CORRECTION,
  history: [FIRST_OUTCOME, CORRECTION],
}

/**
 * An outcome this build has no word for, and the cast is the whole point.
 *
 * `outcome` reaches the client as an unvalidated cast out of a `varchar`
 * column — in the detail bundle's `currentOutcome` exactly as in every history
 * row — and the union is enforced only by a DB CHECK constraint. So a value
 * added server-side lands in a manager's cached bundle with no client deploy,
 * and this fixture is that Tuesday, not a hypothetical: the cast here is the
 * same one `inbox-history.repository.ts` performs for real.
 */
const WIDENED_OUTCOME = 'guest_compensated' as OutcomeFact['outcome']
const UNREADABLE_OUTCOME = outcomeFact({ outcome: WIDENED_OUTCOME })
const UNREADABLE_OUTCOME_CYCLE: FeedbackHandlingState = {
  ...HANDLED_CYCLE,
  currentOutcome: UNREADABLE_OUTCOME,
  history: [UNREADABLE_OUTCOME],
}

/** Closed with no manager outcome at all — the three states that have none. */
const closedWithNoOutcome = (closeReason: CloseReason): FeedbackHandlingState => ({
  ...OPEN_CYCLE,
  stateRevision: 2,
  status: 'closed',
  closeReason,
})

// ─── history ─────────────────────────────────────────────────────────────────

function historyEvent(
  at: string,
  detail: InboxHistoryEntry['detail'],
  over: Partial<InboxHistoryEntry> = {},
): InboxHistoryEntry {
  return {
    id: `hist-${detail.kind}-${at}`,
    inboxItemId: openItem.id,
    kind: detail.kind,
    occurredAt: new Date(at),
    cycleNumber: 1,
    stateRevision: 1,
    actorUserId: ADA_ID as HistoryUserId,
    actorDisplayName: 'Ada Lovelace',
    legacy: false,
    detail,
    ...over,
  }
}

/** A guest submission opens the cycle, so no manager acted and there is no actor. */
const OPENED_FROM_FEEDBACK = historyEvent(
  '2026-03-01T09:00:00Z',
  {
    kind: 'cycle_opened',
    openedReason: 'feedback_submitted',
    manualReopenReason: null,
    manualReopenExplanation: null,
    supersedesCycleNumber: null,
    sourceRevision: 1,
  },
  { actorUserId: null, actorDisplayName: null },
)

/**
 * The history row the server writes for an outcome fact.
 *
 * `internalNote` is OMITTED unless a note is passed — absent, not null, not
 * empty. That is what an unauthorized read returns AND what an authorized read
 * of a note-free outcome returns, which is the point: the two must be
 * indistinguishable in the markup.
 */
function outcomeEvent(
  at: string,
  fact: OutcomeFact,
  internalNote?: string,
): InboxHistoryEntry {
  return historyEvent(at, {
    kind: 'handling_outcome',
    outcome: fact.outcome,
    outcomeRevision: fact.outcomeRevision,
    deadlineResult: fact.deadlineResult,
    completionAt: fact.completionAt,
    supersedesOutcomeId: fact.supersedesOutcomeId,
    ...(internalNote === undefined ? {} : { internalNote }),
  })
}

const CLOSED_AS_HANDLED = historyEvent('2026-03-02T08:00:01Z', {
  kind: 'cycle_transition',
  transition: 'closed',
  transitionReason: 'private_feedback_handled',
  actorType: 'user',
})

const teamNote: InboxNoteView = {
  id: 'note-fb-1' as InboxNote['id'],
  inboxItemId: openItem.id,
  organizationId: openItem.organizationId,
  userId: userId(ADA_ID),
  displayName: 'Ada Lovelace',
  text: TEAM_NOTE,
  createdAt: new Date('2026-03-01T12:00:00Z'),
}

// ─── server fns and commands ─────────────────────────────────────────────────

function detailFns(entries: readonly InboxHistoryEntry[]): InboxDetailFns {
  return {
    // Never called by the pane — `detail` arrives as a prop — but a required
    // member of the bundle, so it answers honestly rather than throwing.
    getInboxItemDetail: mockServerFn(async () =>
      detailFor(openItem, OPEN_CYCLE),
    ) as unknown as typeof getInboxItemDetailFn,
    getActivityTimeline: mockServerFn(
      async () => [],
    ) as unknown as typeof getActivityTimelineFn,
    addInboxNote: mockServerFn(async () => ({
      ok: true,
    })) as unknown as typeof addInboxNoteFn,
    getInboxItemHistory: mockServerFn(
      async ({ data }: Parameters<typeof getInboxItemHistoryFn>[0]) => ({
        inboxItemId: data.inboxItemId,
        entries,
        truncated: false,
      }),
    ) as unknown as typeof getInboxItemHistoryFn,
  }
}

/**
 * The strip locks on `isHeaderCommandPending`, which reads all six item
 * commands on first render, so every one is a required arg — a story that omits
 * one throws before any markup exists. None is ever driven: the stories open
 * the dialog and stop, because what the dialog does with a decision belongs to
 * `feedback-handling-submit.ts` and to `inbox-handling-cycle.spec.ts`.
 */
function idleCommand<T>(result: T) {
  return Object.assign(async (_input: unknown) => result, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })
}

const refuses = Object.assign(
  async (_input: unknown) => {
    throw new Error('Story action only')
  },
  { isPending: false, error: null, isSuccess: false, data: null },
)

const commands = {
  updateStatus: idleCommand(openItem) as unknown as InboxDetailState['updateStatus'],
  escalate: idleCommand(openItem) as unknown as InboxDetailState['escalate'],
  resolveEscalation: idleCommand(
    openItem,
  ) as unknown as InboxDetailState['resolveEscalation'],
  assign: idleCommand(openItem) as unknown as InboxDetailState['assign'],
  markFeedbackHandled: refuses as unknown as InboxDetailState['markFeedbackHandled'],
  correctFeedbackHandlingOutcome:
    refuses as unknown as InboxDetailState['correctFeedbackHandlingOutcome'],
} as const

// ─── assertion helpers ───────────────────────────────────────────────────────

type Canvas = ReturnType<typeof within>

/**
 * Region 4, derived rather than guessed.
 *
 * The region has no accessible name of its own — deleting the card's
 * `<h2 id="feedback-handling-title">` removed the one label in the
 * neighbourhood, and a single-mode composer has no `tablist` either — so it
 * cannot be found by role. It CAN be found by what it must contain: the note
 * form's submit and the item action. Their nearest common ancestor is the
 * region's own column, and the two assertions below make that derivation safe
 * in both directions — over-climbing into the pane would pull the thread in, so
 * no message may be inside; under-climbing would land in the note form, so the
 * action must be. A utility class would have been shorter and wrong twice: this
 * project compiles no Tailwind, and a class is not a contract.
 */
function composerRegion(canvasElement: HTMLElement, actionName: string): HTMLElement {
  const canvas = within(canvasElement)
  const action = canvas.getByRole('button', { name: actionName })
  let node = canvas.getByRole('button', { name: NOTE_SUBMIT }).parentElement
  while (node !== null && !node.contains(action)) node = node.parentElement
  expect(node).not.toBeNull()
  const region = node as HTMLElement
  expect(region).toContainElement(action)
  // Tight: no thread message is inside it, so "one primary in the region" below
  // is a claim about region 4 and not about the whole pane.
  expect(region.querySelector('[role="article"]')).toBeNull()
  return region
}

/**
 * Every accent inside the composer region, by name and in document order —
 * finding 4's rule, and the thing PR 5 could most easily break by putting the
 * item action under the note form. The hidden-panel filter is
 * `reply-composer.stories.tsx`'s verbatim, and is inert for a feedback item,
 * which renders no `tabs-content` at all.
 *
 * The COUNT and the NAMES are both invariants, and the order is the composer's
 * own: the note slot is rendered before `singleModePrimarySlot`
 * (`reply-composer.tsx:232-239`), so `Add note` always precedes the item
 * action. A caller that passes both names is claiming the region has exactly
 * two accents and that these are they — not merely that its one favourite is
 * among them.
 *
 * Which controls are accented is decided by state, in three groups:
 *
 *   * `correct` — ONE accent, on the action. A correction supersedes an
 *     outcome the server has already accepted for this item, so the action is
 *     known to be permitted and `Add note` is demoted to `outline` beside it;
 *   * `mark` — TWO. `feedbackHandlingAction` reads the current cycle alone,
 *     while `handling-outcome-authority.ts` refuses an outcome forever and
 *     item-wide once any cycle closed as `guest_withdrawn` or
 *     `source_ineligible`, and such an item can still acquire a later open
 *     cycle. `Mark as handled` can therefore be refused every time it is taken
 *     — after the dialog has collected an outcome and an internal note, which
 *     are discarded with the refusal — so it does not get to be the only thing
 *     in the region worth pressing. `Add note`, which always works, keeps its
 *     own accent beside it;
 *   * no action at all (withdrawn, ineligible, closed with no outcome, or a
 *     reader without the permission pair) — ONE, on the note submit, for the
 *     plainer reason that there is nothing else for the accent to be.
 *
 * `region` is `composerRegion`'s derivation where there is an item action to
 * derive it from, and the whole pane where there is not. The pane is a SUPERSET
 * claim and it holds for a feedback item by construction: the strip's chips are
 * `secondary` badges and buttons, the thread carries no controls at all, and a
 * feedback item has no reply surface — so region 4 is the only place an accent
 * can come from either way.
 */
function expectAccents(region: HTMLElement, names: readonly string[]): void {
  const primaries = Array.from(
    region.querySelectorAll('button[data-variant="default"]'),
  ).filter((button) => button.closest('[data-slot="tabs-content"][hidden]') === null)
  expect(primaries).toHaveLength(names.length)
  names.forEach((name, index) => {
    expect(primaries[index]).toHaveAccessibleName(name)
    expect(primaries[index]).toBeVisible()
  })
}

/** The states where one control holds the region's whole accent. */
function expectSolePrimary(region: HTMLElement, name: string): void {
  expectAccents(region, [name])
}

/**
 * The four regions, all of them, in every state below — row 10's actual claim,
 * and the assertion that would have caught the card's deletion taking the
 * composer with it. `offeredModes` gives a feedback item Note alone, so the
 * mode segment is absent by design rather than missing.
 */
function expectTheFourRegions(canvas: Canvas): void {
  expect(canvas.getByRole('region', { name: 'Case status' })).toBeVisible()
  expect(canvas.getByRole('article', { name: 'Guest feedback' })).toBeVisible()
  expect(canvas.getByText(FEEDBACK_COMMENT)).toBeVisible()
  // One mode is not a choice, so there is no control to make it with.
  expect(canvas.queryByRole('tablist')).toBeNull()
  expect(canvas.queryAllByRole('tab')).toHaveLength(0)
  expectNoteFormIntact(canvas)
}

/**
 * The note form, untouched. Two e2e journeys reach for exactly these two names
 * (see `NOTE_SUBMIT` above) and PR 5 moves a button into the same region, so
 * the pin belongs in every state — including the three with no item action,
 * because a manager may always write a note about a feedback item, even one
 * nothing can be recorded against.
 */
function expectNoteFormIntact(canvas: Canvas): void {
  expect(canvas.getByPlaceholderText(NOTE_PLACEHOLDER)).toBeVisible()
  expect(canvas.getByRole('textbox', { name: 'Add a note' })).toBeVisible()
  expect(canvas.getByRole('button', { name: NOTE_SUBMIT })).toBeVisible()
}

/** None of the deleted card's own chrome, in any region. */
function expectCardChromeGone(canvasElement: HTMLElement, canvas: Canvas): void {
  expect(canvas.queryByText(CARD_HEADING)).toBeNull()
  expect(canvas.queryByRole('heading', { name: CARD_HEADING })).toBeNull()
  expect(canvas.queryByText(CARD_OUTCOME_BOX)).toBeNull()
  expect(canvas.queryByText(CARD_OUTCOME_LIST)).toBeNull()
  expect(canvasElement.textContent ?? '').not.toMatch(CARD_DESCRIPTION)
}

/** Neither handling control exists anywhere in the pane. */
function expectNoItemAction(canvas: Canvas): void {
  expect(canvas.queryAllByRole('button', { name: MARK })).toHaveLength(0)
  expect(canvas.queryAllByRole('button', { name: CORRECT })).toHaveLength(0)
}

/** No raw opaque id may reach the pane, in any region, for any reason. */
function expectNoRawIds(canvasElement: HTMLElement): void {
  expect(canvasElement.textContent ?? '').not.toContain('user-')
}

/**
 * The rail's outcome and close lines for these fixtures, as a reader sees them.
 *
 * Plan v2.1 row 11 reads actor · verb · object, so a line a person caused leads
 * with the person: `historyEvent` credits Ada Lovelace, and the first outcome
 * reads `Ada Lovelace handled — Follow-up completed`, not v1's actor-less
 * `Handled — Follow-up completed` with the name tacked on after the time. The
 * words are `outcomeLine`'s (`history-event-line.ts`), and the led forms are
 * pinned per kind in `history-event-line.test.ts`; these stories prove the pane
 * renders them.
 *
 * `CLOSED_AS_HANDLED` is a `user` transition, so it names her too. The guest's
 * and the source's closes further down name nobody and keep v1's capitalised
 * sentence, which is why those stories still look them up by plain text.
 */
const ACTOR = 'Ada Lovelace'
const HANDLED_LINE = `${ACTOR} handled — Follow-up completed`
const CORRECTED_LINE = `${ACTOR} corrected the outcome — Handled with the team`
const CLOSED_AS_HANDLED_LINE = `${ACTOR} closed this — the feedback was handled`

/**
 * An outcome sentence in EITHER lead — v1's actor-less wording or row 11's
 * actor-led one — for the stories that assert no outcome row renders at all. A
 * pattern for only one of the two would pass vacuously whenever the fixture's
 * row happens to carry the other.
 */
const ANY_OUTCOME_LINE = /\bhandled — /i
const ANY_CORRECTION_LINE = /\b(?:outcome corrected|corrected the outcome) — /i

/** Text as a reader meets it, with the markup's line breaks collapsed. */
function normalised(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Finds an event's sentence line by what a reader SEES. Row 11 builds the line
 * from parts — the actor in its own weighted span, the verb phrase in another —
 * so no single element owns `Ada Lovelace handled — Follow-up completed` and a
 * plain `getByText` finds nothing. This matches the paragraph whose whole text
 * starts with the sentence and then a ` · ` separator (the timing clause or the
 * time), so a sentence can never match the front of a longer one. Same matcher
 * as `inbox-thread.stories.tsx`.
 */
function sentence(words: string) {
  return (_content: string, element: Element | null): boolean =>
    element?.tagName === 'P' && normalised(element.textContent).startsWith(`${words} · `)
}

/** Every rendered line whose text matches `pattern` — for asserting none does. */
function linesMatching(canvas: Canvas, pattern: RegExp): readonly HTMLElement[] {
  return canvas.queryAllByText(
    (_content: string, element: Element | null) =>
      element?.tagName === 'P' && pattern.test(normalised(element.textContent)),
  )
}

/**
 * One thread event's own column — the element holding its sentence line and,
 * when the row has one, the manager's free text under it. Scoping to it is
 * what makes "this row carries a lock and that one does not" a claim about two
 * rows rather than about the pane's total.
 */
function eventColumn(canvas: Canvas, words: string): HTMLElement {
  const column = canvas
    .getByText(sentence(words))
    .closest('[data-slot="timeline-content"]')
  expect(column).not.toBeNull()
  return column as HTMLElement
}

/**
 * The lines of one thread event, found by its sentence: `[0]` carries the
 * actor, the sentence, the timing clause and the time; a manager's free text,
 * when the row has any, is `[1]`. Counting them is the only way to see "no
 * note" — an absent key leaves no text to search for, so only the missing line
 * proves it stayed absent. Raw `textContent`, not normalised: the note
 * assertions below are byte for byte.
 */
function eventLines(canvas: Canvas, words: string): readonly string[] {
  return [...eventColumn(canvas, words).querySelectorAll('p')].map(
    (line) => line.textContent ?? '',
  )
}

/**
 * The privacy marker on a manager's internal note, verbatim from
 * `history-event-row.tsx` — the same promise `note-message.tsx` makes about the
 * only other text of this class in the thread.
 *
 * It is an `aria-label` on a `role="img"` wrapper and NOT an `sr-only` span,
 * which is load-bearing in both directions: the label reaches a screen reader,
 * and it contributes zero characters to the paragraph's `textContent`, so the
 * byte-for-byte note assertions below stay assertions about the manager's own
 * words. Searching for it by role is therefore the only way to see it at all.
 */
const LOCK_LABEL = 'Internal note, not visible to the guest'

/** How many privacy markers one event row carries. */
function lockCount(column: HTMLElement): number {
  return within(column).queryAllByRole('img', { name: LOCK_LABEL }).length
}

/** Every timing clause `presentFeedbackHandlingOutcomeEvent` can print. */
const ANY_DEADLINE_CLAUSE = /·\s(on time|late|timing not measured)/

// ─── meta ────────────────────────────────────────────────────────────────────

/**
 * PropertyManager by default: `inbox.write ∧ feedback.handle` is what the
 * server checks before it populates `feedbackHandling` at all, and
 * `inbox.manage` is what turns the closed chip into a reopen menu. A caller
 * holding neither handling permission is `FeedbackAsMemberReadsButCannotHandle`
 * below, which is the same pane with the action taken out.
 */
const meta: Meta<typeof InboxDetailContent> = {
  title: 'Inbox/Detail Content/Feedback',
  component: InboxDetailContent,
  tags: ['autodocs'],
  decorators: [withRole('PropertyManager')],
  args: {
    ...commands,
    notes: [],
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    currentItem: openItem,
    detail: detailFor(openItem, OPEN_CYCLE),
    detailFns: detailFns([OPENED_FROM_FEEDBACK]),
  },
}
export default meta
type Story = StoryObj<typeof InboxDetailContent>

// ─── the four states row 10 lists ────────────────────────────────────────────

/**
 * Open. The work is outstanding, so the chip says so in the feedback
 * vocabulary and the composer offers the one command that can close it.
 *
 * A note is in the fixture on purpose: with the notes list retired, an internal
 * note is a message in the same thread as the handling events, and this is the
 * only state where the whole anatomy — guest message, event, note, composer —
 * is on screen at once.
 */
export const FeedbackOpen: Story = {
  args: { notes: [teamNote] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheFourRegions(canvas)

    // Region 2: the feedback vocabulary, and never the review's.
    await expect(canvas.getByText(NEEDS_ATTENTION)).toBeVisible()
    await expect(canvas.queryByText('Open')).toBeNull()
    await expect(canvas.queryByText('Closed')).toBeNull()

    // Region 3: the cycle's own opening, and the note beside it.
    await expect(canvas.findByText('Opened from guest feedback')).resolves.toBeVisible()
    await expect(canvas.getByText(TEAM_NOTE)).toBeVisible()

    // Region 4: the action, and only the one this state can carry.
    const mark = canvas.getByRole('button', { name: MARK })
    await expect(mark).toBeVisible()
    await expect(canvas.queryByRole('button', { name: CORRECT })).toBeNull()

    // TWO accents, and that is the rule rather than a regression — see
    // `expectAccents`. `Mark as handled` is offered off THIS cycle's
    // `status === 'open'` while the server's refusal scans every cycle of the
    // item, so it can be refused every time it is taken, and the refusal lands
    // after the dialog has collected an outcome and an internal note that are
    // discarded with it. `Add note` always works, so it keeps its own accent
    // beside a button that might not. `FeedbackHandled` below is the `correct`
    // branch, where one control really does take the whole region.
    const region = composerRegion(canvasElement, MARK)
    expectAccents(region, [NOTE_SUBMIT, MARK])
    await expect(mark).toHaveAttribute('data-variant', 'default')
    await expect(canvas.getByRole('button', { name: NOTE_SUBMIT })).toHaveAttribute(
      'data-variant',
      'default',
    )

    expectCardChromeGone(canvasElement, canvas)
    expectNoRawIds(canvasElement)

    // The dialog is still the card's, and it still opens from here.
    await userEvent.click(mark)
    const dialog = within(document.body)
    // It fades and zooms in, so it is mounted and named a frame before it is
    // painted — retry rather than sample once.
    await waitFor(() =>
      expect(
        dialog.getByRole('heading', { name: 'Mark feedback as handled' }),
      ).toBeVisible(),
    )
    await waitFor(() =>
      expect(dialog.getByText(/never shown to the guest/i)).toBeVisible(),
    )
  },
}

/**
 * Handled. The chip names the outcome that closed the work, the thread carries
 * the completion as an event, and the action becomes the correction path.
 *
 * The chip's accessible name carries the outcome rather than leaving it as
 * decoration beside a bare `Handled`, so a reader who only ever hears the label
 * still hears which outcome closed the cycle.
 */
export const FeedbackHandled: Story = {
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, HANDLED_CYCLE),
    detailFns: detailFns([
      OPENED_FROM_FEEDBACK,
      outcomeEvent('2026-03-02T08:00:00Z', FIRST_OUTCOME),
      CLOSED_AS_HANDLED,
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheFourRegions(canvas)

    await expect(
      canvas.getByRole('button', { name: /^Work status/ }),
    ).toHaveAccessibleName('Work status: Handled · Follow-up completed')
    await expect(canvas.queryByText(NEEDS_ATTENTION)).toBeNull()

    // The outcome record, as a thread event rather than a box beside one.
    const handled = await canvas.findByText(sentence(HANDLED_LINE))
    await expect(handled).toBeVisible()
    await expect(eventLines(canvas, HANDLED_LINE)[0]).toContain('· on time')
    await expect(canvas.getByText(sentence(CLOSED_AS_HANDLED_LINE))).toBeVisible()

    // This outcome carried NO note, and this is the shape that fact renders as:
    // one line, and no privacy marker. `FeedbackInternalNoteWithheld` asserts
    // the identical pair for an outcome whose note was WITHHELD, and together
    // the two are the whole disclosure claim — the marker is a property of a
    // note that is present, never a sign that one was kept back. (At the wire
    // there is only one shape to begin with: `getInboxItemHistory` omits the
    // key in both cases, which is why `outcomeEvent` takes no third argument
    // for either.)
    await expect(eventLines(canvas, HANDLED_LINE)).toHaveLength(1)
    await expect(lockCount(eventColumn(canvas, HANDLED_LINE))).toBe(0)
    // The pattern the outcome-free stories assert ZERO of must find this row,
    // or their zero would prove nothing.
    await expect(linesMatching(canvas, ANY_OUTCOME_LINE)).toHaveLength(1)

    // The action is the correction, and the first completion cannot be redone.
    const correct = canvas.getByRole('button', { name: CORRECT })
    await expect(correct).toBeVisible()
    await expect(canvas.queryByRole('button', { name: MARK })).toBeNull()

    const region = composerRegion(canvasElement, CORRECT)
    expectSolePrimary(region, CORRECT)
    await expect(correct).toHaveAttribute('data-variant', 'default')
    await expect(canvas.getByRole('button', { name: NOTE_SUBMIT })).toHaveAttribute(
      'data-variant',
      'outline',
    )

    expectCardChromeGone(canvasElement, canvas)
    expectNoRawIds(canvasElement)

    await userEvent.click(correct)
    const dialog = within(document.body)
    await waitFor(() =>
      expect(
        dialog.getByRole('heading', { name: 'Correct handling outcome' }),
      ).toBeVisible(),
    )
    // The correction's own promise: the original timing is not re-judged.
    await waitFor(() =>
      expect(
        dialog.getByText(/original completion time and timing result stay unchanged/i),
      ).toBeVisible(),
    )
  },
}

/**
 * Corrected. A correction SUPERSEDES rather than rewrites, so the pane shows
 * two things at once: the current outcome, and the fact an earlier one was
 * replaced. Three rules meet here, each a way the card's replacement could go
 * wrong in silence:
 *
 *   * the chip names the CURRENT outcome, which is already the correction —
 *     `currentOutcome` is the highest-revision fact of the cycle, so nothing
 *     walks the history to find it, and the superseded outcome must not be what
 *     a manager reads off region 2;
 *   * the two facts are two DISTINCT events, with different sentences, so the
 *     thread reads as a record rather than as one row that changed its mind;
 *   * the correction claims NO deadline. `correctFeedbackHandlingOutcomeFact`
 *     re-pins the first completion's `completionAt` and `deadlineResult`
 *     verbatim, so carrying the clause onto the correction would assert a
 *     second, later completion that never happened — and would do it while
 *     reading `on time` off a fact whose timing was decided the day before.
 */
export const FeedbackCorrected: Story = {
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, CORRECTED_CYCLE),
    detailFns: detailFns([
      OPENED_FROM_FEEDBACK,
      outcomeEvent('2026-03-02T08:00:00Z', FIRST_OUTCOME),
      CLOSED_AS_HANDLED,
      outcomeEvent('2026-03-03T08:00:00Z', CORRECTION),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheFourRegions(canvas)

    // Region 2 reads the correction, not the outcome it replaced.
    await expect(
      canvas.getByRole('button', { name: /^Work status/ }),
    ).toHaveAccessibleName('Work status: Handled · Handled with the team')
    await expect(canvas.queryByText(/Handled · Follow-up completed/)).toBeNull()

    // Two events, two sentences, in the order they happened.
    const first = await canvas.findByText(sentence(HANDLED_LINE))
    const corrected = canvas.getByText(sentence(CORRECTED_LINE))
    await expect(first).toBeVisible()
    await expect(corrected).toBeVisible()
    await expect(
      Boolean(
        first.compareDocumentPosition(corrected) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)

    // Only the first completion may claim a deadline result.
    await expect(eventLines(canvas, HANDLED_LINE)[0]).toContain('· on time')
    await expect(eventLines(canvas, CORRECTED_LINE)[0]).not.toMatch(ANY_DEADLINE_CLAUSE)
    // Likewise for the correction pattern: one first completion, one correction.
    await expect(linesMatching(canvas, ANY_OUTCOME_LINE)).toHaveLength(1)
    await expect(linesMatching(canvas, ANY_CORRECTION_LINE)).toHaveLength(1)

    // A corrected cycle can be corrected again — and still never re-marked.
    await expect(canvas.getByRole('button', { name: CORRECT })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: MARK })).toBeNull()
    expectSolePrimary(composerRegion(canvasElement, CORRECT), CORRECT)

    expectCardChromeGone(canvasElement, canvas)
    expectNoRawIds(canvasElement)
  },
}

/**
 * Withdrawn. The guest took the feedback back, and the domain refuses a manager
 * outcome for that cycle forever — a manual reopen too
 * (`handling-outcome-authority.ts`), on the ground that recording one would
 * fabricate evidence of human judgement that never happened.
 *
 * So this is not a state waiting for a button; it is a state whose button can
 * never exist. Both controls are asserted at count ZERO rather than as
 * disabled, because a disabled `Mark as handled` would promise a permission
 * problem that a refresh might fix. The sentence in their place is verbatim:
 * `inbox-handling-cycle.spec.ts:369-377` asserts the same string against a real
 * server, so the two must not drift.
 */
export const FeedbackWithdrawn: Story = {
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, closedWithNoOutcome('guest_withdrawn')),
    detailFns: detailFns([
      OPENED_FROM_FEEDBACK,
      historyEvent('2026-03-02T07:00:00Z', {
        kind: 'cycle_transition',
        transition: 'closed',
        transitionReason: 'guest_withdrawn',
        actorType: 'guest',
      }),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheFourRegions(canvas)

    // Withdrawn feedback cannot be handled. Not disabled — absent.
    expectNoItemAction(canvas)
    expectSolePrimary(canvasElement, NOTE_SUBMIT)
    await expect(canvas.getByText(WITHDRAWN_SENTENCE)).toBeVisible()
    // Nor may it be talked into a reopen the server refuses for this reason.
    await expect(canvasElement.textContent ?? '').not.toContain(REOPEN_ADVICE)

    // The chip reports the close and invents no judgement. It used to read a
    // bare `Handled` here, which is the deleted card's own defect wearing a
    // different shape: the domain refuses a manager outcome for this close
    // FOREVER — no later cycle re-earns the right — so `Handled` asserts a
    // human decision that can never exist, while the region right below it is
    // busy saying in a sentence that none was recorded. The third word is the
    // honest one, and it is the chip's WHOLE accessible name because the
    // outcome is part of the status rather than decoration beside it.
    await expect(
      canvas.getByRole('button', { name: /^Work status/ }),
    ).toHaveAccessibleName('Work status: Closed — no outcome')
    await expect(canvas.queryByText(/Handled ·/)).toBeNull()
    await expect(canvas.queryByText('Handled')).toBeNull()

    await expect(canvas.findByText('Closed — the guest withdrew')).resolves.toBeVisible()
    // Nothing was recorded, so nothing may read as though it had been.
    await expect(linesMatching(canvas, ANY_OUTCOME_LINE)).toHaveLength(0)
    await expect(linesMatching(canvas, ANY_CORRECTION_LINE)).toHaveLength(0)

    expectCardChromeGone(canvasElement, canvas)
    expectNoRawIds(canvasElement)
  },
}

// ─── the two other outcome-free closes ───────────────────────────────────────

/**
 * `source_ineligible` — the second close the domain refuses an outcome for, and
 * the one whose copy this PR changes.
 *
 * The deleted card fell through to the generic sentence here, which ends
 * `Reopen it if more follow-up is needed` — advice
 * `assertManualReopenPermitted` refuses for exactly this reason. That was a bug
 * in the card and it is not ported: the absence asserted below is the whole
 * point of the story, and `FeedbackClosedAndReopenable` beside it is what keeps
 * the absence from being vacuous.
 */
export const FeedbackSourceIneligible: Story = {
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, closedWithNoOutcome('source_ineligible')),
    detailFns: detailFns([
      OPENED_FROM_FEEDBACK,
      historyEvent('2026-03-02T07:00:00Z', {
        kind: 'cycle_transition',
        transition: 'closed',
        transitionReason: 'source_ineligible',
        actorType: 'system',
      }),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheFourRegions(canvas)

    await expect(canvas.getByText(INELIGIBLE_SENTENCE)).toBeVisible()
    await expect(canvasElement.textContent ?? '').not.toContain(REOPEN_ADVICE)
    await expect(canvas.queryByText(WITHDRAWN_SENTENCE)).toBeNull()
    expectNoItemAction(canvas)
    expectSolePrimary(canvasElement, NOTE_SUBMIT)

    // The SECOND close the domain refuses an outcome for, so the chip owes the
    // same honesty it owes a withdrawal. Asserted here as well as there because
    // the strip branches on a two-member list and a story for one member would
    // leave the other free to regress to `Handled`.
    await expect(
      canvas.getByRole('button', { name: /^Work status/ }),
    ).toHaveAccessibleName('Work status: Closed — no outcome')
    await expect(canvas.queryByText('Handled')).toBeNull()

    await expect(
      canvas.findByText('Closed — the source is no longer eligible'),
    ).resolves.toBeVisible()
    expectCardChromeGone(canvasElement, canvas)
  },
}

/**
 * Closed with no outcome for a reason that does NOT forbid one — a cycle a
 * newer guest submission superseded. Reopening really is the way forward here,
 * so the generic sentence is correct, and this story is what proves the two
 * assertions above it are about a branch rather than about a deleted string.
 */
export const FeedbackClosedAndReopenable: Story = {
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, closedWithNoOutcome('superseded_by_source_revision')),
    detailFns: detailFns([OPENED_FROM_FEEDBACK]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheFourRegions(canvas)

    await expect(canvas.getByText(REOPENABLE_SENTENCE)).toBeVisible()
    await expect(canvas.queryByText(WITHDRAWN_SENTENCE)).toBeNull()
    await expect(canvas.queryByText(INELIGIBLE_SENTENCE)).toBeNull()
    expectNoItemAction(canvas)
    expectSolePrimary(canvasElement, NOTE_SUBMIT)
    expectCardChromeGone(canvasElement, canvas)

    // And the chip keeps the bare `Handled` — which is what makes the two
    // `Closed — no outcome` assertions above about a BRANCH rather than about
    // the string "closed with no outcome". A reopen here can still carry this
    // cycle to a real outcome, so the third word would be as false on this
    // close as `Handled` is on a withdrawal.
    await expect(
      canvas.getByRole('button', { name: /^Work status/ }),
    ).toHaveAccessibleName('Work status: Handled')
    await expect(canvasElement.textContent ?? '').not.toContain('Closed — no outcome')
  },
}

/**
 * An outcome IS recorded, and this build has no word for its value.
 *
 * The fourth way a closed cycle ends up with nothing to name, and the one the
 * chip's own doc used to omit while calling `Handled · undefined` unreachable.
 * It is reachable: `feedbackHandlingOutcomeLabel` is a map index over a value
 * cast straight out of a `varchar` column, and `undefined` is what a miss
 * returns. The chip's label is also its WHOLE accessible name, so an unguarded
 * index does not merely look untidy — it reads the literal word `undefined` out
 * to a screen reader as the status of the manager's work.
 *
 * Two surfaces read the same unknown value and answer differently, on purpose:
 *
 *   * the chip drops the outcome word and keeps `Handled`. It cannot fall
 *     silent — the item is closed and region 2 has to say so;
 *   * the thread row drops ITSELF. `presentFeedbackHandlingOutcomeEvent`
 *     returns null and `HistoryEventRow` renders nothing, because a row that
 *     named a person and a time while asserting no outcome would be worse than
 *     no row. The `cycle_transition` beside it still carries the close.
 *
 * That divergence is exactly what a single-surface test would miss, which is
 * why this story is pane-level and not two component ones.
 */
export const FeedbackOutcomeThisBuildCannotRead: Story = {
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, UNREADABLE_OUTCOME_CYCLE),
    detailFns: detailFns([
      OPENED_FROM_FEEDBACK,
      outcomeEvent('2026-03-02T08:00:00Z', UNREADABLE_OUTCOME),
      CLOSED_AS_HANDLED,
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheFourRegions(canvas)

    // Region 2: the word it can read, and no separator promising one it cannot.
    await expect(
      canvas.getByRole('button', { name: /^Work status/ }),
    ).toHaveAccessibleName('Work status: Handled')
    await expect(canvas.queryByText(/Handled ·/)).toBeNull()
    // Nor the OTHER honest word: this close does not forbid an outcome, it
    // merely recorded one in a vocabulary this build postdates.
    await expect(canvasElement.textContent ?? '').not.toContain('Closed — no outcome')

    // Region 3: the close survives, the outcome row does not.
    await expect(
      canvas.findByText(sentence(CLOSED_AS_HANDLED_LINE)),
    ).resolves.toBeVisible()
    await expect(linesMatching(canvas, ANY_OUTCOME_LINE)).toHaveLength(0)
    await expect(linesMatching(canvas, ANY_CORRECTION_LINE)).toHaveLength(0)

    // Neither the placeholder nor the raw value, in any region.
    const prose = canvasElement.textContent ?? ''
    await expect(prose).not.toContain('undefined')
    await expect(prose).not.toContain(WIDENED_OUTCOME)

    // Region 4 is unchanged: a value we cannot NAME is still a recorded
    // outcome, so `feedbackHandlingAction` answers `correct` and the manager
    // can replace it with one this build does have a word for.
    await expect(canvas.getByRole('button', { name: CORRECT })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: MARK })).toBeNull()
    expectSolePrimary(composerRegion(canvasElement, CORRECT), CORRECT)

    expectCardChromeGone(canvasElement, canvas)
    expectNoRawIds(canvasElement)
  },
}

// ─── the internal note ───────────────────────────────────────────────────────

/**
 * The manager-internal note recorded with an outcome, at the pane level.
 *
 * `getInboxItemHistory` strips the key entirely — absent, not null, not
 * truncated — whenever the caller may not read it, so an unauthorized reader
 * cannot even learn that a note exists. Both rows are in one story because the
 * present case is what makes the absent case non-vacuous: a component that
 * rendered no notes at all would otherwise pass the second half.
 *
 * And "no trace" is stronger than "no text": there is no placeholder, no
 * withheld affordance, no disclosure to open and nothing that stringifies
 * `undefined`. The row a withheld note leaves behind is the same shape as the
 * row an outcome with no note at all leaves — one line and no marker, which is
 * what `FeedbackHandled` above asserts against a genuinely note-free outcome.
 *
 * The note that IS present carries a lock, and the two halves of this story are
 * also the two halves of that rule. `outcomeLine` sets its `internal` flag for
 * every outcome row it builds, note or no note, so the flag itself is never
 * evidence a note exists; the marker is rendered inside `body`'s own paragraph
 * and only where there is a `body`, so it marks the note rather than its
 * absence. A lock that appeared on a withheld row would BE the disclosure.
 */
export const FeedbackInternalNoteWithheld: Story = {
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, CORRECTED_CYCLE),
    detailFns: detailFns([
      OPENED_FROM_FEEDBACK,
      outcomeEvent('2026-03-02T08:00:00Z', FIRST_OUTCOME, INTERNAL_NOTE),
      // No `internalNote` key at all — what an unauthorized read returns.
      outcomeEvent('2026-03-03T08:00:00Z', CORRECTION),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText(sentence(HANDLED_LINE))).resolves.toBeVisible()

    // Present: the sentence, then the note under it.
    const noted = eventColumn(canvas, HANDLED_LINE)
    const withNote = eventLines(canvas, HANDLED_LINE)
    await expect(withNote).toHaveLength(2)
    await expect(withNote[1]).toBe(INTERNAL_NOTE)

    // And the note is MARKED as the manager's own, the way `note-message.tsx`
    // marks the only other text of this class in the thread. This is the lock
    // the deleted `feedback-handling-card.tsx` carried and that the thread
    // inherited the text without: the note sat in the same column, in the same
    // muted style as the guest's own message, with nothing saying whose eyes it
    // was for. The marker lives inside the note's paragraph, so it travels with
    // the note and cannot be read as a property of the row.
    await expect(lockCount(noted)).toBe(1)
    await expect(within(noted).getByRole('img', { name: LOCK_LABEL })).toBeVisible()
    // It says its piece to a screen reader and nothing to `textContent`, which
    // is why the byte-for-byte assertion above still reads the manager's words.
    await expect(withNote[1]).not.toContain('Internal')

    // Absent: the sentence alone, no second line of any kind — and no marker.
    // A lock on a row whose note was withheld would be the disclosure itself,
    // announcing to a reader who may not see the note that there is one.
    const withheld = eventColumn(canvas, CORRECTED_LINE)
    await expect(eventLines(canvas, CORRECTED_LINE)).toHaveLength(1)
    await expect(lockCount(withheld)).toBe(0)
    // Stronger than counting one marker: nothing in that row carries an
    // accessible name at all, so there is no affordance of any kind to notice.
    await expect(withheld.querySelectorAll('[aria-label]')).toHaveLength(0)
    await expect(canvas.getAllByText(INTERNAL_NOTE)).toHaveLength(1)

    // The marker appears exactly as often as a note does — once in this pane,
    // which carries one note and one outcome without one.
    await expect(canvas.getAllByRole('img', { name: LOCK_LABEL })).toHaveLength(1)

    // Nothing anywhere in the pane says a note was kept back.
    const prose = canvasElement.textContent ?? ''
    await expect(prose).not.toMatch(/withheld|redacted|not shown|hidden/i)
    await expect(prose).not.toContain('undefined')
  },
}

// ─── the caller who may read but not handle ──────────────────────────────────

/**
 * A Member: `inbox.read` and `inbox.write`, no `feedback.handle`.
 *
 * The server withholds `feedbackHandling` entirely for this caller
 * (`get-inbox-item-detail.ts:133-155`), so the pane is handed `null` — and the
 * chip's open/handled word has to come from `item.status` instead. That is the
 * fallback the strip states, and the reason it reads a bare `Handled` rather
 * than `Handled · undefined`.
 *
 * Region 4 survives intact: a Member may still write an internal note, so the
 * composer is mounted with Note mode and its own submit, and only the item
 * action is missing. A pane that gated the whole region on the handling
 * permission would take the note form with it.
 */
export const FeedbackAsMemberReadsButCannotHandle: Story = {
  decorators: [withRole('Member')],
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, null),
    detailFns: detailFns([
      OPENED_FROM_FEEDBACK,
      outcomeEvent('2026-03-02T08:00:00Z', FIRST_OUTCOME),
      CLOSED_AS_HANDLED,
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheFourRegions(canvas)

    // A bare `Handled`, from the item's own status — and never `Closed`, which
    // is the review word, nor an outcome this caller was not sent.
    await expect(canvas.getByText('Handled')).toBeVisible()
    await expect(canvas.queryByText(/Handled ·/)).toBeNull()
    await expect(canvas.queryByText('Closed')).toBeNull()
    // No `inbox.manage`, so the chip is text rather than a reopen menu.
    await expect(canvas.queryByRole('button', { name: /^Work status/ })).toBeNull()

    // Neither handling control, in either state's spelling.
    expectNoItemAction(canvas)
    // Not because the region is gone — the note form is right there, and it is
    // the region's single primary.
    expectSolePrimary(canvasElement, NOTE_SUBMIT)

    expectCardChromeGone(canvasElement, canvas)
    expectNoRawIds(canvasElement)
  },
}

/**
 * The same caller, handed a handling state anyway.
 *
 * The server cannot produce this — `feedbackHandling` is null-gated on
 * `inbox.write ∧ feedback.handle` — which is exactly why it is worth a story:
 * the assertion above it would pass against a pane with no permission check at
 * all, because a null state paints nothing either way. This one has a state to
 * paint from and still paints nothing.
 *
 * What it pins is the PANE's gate, and only that. `inbox-detail-content.tsx`
 * reads the same pair before it builds the slot at all (`:378-380`), so under a
 * Member `handlingState` is null, `feedbackPrimary` is null, and
 * `FeedbackHandlingPrimary` never mounts — its own `can()` pair is unreachable
 * from here, and replacing that local `canHandle` with `true` leaves this story
 * green. The doc used to claim the opposite; the claim was vacuous, and the
 * pane's gate is the one worth pinning at pane level because it is the gate
 * that also decides the region's geometry and its accent.
 *
 * The local check is defence in depth and is covered on its own, by mounting
 * the component directly: `HandlingPrimaryAloneWithoutPermission` below.
 */
export const FeedbackActionIsPermissionGatedNotStateGated: Story = {
  decorators: [withRole('Member')],
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, HANDLED_CYCLE),
    detailFns: detailFns([OPENED_FROM_FEEDBACK]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The state says `Correct outcome` is the move; the permission says there
    // is no move. No button, and no explanation of an affordance this reader
    // never had either (row 8).
    expectNoItemAction(canvas)
    await expect(canvas.queryByText(WITHDRAWN_SENTENCE)).toBeNull()
    await expect(canvas.queryByText(REOPENABLE_SENTENCE)).toBeNull()

    expectNoteFormIntact(canvas)
    expectSolePrimary(canvasElement, NOTE_SUBMIT)
    expectCardChromeGone(canvasElement, canvas)
  },
}

// ─── the local half of the permission pair ───────────────────────────────────

/**
 * `FeedbackHandlingPrimary` on its own, handed a handled cycle, under a caller
 * without `feedback.handle`.
 *
 * The pane cannot reach this branch and neither can production: both gate on
 * the pair before the component exists. A Storybook fixture can, and so could a
 * future caller handing over state it was given for another purpose — which is
 * the whole argument for keeping a check that is redundant by construction. A
 * check no test can fail is not defence in depth, it is decoration, so it gets
 * the one mount that makes it load-bearing: neutralise `canHandle` in
 * `feedback-handling-primary.tsx` and THIS story fails while every pane story
 * stays green.
 *
 * `Member` exercises the second conjunct (`inbox.write` without
 * `feedback.handle`). There is no built-in role for the first — the three roles
 * are ordered and `feedback.handle` sits above `inbox.write` in all of them —
 * so the `&&` is pinned from the only side a role can reach it from.
 *
 * `HandlingPrimaryAloneWithPermission` beside it is what keeps the absence from
 * being vacuous in turn: without it, a component that rendered nothing under
 * any role at all would pass this.
 */
export const HandlingPrimaryAloneWithoutPermission: Story = {
  decorators: [withRole('Member')],
  render: () => (
    <FeedbackHandlingPrimary
      item={closedItem}
      state={HANDLED_CYCLE}
      markFeedbackHandled={commands.markFeedbackHandled}
      correctFeedbackHandlingOutcome={commands.correctFeedbackHandlingOutcome}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectNoItemAction(canvas)
    // Not a disabled button, and not a sentence explaining an affordance this
    // reader never had (row 8): nothing at all. The node is still non-null to
    // its host, which is what buys the region its scroller either way.
    await expect(canvasElement.textContent ?? '').toBe('')
    await expect(canvas.queryAllByRole('button')).toHaveLength(0)
  },
}

/** The same mount, one permission richer — the action the story above denies. */
export const HandlingPrimaryAloneWithPermission: Story = {
  decorators: [withRole('PropertyManager')],
  render: () => (
    <FeedbackHandlingPrimary
      item={closedItem}
      state={HANDLED_CYCLE}
      markFeedbackHandled={commands.markFeedbackHandled}
      correctFeedbackHandlingOutcome={commands.correctFeedbackHandlingOutcome}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const correct = canvas.getByRole('button', { name: CORRECT })
    await expect(correct).toBeVisible()
    await expect(correct).toHaveAttribute('data-variant', 'default')
    await expect(canvas.queryByRole('button', { name: MARK })).toBeNull()
  },
}

// ─── light theme ─────────────────────────────────────────────────────────────

/**
 * The handled state in light, so axe runs its contrast pass over this pane's
 * own palette too — the dark `--primary` was tuned for dark contrast, and the
 * chip that now carries the outcome is a surface the card never had.
 */
export const FeedbackHandledLight: Story = {
  parameters: { theme: 'light' },
  args: {
    currentItem: closedItem,
    detail: detailFor(closedItem, HANDLED_CYCLE),
    detailFns: detailFns([
      OPENED_FROM_FEEDBACK,
      outcomeEvent('2026-03-02T08:00:00Z', FIRST_OUTCOME),
      CLOSED_AS_HANDLED,
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /^Work status/ }),
    ).toHaveAccessibleName('Work status: Handled · Follow-up completed')
    await expect(canvas.getByRole('button', { name: CORRECT })).toBeVisible()
    await expect(canvas.findByText(sentence(HANDLED_LINE))).resolves.toBeVisible()
  },
}
