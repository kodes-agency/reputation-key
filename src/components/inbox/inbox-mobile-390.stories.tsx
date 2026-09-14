// The inbox detail pane at 390 px — row 15's gate.
//
// Row 15 ends "390 px stories are part of the gate", and PR 6 spells that as
// "390 px stories for every state above; axe gate". Every other story file in
// this folder proves a component; this one proves a WIDTH. It mounts
// `InboxDetailSheet` — the real mobile surface, not the desktop panel and not
// `InboxDetailContent` on its own — because the four regions only compose into
// a phone-shaped pane there, and because the header, its dismissal and the
// sheet's own column are the parts row 15 changed.
//
// ── What was measured, and what it means for these assertions ───────────────
//
// 1. `parameters.viewport` DOES resize the runner window in this Storybook.
//    Several comments in this folder say the opposite. They were true once and
//    are not true now: `@storybook/addon-vitest@10.6` awaits
//    `page.viewport(w, h)` before running every composed story
//    (`dist/vitest-plugin/test-utils.js:51-71, 120`), reading
//    `parameters.viewport.defaultViewport` against
//    `{...MINIMAL_VIEWPORTS, ...parameters.viewport.viewports}` — which is
//    where `.storybook/preview.tsx`'s `mobileStaff` comes from. Probed in this
//    runner on 2026-09-12:
//
//      no viewport param  → 1200 x 900,  matchMedia('(max-width: 767px)') false
//      mobileStaff        →  390 x 844,  matchMedia('(max-width: 767px)') TRUE
//      mobileNarrow       →  320 x 900,  matchMedia('(max-width: 767px)') TRUE
//
//    Two consequences. `useIsMobile()` answers honestly here, so the mobile
//    branch needs no `matchMedia` patch — the stories below take the same
//    branch a phone does, for the same reason. And a story with no viewport
//    param is reset to 1200 x 900, so the width never leaks between stories.
//
// 2. NO Tailwind is compiled in this project. Probed the same way: a div with
//    `h-4` computes to `0px`, and `overflow-x-auto` computes to `visible`. So
//    `max-md:size-11`, `overflow-x-auto`, `max-h-[60%]`, every height and every
//    breakpoint in this tree is INERT. Nothing below asserts a rectangle, a
//    height, a scroll extent or a computed style: at 390 px those numbers would
//    be measurements of an unstyled document and would pass whatever the class
//    strings said. Row 15's own "every target >= 44 px" is therefore NOT
//    gateable from here, and is deliberately not attempted — it was measured in
//    a real Tailwind build (see the PR report) and belongs to Playwright.
//    What IS real in this runner: content, roles, accessible names, focus,
//    `hidden` (the UA sheet alone honours it), document order, and behaviour.
//
// 3. The axe gate reaches this surface. The sheet is a Radix portal, so its
//    markup is on `document.body` rather than inside `#storybook-root` — and
//    addon-a11y@10.6 runs with `include: document.body`
//    (`dist/_browser-chunks/chunk-P5J2FJ2Z.js:74-78`), not the story root. Each
//    story below is therefore a real axe pass over the whole mobile pane at
//    390 px, with `test: 'error'` and `color-contrast` on, which is the
//    accessibility gate the plan names. Queries are scoped to
//    `within(document.body)` for the same portal reason.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import { InboxDetailSheet } from './inbox-detail-sheet'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { InboxHistoryEntry } from './inbox-thread-model'
import type { InboxDetailFns } from './types'
import type { InboxDetailState } from './use-inbox-detail'
import type { InboxAssignmentOption } from './inbox-owner-view'
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
  ResponseTargetView,
} from '#/contexts/inbox/application/public-api'

/**
 * The reply, spelled through the bundle that carries it.
 *
 * `ReplyView` itself lives in `inbox/application/ports/`, which components may
 * not import; `public-api.ts` re-exports the detail result but not the member.
 * Narrowing the field is the one legal spelling — and the better one anyway,
 * because it is by construction the exact type the pane will be handed.
 */
type Reply = Exclude<
  NonNullable<InboxItemDetailResult['reply']>,
  { kind: 'google_observation' }
>

// ─── pinned copy ─────────────────────────────────────────────────────────────

/**
 * The mobile dismissal, verbatim. `back` rather than `close` because opening an
 * item on a phone is a navigation (`inbox-state-helpers.ts` pushes `itemId`)
 * and the sheet is `w-full` below `sm` — there is no overlay left to tap and no
 * Escape key. `Back to list` is also why the triage journey's count-0 assertion
 * on a control named exactly `Close` still holds on this surface.
 */
const BACK = 'Back to list'
const NOTE_TAB = 'Internal note'
const REPLY_TAB = 'Public reply'
const NOTE_SUBMIT = 'Add note'
const NOTE_FIELD = 'Add a note'
/** Row 15's collapsed bar, on an item whose only surface is the note form. */
const NOTE_BAR = 'Add a note…'
const REPLY_BAR = 'Reply…'
const REPLY_FIELD = 'Public reply'
const MARK_HANDLED = 'Mark as handled'
const EDITING_BAND = 'Editing a live reply · republishes to Google'

const REVIEW_TEXT = 'The room was spotless and the late checkout saved our flight.'
const FEEDBACK_COMMENT = 'The shower in room 402 ran cold for two mornings.'
const REPLY_TEXT = 'Thank you — we have passed this to the housekeeping team.'
const NOTE_TEXT = 'Called the guest; they accepted a partial refund.'
const WITHDRAWN_SENTENCE =
  'This feedback was withdrawn by the guest. No manager outcome was recorded.'

// ─── clock ───────────────────────────────────────────────────────────────────

/**
 * Fixture instants, relative to the REAL clock — deliberately, and this is the
 * one place in the file where that is the right answer.
 *
 * `InboxCaseToolbar` takes the instant its countdown reads as an optional prop
 * and `inbox-detail-content.tsx` does not pass one, so on this surface the
 * reply-due detail reads `new Date()` and ticks once a minute. A fixture pinned
 * to a literal date (which is how `inbox-case-toolbar.stories.tsx` does it,
 * because that file mounts the toolbar directly and CAN hand it a clock) would
 * read as hundreds of
 * days overdue here, and would rot by another day every day.
 *
 * The half-hour of slack is what makes the labels exact rather than nearly
 * exact: `formatDistance` FLOORS to the largest whole unit, so a due time
 * exactly 31 h out has already become `30 h` by the time anything renders.
 * 31.5 h floors to `31 h` for the next half hour, which is a margin measured in
 * thousands of times the length of a play function.
 */
const HOUR_MS = 60 * 60 * 1_000
const FIXTURE_NOW = Date.now()
const hoursFromNow = (hours: number): Date => new Date(FIXTURE_NOW + hours * HOUR_MS)

// ─── items ───────────────────────────────────────────────────────────────────

const VIEWER_ID = 'user-viewer'
const ADA_ID = 'user-ada-1111'
const assignmentOptions: ReadonlyArray<InboxAssignmentOption> = [
  { userId: 'user-grace', name: 'Grace Hopper' },
]

const reviewItem: InboxItem = {
  ...makeInboxItem({ id: 'rev-390', sourceType: 'review', status: 'open', rating: 4 }),
  // 40 characters. The header's left block is the one thing in region 1 that
  // may shrink, so a name long enough to need the room is what makes the 320 px
  // story below a question rather than a formality.
  propertyName: 'Seaside Rooms at Whitstable Harbour Inn',
  sourceDate: new Date('2026-01-30T09:00:00Z'),
}
const closedReviewItem: InboxItem = { ...reviewItem, status: 'closed' }
const escalatedReviewItem: InboxItem = { ...reviewItem, isEscalated: true }

const feedbackItem: InboxItem = {
  ...makeInboxItem({ id: 'fb-390', sourceType: 'feedback', status: 'open', rating: 2 }),
  propertyName: 'Seaside Rooms at Whitstable Harbour Inn',
  sourceDate: new Date('2026-01-30T09:00:00Z'),
  reviewerName: null,
}
const closedFeedbackItem: InboxItem = { ...feedbackItem, status: 'closed' }

// ─── response targets ────────────────────────────────────────────────────────

const activeTarget: ResponseTargetView = {
  inboxItemId: reviewItem.id,
  cycleNumber: 1,
  organizationId: reviewItem.organizationId,
  propertyId: reviewItem.propertyId,
  targetKind: 'google_review_response',
  eligibility: 'measured',
  durationMinutes: 2_880,
  policySource: 'organization_policy',
  policyVersion: 3,
  // 48 h before `dueAt`, matching `durationMinutes` — a fixture whose window
  // disagreed with its own policy would be describing a cycle the server
  // cannot produce.
  startAt: hoursFromNow(-16.5),
  dueAt: hoursFromNow(31.5),
  completionAt: null,
  result: null,
  stopReason: null,
  propertyTimezone: 'America/New_York',
  evaluation: { state: 'active', overdue: false, elapsedMinutes: 1_020 },
}

const overdueTarget: ResponseTargetView = {
  ...activeTarget,
  dueAt: hoursFromNow(-50),
  evaluation: { state: 'active', overdue: true, elapsedMinutes: 5_760 },
}

const repliedOnTimeTarget: ResponseTargetView = {
  ...activeTarget,
  completionAt: hoursFromNow(-1),
  result: 'on_time',
  stopReason: 'confirmed_on_google',
  evaluation: { state: 'completed', overdue: false, elapsedMinutes: 960 },
}

// ─── replies ─────────────────────────────────────────────────────────────────

const SUBMITTED_AT = new Date('2026-01-31T09:00:00Z')

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId('reply-390-0001'),
    reviewId: reviewId('rev-390'),
    organizationId: organizationId(reviewItem.organizationId),
    text: REPLY_TEXT,
    replyLanguageTag: 'en-Latn',
    templateId: null,
    templateVersion: null,
    status: 'pending_approval',
    source: 'internal',
    createdBy: userId(ADA_ID),
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: SUBMITTED_AT,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationCycle: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: SUBMITTED_AT,
    updatedAt: SUBMITTED_AT,
    ...overrides,
  }
}

const pendingReply = makeReply()
const approvedReply = makeReply({
  status: 'approved',
  approvedBy: userId('user-grace'),
  approvedAt: new Date('2026-01-31T09:05:00Z'),
  publicationState: 'requested',
})
const publishedReply = makeReply({
  status: 'published',
  approvedBy: userId('user-grace'),
  approvedAt: new Date('2026-01-31T09:05:00Z'),
  publishedAt: new Date('2026-01-31T09:20:00Z'),
  publicationState: 'published',
})
const observedGoogleReply = {
  kind: 'google_observation',
  id: 'observation-390-0001',
  reviewId: reviewId('review-390-observed'),
  organizationId: organizationId('org-hotel-elegance'),
  text: 'Thank you for staying with us. We hope to welcome you back soon.',
  status: 'published',
  source: 'google_sync',
  publishedAt: new Date('2026-01-31T09:20:00Z'),
  updatedAt: new Date('2026-02-05T09:20:00Z'),
} as const satisfies NonNullable<InboxItemDetailResult['reply']>
const failedReply = makeReply({
  status: 'publish_failed',
  approvedBy: userId('user-grace'),
  approvedAt: new Date('2026-01-31T09:05:00Z'),
  publicationState: 'terminal',
  publicationAttempts: 3,
  // `terminal_rejection`, not `ambiguous`: `resolveReplyView` sends an
  // ambiguous failure down the `failed-check` branch (`Needs a check`, which
  // offers a re-read and never a second send). This fixture is the OTHER half —
  // `failed-retry`, whose whole action list is Try again.
  publicationLastErrorClass: 'terminal_rejection',
})
const rejectedReply = makeReply({
  status: 'rejected',
  rejectedBy: userId('user-grace'),
  rejectionReason: 'Too generic; please name the housekeeping fix we made.',
  updatedAt: new Date('2026-01-31T10:00:00Z'),
})

// ─── feedback handling ───────────────────────────────────────────────────────

const OPEN_CYCLE: FeedbackHandlingState = {
  cycleNumber: 1,
  sourceRevision: 1,
  stateRevision: 1,
  status: 'open',
  closeReason: null,
  currentOutcome: null,
  history: [],
}

const HANDLED_CYCLE: FeedbackHandlingState = {
  ...OPEN_CYCLE,
  stateRevision: 2,
  status: 'closed',
  closeReason: 'private_feedback_handled',
  currentOutcome: {
    id: 'outcome-390-1',
    inboxItemId: feedbackItem.id,
    organizationId: feedbackItem.organizationId,
    propertyId: feedbackItem.propertyId,
    feedbackId: feedbackItem.sourceId as never,
    cycleNumber: 1,
    sourceRevision: 1,
    outcomeRevision: 1,
    outcome: 'follow_up_completed',
    internalNote: null,
    recordedBy: userId(ADA_ID),
    recordedAt: new Date('2026-02-02T08:00:00Z'),
    completionAt: new Date('2026-02-02T08:00:00Z'),
    deadlineResult: 'on_time',
    supersedesOutcomeId: null,
  },
  history: [],
}

/**
 * Withdrawn. The domain refuses a manager outcome for this cycle forever, so
 * the chip may not say `Handled` — there is no human judgement to assert, and
 * the strip says `Closed — no outcome` instead.
 */
const WITHDRAWN_CYCLE: FeedbackHandlingState = {
  ...OPEN_CYCLE,
  stateRevision: 2,
  status: 'closed',
  closeReason: 'guest_withdrawn',
}

// ─── details ─────────────────────────────────────────────────────────────────

function reviewDetail(over: Partial<InboxItemDetailResult> = {}): InboxItemDetailResult {
  return {
    item: reviewItem,
    reviewText: REVIEW_TEXT,
    reviewTranslatedText: null,
    reviewerProfilePhotoUrl: null,
    reviewContentStatus: 'available',
    // Plan row 7: the stars come from the detail payload, not the item row.
    reviewRating: 4,
    feedbackComment: null,
    feedbackRatingValue: null,
    reply: null,
    analysis: null,
    feedbackHandling: null,
    responseTarget: activeTarget,
    ...over,
  }
}

function feedbackDetail(
  item: InboxItem,
  feedbackHandling: FeedbackHandlingState,
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

// ─── history and notes ───────────────────────────────────────────────────────

type HistoryUserId = NonNullable<InboxHistoryEntry['actorUserId']>

const OPENED_FROM_GOOGLE: InboxHistoryEntry = {
  id: 'hist-390-opened',
  inboxItemId: reviewItem.id,
  kind: 'cycle_opened',
  occurredAt: new Date('2026-01-30T09:00:00Z'),
  cycleNumber: 1,
  stateRevision: 1,
  actorUserId: null,
  actorDisplayName: null,
  legacy: false,
  detail: {
    kind: 'cycle_opened',
    openedReason: 'review_observed',
    manualReopenReason: null,
    manualReopenExplanation: null,
    supersedesCycleNumber: null,
    sourceRevision: 1,
  },
}

const ASSIGNED_TO_GRACE: InboxHistoryEntry = {
  id: 'hist-390-assigned',
  inboxItemId: reviewItem.id,
  kind: 'assignment',
  occurredAt: new Date('2026-01-30T10:00:00Z'),
  cycleNumber: 1,
  stateRevision: 2,
  actorUserId: ADA_ID as HistoryUserId,
  actorDisplayName: 'Ada Lovelace',
  legacy: false,
  detail: {
    kind: 'assignment',
    reason: 'assign',
    previousAssignee: null,
    nextAssignee: 'user-grace' as HistoryUserId,
    previousAssigneeDisplayName: null,
    nextAssigneeDisplayName: 'Grace Hopper',
    bulkId: null,
  },
}

const ESCALATED: InboxHistoryEntry = {
  id: 'hist-390-escalated',
  inboxItemId: reviewItem.id,
  kind: 'escalation',
  occurredAt: new Date('2026-01-30T11:00:00Z'),
  cycleNumber: 1,
  stateRevision: 3,
  actorUserId: ADA_ID as HistoryUserId,
  actorDisplayName: 'Ada Lovelace',
  legacy: false,
  detail: { kind: 'escalation', escalation: 'escalated' },
}

const teamNote: InboxNoteView = {
  id: 'note-390-1' as InboxNote['id'],
  inboxItemId: reviewItem.id,
  organizationId: reviewItem.organizationId,
  userId: userId(ADA_ID),
  displayName: 'Ada Lovelace',
  text: NOTE_TEXT,
  createdAt: new Date('2026-01-30T12:00:00Z'),
}

// ─── server fns and commands ─────────────────────────────────────────────────

function detailFns(entries: readonly InboxHistoryEntry[] = []): InboxDetailFns {
  return {
    // The pane is handed `detail` as a prop, so this is never the source of
    // what is on screen; it answers honestly rather than throwing because the
    // revision-conflict retry may reach for it.
    getInboxItemDetail: mockServerFn(async () =>
      reviewDetail(),
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
 * Every item command reads `isPending` on first render (the strip locks on all
 * six through `isHeaderCommandPending`), so all six must exist before any
 * markup does. None is ever driven: what a command does with a decision is
 * `inbox-handling-cycle.spec.ts`'s and the unit suites', not this width's.
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

function makeDetailState(overrides: Partial<InboxDetailState> = {}): InboxDetailState {
  return {
    detail: reviewDetail(),
    notes: [],
    isLoading: false,
    currentItem: reviewItem,
    updateStatus: idleCommand(reviewItem) as unknown as InboxDetailState['updateStatus'],
    escalate: idleCommand(reviewItem) as unknown as InboxDetailState['escalate'],
    resolveEscalation: idleCommand(
      reviewItem,
    ) as unknown as InboxDetailState['resolveEscalation'],
    assign: idleCommand(reviewItem) as unknown as InboxDetailState['assign'],
    markFeedbackHandled: refuses as unknown as InboxDetailState['markFeedbackHandled'],
    correctFeedbackHandlingOutcome:
      refuses as unknown as InboxDetailState['correctFeedbackHandlingOutcome'],
    refetch: () => {},
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    error: null,
    lastMarkedId: null,
    ...overrides,
  }
}

// ─── assertion helpers ───────────────────────────────────────────────────────

type Canvas = ReturnType<typeof within>

/** The sheet is a Radix portal — its markup is on `document.body`. */
const pane = (): Canvas => within(document.body)

/**
 * The three things that must be true of this surface in EVERY populated state,
 * at every width, whatever the item is.
 *
 * The dismissal is first because it is the one control a phone cannot do
 * without: below `sm` the sheet covers the list completely, `showCloseButton`
 * is false so the primitive's own X is gone, and there is no Escape key. If
 * this control is missing or renamed, a manager is trapped in the pane — which
 * no other assertion in this file would notice.
 */
function expectTheMobileFrame(canvas: Canvas): void {
  const back = canvas.getByRole('button', { name: BACK })
  expect(back).toBeVisible()
  expect(back).toBeEnabled()
  // Row 17: the triage journey asserts this pane holds no control named
  // exactly `Close`. The mobile dismissal is the likeliest place to break it.
  expect(canvas.queryAllByRole('button', { name: 'Close' })).toHaveLength(0)
  // Region 2 — present whether the item is a review or feedback, open or shut.
  expect(canvas.getByRole('region', { name: 'Case status' })).toBeVisible()
}

/** Region 3 exists and carries the guest's own words. */
function expectGuestMessage(canvas: Canvas, label: string, text: string): void {
  expect(canvas.getByRole('article', { name: label })).toBeVisible()
  expect(canvas.getByText(text)).toBeVisible()
}

/** No opaque identifier may reach any region, for any reason. */
/**
 * An event line by what a reader sees: the paragraph whose whole text starts
 * with `words` and then the ` · ` before the time. Row 11 puts the actor, the
 * verb and the object in separate spans, so no single element owns the
 * sentence; the separator keeps `escalated` from matching a longer line. Same
 * matcher as `inbox-thread.stories.tsx`.
 */
function eventSentence(words: string) {
  return (_content: string, element: Element | null): boolean =>
    element?.tagName === 'P' &&
    (element.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(`${words} · `)
}

function expectNoRawIds(): void {
  expect(document.body.textContent ?? '').not.toContain('user-')
}

// ─── meta ────────────────────────────────────────────────────────────────────

/**
 * 390 x 844 for the whole file — `mobileStaff` from `.storybook/preview.tsx`,
 * which really is the runner's window here (see the header). A story that wants
 * another width overrides it; both that do say why.
 *
 * AccountAdmin by default, so every affordance row 15 has to fit is actually
 * rendered: `inbox.manage` puts Escalate / Resolve and the reopen menu in the
 * pane, and `reply.manage` mounts the reply surface. A narrower role would make
 * the pane fit by having less in it.
 */
const meta: Meta<typeof InboxDetailSheet> = {
  title: 'Inbox/Mobile 390',
  component: InboxDetailSheet,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'mobileStaff' },
  },
  args: {
    open: true,
    onOpenChange: () => {},
    item: reviewItem,
    detailState: makeDetailState(),
    detailFns: detailFns(),
    currentUser: { id: VIEWER_ID },
    assignmentOptions,
  },
}
export default meta
type Story = StoryObj<typeof InboxDetailSheet>

// ─── the review pane ─────────────────────────────────────────────────────────

/**
 * Open. The whole anatomy on one phone screen: dismissal, case toolbar with a
 * live reply-due detail, the guest's review, and a composer offering both
 * surfaces.
 */
export const ReviewOpen: Story = {
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Open')).toBeVisible()
    await expect(canvas.getByText('Reply due in 31 h')).toBeVisible()
    expectGuestMessage(canvas, 'Guest review', REVIEW_TEXT)
    const rating = canvas.getByText('4.0').closest('[data-slot="star-rating"]')
    await expect(rating).toBeVisible()
    await expect(rating?.previousElementSibling).toHaveTextContent(
      reviewItem.reviewerName ?? '',
    )
    // Region 4, both surfaces offered — the segment's two names are the ones
    // three e2e journeys address.
    await expect(canvas.getByRole('tab', { name: REPLY_TAB })).toBeVisible()
    await expect(canvas.getByRole('tab', { name: NOTE_TAB })).toBeVisible()
    expectNoRawIds()
  },
}

/**
 * Closed. The one state that carries a work-status control, and the only menu
 * in region 2 — its single move is forward.
 */
export const ReviewClosed: Story = {
  args: {
    item: closedReviewItem,
    detailState: makeDetailState({
      currentItem: closedReviewItem,
      detail: reviewDetail({
        item: closedReviewItem,
        responseTarget: repliedOnTimeTarget,
      }),
    }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    const status = canvas.getByRole('button', { name: /work status/i })
    await expect(status).toHaveAccessibleName(/^Work status: Closed$/)
    await expect(canvas.getByText('Replied on time')).toBeVisible()
    // A phone is where a menu is most likely to open off the edge of the
    // world. Roles and names are assertable here; the rectangle is not.
    await userEvent.click(status)
    const reopen = await canvas.findByRole('menuitem', { name: 'Reopen' })
    await waitFor(() => expect(reopen).toBeVisible())
    await expect(canvas.queryByRole('menuitem', { name: 'Close' })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(canvas.queryByRole('menuitem')).toBeNull())
  },
}

/**
 * Escalated. Since plan v2.1 row 5 the escalation lives in region 2, as the
 * toolbar's last two members: the `Resolve` control, a glyph square at this
 * width, and after it the `Escalated` fact, which keeps its word here — the
 * width where a wordless red square was all the pane had to say until review.
 * The fact is also the control's description. Region 1 no longer carries
 * either, which is the width the header was measured short of in v1.
 */
export const ReviewEscalated: Story = {
  args: {
    item: escalatedReviewItem,
    detailState: makeDetailState({
      currentItem: escalatedReviewItem,
      detail: reviewDetail({ item: escalatedReviewItem }),
    }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    // Row 17 keeps this name verbatim across the rebuild, and two e2e journeys
    // click it page-wide with `exact: true`, so there must be exactly one. (A
    // string `name` is already an exact match in Testing Library.)
    const toolbar = within(canvas.getByRole('region', { name: 'Case status' }))
    const resolve = toolbar.getByRole('button', { name: 'Resolve' })
    await expect(resolve).toBeVisible()
    await expect(resolve).toHaveAccessibleDescription('Escalated')
    await expect(toolbar.getByText('Escalated')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Resolve' })).toHaveLength(1)
  },
}

/** Overdue — the negative mood, with a unit and a sign, never a bare number. */
export const ReviewOverdue: Story = {
  args: {
    detailState: makeDetailState({
      detail: reviewDetail({ responseTarget: overdueTarget }),
    }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Overdue by 2 d')).toBeVisible()
  },
}

// ─── the feedback pane ───────────────────────────────────────────────────────

/**
 * A private-feedback item, open. Row 10's claim is that this is the SAME four
 * regions with two words swapped and one control moved — which is a claim about
 * how it fits, and therefore a claim this width gets to check.
 */
export const FeedbackOpen: Story = {
  args: {
    item: feedbackItem,
    detailState: makeDetailState({
      currentItem: feedbackItem,
      detail: feedbackDetail(feedbackItem, OPEN_CYCLE),
    }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Needs attention')).toBeVisible()
    expectGuestMessage(canvas, 'Guest feedback', FEEDBACK_COMMENT)
    // One mode is not a choice, so region 4 drops the segment.
    await expect(canvas.queryAllByRole('tab')).toHaveLength(0)
    // Collapsed (row 15), the bar reads for the one surface there is — and
    // `Mark as handled` keeps its place beside it. That pairing is the point:
    // collapsing gives the manager back the viewport, it does not take away
    // the action the item exists for.
    await expect(canvas.getByRole('button', { name: NOTE_BAR })).toBeVisible()
    await expect(canvas.getByRole('button', { name: MARK_HANDLED })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: NOTE_SUBMIT })).toBeNull()
    // And the form is one tap away, on the surface the bar names.
    await userEvent.click(canvas.getByRole('button', { name: NOTE_BAR }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: NOTE_SUBMIT })).toBeVisible(),
    )
    await expect(canvas.getByRole('textbox', { name: NOTE_FIELD })).toHaveFocus()
    expectNoRawIds()
  },
}

/** Handled — the outcome word, and no second chance to record one. */
export const FeedbackHandled: Story = {
  args: {
    item: closedFeedbackItem,
    detailState: makeDetailState({
      currentItem: closedFeedbackItem,
      detail: feedbackDetail(closedFeedbackItem, HANDLED_CYCLE),
    }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText(/^Handled · /)).toBeVisible()
    await expect(canvas.queryAllByRole('button', { name: MARK_HANDLED })).toHaveLength(0)
    expectNoRawIds()
  },
}

/**
 * Withdrawn. `Handled` would assert a human judgement the domain refuses to
 * record for this cycle, forever — so the chip has a third word and the region
 * says why in a sentence instead of offering an action.
 */
export const FeedbackWithdrawn: Story = {
  args: {
    item: closedFeedbackItem,
    detailState: makeDetailState({
      currentItem: closedFeedbackItem,
      detail: feedbackDetail(closedFeedbackItem, WITHDRAWN_CYCLE),
    }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Closed — no outcome')).toBeVisible()
    await expect(canvas.getByText(WITHDRAWN_SENTENCE)).toBeVisible()
    await expect(canvas.queryAllByRole('button', { name: MARK_HANDLED })).toHaveLength(0)
    // A manager may always write a note about a feedback item, including one
    // nothing can ever be recorded against — behind row 15's bar, like every
    // other writing surface on this width, and reachable from it.
    await expect(canvas.getByRole('button', { name: NOTE_BAR })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: NOTE_BAR }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: NOTE_SUBMIT })).toBeVisible(),
    )
  },
}

// ─── the thread ──────────────────────────────────────────────────────────────

/**
 * Events. Three history kinds in one scroller at 390 px, each a sentence rather
 * than a row of columns — the shape that survives a narrow pane.
 */
export const ThreadWithEvents: Story = {
  args: {
    detailFns: detailFns([OPENED_FROM_GOOGLE, ASSIGNED_TO_GRACE, ESCALATED]),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(await canvas.findByText('Opened from Google')).toBeVisible()
    // Plan v2.1 row 11: actor · verb · object. The assignment and the
    // escalation were Ada's, so each line leads with her name; the opening was
    // Google's and names nobody. The parts are separate spans, so the lines are
    // found by the paragraph's whole text rather than by one element's.
    await expect(
      canvas.getByText(eventSentence('Ada Lovelace assigned this to Grace Hopper')),
    ).toBeVisible()
    await expect(
      canvas.getByText(eventSentence('Ada Lovelace escalated this')),
    ).toBeVisible()
    expectNoRawIds()
  },
}

/**
 * Notes. An internal note is a message in the same thread as the events, and
 * carries the promise that the guest cannot see it in its accessible name, so
 * it reaches a reader on the phone sheet — where the composer's desktop-only
 * `Not visible to the guest` slot (plan row 16) never renders — and adds no
 * characters to the note's own text.
 */
export const ThreadWithNotes: Story = {
  args: {
    detailState: makeDetailState({ notes: [teamNote] }),
    detailFns: detailFns([OPENED_FROM_GOOGLE]),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    const note = canvas.getByRole('article', {
      name: 'Internal note from Ada Lovelace, not visible to the guest',
    })
    await expect(note).toBeVisible()
    await expect(within(note).getByText(NOTE_TEXT)).toBeVisible()
    expectNoRawIds()
  },
}

/**
 * The reply, in each state it can be read in. One story per state rather than
 * one with five replies, because the pane holds exactly one reply and the
 * actions offered are what change with it — and because axe then runs at 390 px
 * on each of the five, which is the point of the file.
 */
export const ThreadReplyAwaitingApproval: Story = {
  args: {
    detailState: makeDetailState({ detail: reviewDetail({ reply: pendingReply }) }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Awaiting approval')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Confirm & Publish/i })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Reject$/i })).toBeVisible()
    expectNoRawIds()
  },
}

export const ThreadReplyWaitingForGoogle: Story = {
  args: {
    detailState: makeDetailState({ detail: reviewDetail({ reply: approvedReply }) }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Waiting for Google')).toBeVisible()
    expectNoRawIds()
  },
}

export const ThreadReplyLiveOnGoogle: Story = {
  args: {
    detailState: makeDetailState({ detail: reviewDetail({ reply: publishedReply }) }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Live on Google')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Edit reply' })).toBeVisible()
    expectNoRawIds()
  },
}

/**
 * A reply written directly on Google is still shown in the closed thread.
 * Because it is provider-owned it has no edit action, and on a phone the only
 * composer control is the real note surface — never a conflicting Reply toggle.
 */
export const ClosedWithObservedGoogleReply: Story = {
  args: {
    item: closedReviewItem,
    detailState: makeDetailState({
      currentItem: closedReviewItem,
      detail: reviewDetail({
        item: closedReviewItem,
        reply: observedGoogleReply,
        responseTarget: repliedOnTimeTarget,
      }),
    }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Live on Google')).toBeVisible()
    await expect(canvas.getByText(observedGoogleReply.text)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Edit reply' })).toBeNull()
    await expect(canvas.getByRole('button', { name: NOTE_BAR })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: REPLY_BAR })).toBeNull()
    await expect(canvas.queryByRole('tablist')).toBeNull()
    expectNoRawIds()
  },
}

/**
 * Not published. Try again and NOTHING else: no server path changes the text of
 * a `publish_failed` reply, so an editor offered here could only ever fail to
 * save.
 */
export const ThreadReplyNotPublished: Story = {
  args: {
    detailState: makeDetailState({ detail: reviewDetail({ reply: failedReply }) }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Not published')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Edit reply' })).toBeNull()
    expectNoRawIds()
  },
}

/** Rejected — with the colleague's reason attributed, never left as loose prose. */
export const ThreadReplyRejected: Story = {
  args: {
    detailState: makeDetailState({ detail: reviewDetail({ reply: rejectedReply }) }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.getByText('Rejected')).toBeVisible()
    await expect(
      canvas.getByText('Too generic; please name the housekeeping fix we made.'),
    ).toBeVisible()
    expectNoRawIds()
  },
}

// ─── the composer ────────────────────────────────────────────────────────────

/**
 * Note mode at 390 px, reached the way a manager reaches it: by tapping the
 * other half of the segment.
 *
 * The switch is the one thing in region 4 that has to survive a narrow pane
 * intact — `inbox-triage.spec.ts:166, 213` walk it — and both panels stay
 * MOUNTED across it (`forceMount` plus an explicit `hidden`), which is why the
 * reply field is asserted not-visible rather than absent. A `hidden` panel is
 * honoured by the UA stylesheet alone, so that assertion is real in a runner
 * with no Tailwind, where a height-based one would not be.
 */
export const ComposerNoteMode: Story = {
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await userEvent.click(canvas.getByRole('tab', { name: NOTE_TAB }))
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: NOTE_FIELD })).toBeVisible(),
    )
    await expect(canvas.getByRole('button', { name: NOTE_SUBMIT })).toBeVisible()
    // Still MOUNTED, merely hidden — which is what keeps a half-written reply
    // from being discarded by one tap on `Internal note`, and the reason this
    // is asserted invisible rather than absent.
    //
    // Found by label and narrowed to the textarea: `getByRole` excludes a
    // `display: none` subtree altogether, so it cannot express "present but
    // not visible"; and `Public reply` is the accessible name of three things
    // at once here — the tab, the panel it controls (via `aria-labelledby`)
    // and the box itself. The tag check is what makes this the box.
    const replyBoxes = canvas
      .getAllByLabelText(REPLY_FIELD)
      .filter((element: HTMLElement) => element.tagName === 'TEXTAREA')
    await expect(replyBoxes).toHaveLength(1)
    await expect(replyBoxes[0]).not.toBeVisible()
  },
}

/**
 * Row 9's live edit, opened from the thread at 390 px: the band appears, and
 * the other surface refuses the switch while it is open.
 *
 * `aria-disabled`, never the native attribute — a locked segment has something
 * to explain, and a natively disabled control leaves the tab order and takes
 * its `aria-describedby` with it, so the one line saying why would be reachable
 * by no keyboard and no reader. That distinction is assertable here; the 44 px
 * the same control carries is not.
 */
export const ComposerEditingALiveReply: Story = {
  args: {
    detailState: makeDetailState({ detail: reviewDetail({ reply: publishedReply }) }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await userEvent.click(canvas.getByRole('button', { name: 'Edit reply' }))
    await waitFor(() => expect(canvas.getByText(EDITING_BAND)).toBeVisible())
    const noteTab = canvas.getByRole('tab', { name: NOTE_TAB })
    await expect(noteTab).toHaveAttribute('aria-disabled', 'true')
    await expect(noteTab).toHaveAttribute('aria-describedby')
  },
}

/**
 * Row 15's headline behaviour, now that it reaches this surface.
 *
 * This story was written as a tripwire — it asserted the gap, because
 * `ReplyComposer` implemented `collapse` and `inbox-detail-content.tsx` never
 * passed it, so on a phone the pane still opened with the composer expanded and
 * nothing else in this file would have noticed (every other story asserts
 * controls that exist in BOTH states). Wiring the prop failed the story, which
 * is what it was for; this is its inverted form.
 *
 * The measurement behind it: at 390x844 the expanded region takes 506 px —
 * the `max-h-[60%]` cap, spent in full on an EMPTY composer — and leaves the
 * thread 237 px. Collapsed it is 133 px and the thread gets 610. The guest's
 * words are what an item the manager has just opened should show them.
 */
export const MobileComposerOpensCollapsed: Story = {
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    // The bar is the whole of region 4 until the manager asks for more.
    await expect(canvas.getByRole('button', { name: REPLY_BAR })).toBeVisible()
    // The panels are hidden, not unmounted — so the writing surface is in the
    // document and out of every role query, which is what makes a hidden panel
    // zero pixels tall without losing the caret target or `aria-controls`.
    await expect(canvas.queryByRole('textbox', { name: REPLY_FIELD })).toBeNull()
    // And the segment is the SAME control in both states: one tap on it opens
    // the region onto that surface.
    await expect(canvas.getByRole('tab', { name: NOTE_TAB })).toBeVisible()
  },
}

/** Tapping the bar expands the region and puts the caret in the reply box. */
export const MobileBarOpensTheComposer: Story = {
  play: async () => {
    const canvas = pane()
    await userEvent.click(canvas.getByRole('button', { name: REPLY_BAR }))
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: REPLY_FIELD })).toBeVisible(),
    )
    // One-way: there is no control that collapses it again, which is why the
    // bar is the only disclosure and carries `aria-expanded="false"`.
    await expect(canvas.queryByRole('button', { name: REPLY_BAR })).toBeNull()
  },
}

/**
 * A saved draft outranks the bar. `hasPendingComposerWork` is the pane's half
 * of row 15's safety rule (`composer-policy.ts`, unit-tested): work that exists
 * on ARRIVAL is never put behind a bar, because the manager never focused the
 * composer on this visit and so nothing has latched it open.
 */
export const MobileDraftReplyOpensExpanded: Story = {
  args: {
    detailState: makeDetailState({
      detail: reviewDetail({
        reply: makeReply({ status: 'draft', text: 'Thank you for the kind wo' }),
      }),
    }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(canvas.queryByRole('button', { name: REPLY_BAR })).toBeNull()
    await expect(canvas.getByRole('textbox', { name: REPLY_FIELD })).toBeVisible()
  },
}

// ─── loading and error ───────────────────────────────────────────────────────

/**
 * Loading. The header is real before the body is — which is what keeps the
 * dismissal reachable while a slow phone network is still fetching, the one
 * state where being trapped in the pane would last longest.
 */
export const LoadingState: Story = {
  args: {
    detailState: makeDetailState({
      isLoading: true,
      currentItem: null,
      detail: null,
    }),
  },
  play: async () => {
    const canvas = pane()
    await expect(canvas.getByRole('button', { name: BACK })).toBeVisible()
    // The body is a skeleton, so neither region 2 nor region 4 is mounted yet.
    await expect(canvas.queryByRole('region', { name: 'Case status' })).toBeNull()
    await expect(canvas.queryAllByRole('tab')).toHaveLength(0)
  },
}

/** Error. Retry is reachable, and so is the way out. */
export const ErrorState: Story = {
  args: {
    detailState: makeDetailState({
      error: 'Failed to load inbox detail.',
      detail: null,
    }),
  },
  play: async () => {
    const canvas = pane()
    await expect(canvas.getByRole('button', { name: BACK })).toBeVisible()
    await expect(canvas.getByText('Failed to load inbox detail.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeVisible()
  },
}

// ─── the other two widths the pane is gated at ───────────────────────────────

/**
 * 320 px — the narrowest viewport `accessibility.spec.ts` reflows at, and the
 * width where region 1 was measured to fail before this PR: the header's fixed
 * children cost 252 px of 320, the property name absorbed all of the deficit
 * and came out 0 px wide, and the platform tag overflowed and was clipped. A
 * phone read `· google` and nothing about which property.
 *
 * The fix is two `max-md:hidden`s, which is CSS and therefore inert here — so
 * this story does NOT claim the name is 75 px wide. It claims the two things
 * that are true without a stylesheet and that the fix must not break: the name
 * is in the document as text, and every control in regions 1 and 2 is still
 * reachable by role at the narrowest width the product supports. The geometry
 * is the Tailwind harness's and Playwright's.
 *
 * Plan v2.1 row 5 then took `Resolve` out of region 1 and made it the case
 * toolbar's third member, so the header measured above is 108 px roomier than
 * the one it describes. The item stays escalated here so the widest
 * composition of region 2 is the one on screen at 320.
 */
export const HeaderAt320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  args: {
    item: escalatedReviewItem,
    detailState: makeDetailState({
      currentItem: escalatedReviewItem,
      detail: reviewDetail({ item: escalatedReviewItem }),
    }),
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    await expect(
      canvas.getByText('Seaside Rooms at Whitstable Harbour Inn'),
    ).toBeVisible()
    await expect(
      within(canvas.getByRole('region', { name: 'Case status' })).getByRole('button', {
        name: 'Resolve',
      }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'More review actions' }),
    ).toBeVisible()
  },
}

/**
 * Light, at 390. Dark is this project's default and every story above runs in
 * it, so without this the axe `color-contrast` pass — which is on — would only
 * ever have seen one of the two palettes the pane ships.
 */
export const ReviewOpenLight: Story = {
  parameters: {
    theme: 'light',
    viewport: { defaultViewport: 'mobileStaff' },
  },
  play: async () => {
    const canvas = pane()
    expectTheMobileFrame(canvas)
    expectGuestMessage(canvas, 'Guest review', REVIEW_TEXT)
  },
}

/**
 * The desktop half of row 15's breakpoint claim, on the SAME surface.
 *
 * `useIsMobile` is a real `matchMedia` subscription and the runner's window is
 * really 1440 px here, so this is the hook answering `false` — the same
 * mechanism, measured from the other side. It is in this file rather than a
 * desktop one because a breakpoint is only a claim about two widths together:
 * were `page.viewport` to stop working, every 390 px story above would silently
 * become a 1200 px story and still pass, and this one would not notice either —
 * but the composer-collapse pair in `reply-composer-collapsed.stories.tsx`
 * would, which is why that file keeps both sides too.
 */
export const SheetAtDesktopWidth: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  decorators: [withRole('PropertyManager')],
  play: async () => {
    const canvas = pane()
    // Still the sheet, still the mobile dismissal — this surface is only ever
    // mounted below `md` by the page, so the width alone must not change what
    // it renders.
    await expect(canvas.getByRole('button', { name: BACK })).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: REPLY_FIELD })).toBeVisible()
  },
}
