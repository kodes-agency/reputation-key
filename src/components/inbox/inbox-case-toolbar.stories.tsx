// Inbox case toolbar — region 2 of the detail pane (plan v2.1 rows 2-6).
//
// The one idea these stories exist to hold still: a CONTROL, a FACT and a
// DETAIL no longer wear the same pill. A control is an outlined button inside
// the `ButtonGroup` (the closed status, the owner menu, Escalate / Resolve). A
// fact is text with a glyph and nothing to press (the open status, an owner or
// an escalation the viewer has no move on). A detail is that text with a
// dotted underline that opens a popover (reply due). v1 drew all three as one
// row of identical chips, so `Open`, `Not measured` and `Unassigned` read as
// the same kind of thing.
//
// What a play here CAN prove is the half of that idea that lives in the
// accessibility tree and the DOM: which of the three is a `button`, what it is
// named and described by, what it opens, which callback a press issues, which
// glyph a mark draws, and which members carry `data-case-fact` — the hook the
// group's edge rules find facts by (`inbox-case-member.tsx`). What it CANNOT
// prove is the other half — outline vs no box, 32 vs 36 px, the dotted
// underline, a control's label dropping to `sr-only` below `md`. `vitest.config.ts`'s storybook project
// builds the preview with no Tailwind plugin, so every utility class is inert
// under the gate (measured in v1: a probe classed `flex overflow-x-auto px-5`
// computed to `display: block; overflow-x: visible; padding-left: 0px`). No
// play below asserts a class or a pixel; the geometry is `pnpm storybook` by
// eye and PR 5's Playwright harness by measurement.
//
// Every required state has a 720 px story and a 390 px twin. The twin shares
// the play, because with Tailwind inert the DOM is identical at both widths —
// which is itself the claim worth making: nothing is REMOVED at 390 (a
// control's label goes `sr-only`, never away, and a fact's words never go at
// all), so the same roles and names must hold. Where the pane is only 720 px (the desktop split) or 390 px (the
// phone sheet), `pnpm storybook` shows the real layout.
//
// Two permission splits drive the branches, reached with `withRole`. Member
// holds `inbox.write` but not `inbox.manage` — reopening, reassigning and
// escalating are manager moves. Member also holds no `feedback.*` permission,
// and every inbox command is `inbox.write` AND the owning context's handle
// permission, so the same Member who may claim a review gets no menu on a
// private-feedback item.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { feedbackId, userId } from '#/shared/domain/ids'
import { InboxCaseToolbar } from './inbox-case-toolbar'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type {
  FeedbackHandlingState,
  InboxItem,
  ResponseTargetView,
} from '#/contexts/inbox/application/public-api'
import type { InboxAssignmentOption } from './inbox-owner-view'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/**
 * The toolbar takes the instant its countdown reads as a prop, so every
 * fixture below is pinned to one date and the same date is handed back as
 * `now` (see `meta.args`). Nothing here reads the wall clock: the labels the
 * plays assert ("31 h", "6 h", "2 d") are arithmetic over two fixed numbers.
 * The toolbar starts no interval when it is given a clock.
 */
const STORY_NOW = new Date('2026-02-01T12:00:00Z')

/** A fixture instant, in whole hours either side of `STORY_NOW`. */
const hoursFromNow = (hours: number): Date =>
  new Date(STORY_NOW.getTime() + hours * HOUR_MS)

// ─── widths ──────────────────────────────────────────────────────────────────

/** The desktop pane's share of a 1440 px split, and the plan's canvas width. */
const PANE_WIDTH_PX = 720
/** The staff phone the sheet is designed at (row 20). */
const PHONE_WIDTH_PX = 390

/**
 * The 390 px twin's parameters. `paneWidth` is read by the meta decorator;
 * `viewport` is what makes `max-md:` apply in `pnpm storybook`, where Tailwind
 * compiles — a 390 px box inside a desktop window would otherwise lay the
 * members out at their desktop size. The viewport parameter is not a
 * dependable constraint in the Vitest runner (`inbox-page.stories.tsx:439`
 * records it resizing nothing), which is why the width is also the story's own.
 */
const PHONE = {
  paneWidth: PHONE_WIDTH_PX,
  viewport: { defaultViewport: 'mobileStaff' },
} as const

// ─── people ──────────────────────────────────────────────────────────────────

// The viewer is deliberately absent from the directory: on a small account the
// only manager can be missing from the candidate list, and the menu still has
// to offer them the item — and the disc still has to draw their initials, from
// the session name rather than the directory.
const VIEWER: InboxCurrentUser = { id: 'user-viewer', name: 'Maria Petrova', image: null }
const GRACE_ID = 'user-grace'
const ADA_ID = 'user-ada'

const assignmentOptions: ReadonlyArray<InboxAssignmentOption> = [
  { userId: GRACE_ID, name: 'Grace Hopper' },
  { userId: ADA_ID, name: 'Ada Lovelace' },
]

// ─── items ───────────────────────────────────────────────────────────────────

const reviewItem: InboxItem = makeInboxItem({
  id: 'rev-toolbar',
  sourceType: 'review',
  status: 'open',
  rating: 4,
})

const closedItem: InboxItem = { ...reviewItem, status: 'closed' }

const escalatedItem: InboxItem = { ...reviewItem, isEscalated: true }

/**
 * `isEscalated` stays set once acknowledged (`domain/types.ts:164-169`, ADR
 * 0023), so a resolved escalation is the flag AND a resolution instant. The
 * toolbar is handed `isEscalationActive` already derived by
 * `inbox-case-toolbar-props.ts` — its unit test proves this item derives
 * `false` — and each story below passes the value that selector would.
 */
const resolvedEscalationItem: InboxItem = {
  ...escalatedItem,
  escalationResolvedAt: hoursFromNow(-2),
}

const feedbackItem: InboxItem = makeInboxItem({
  id: 'fb-toolbar',
  sourceType: 'feedback',
  status: 'open',
  rating: 2,
})

const closedFeedbackItem: InboxItem = { ...feedbackItem, status: 'closed' }

const assignedTo = (item: InboxItem, holder: string): InboxItem => ({
  ...item,
  assignedTo: holder as InboxItem['assignedTo'],
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

type OutcomeFact = NonNullable<FeedbackHandlingState['currentOutcome']>

const FOLLOW_UP_COMPLETED: OutcomeFact = {
  id: 'outcome-1',
  inboxItemId: feedbackItem.id,
  organizationId: feedbackItem.organizationId,
  propertyId: feedbackItem.propertyId,
  feedbackId: feedbackId('fb-toolbar'),
  cycleNumber: 1,
  sourceRevision: 1,
  outcomeRevision: 1,
  outcome: 'follow_up_completed',
  internalNote: null,
  recordedBy: userId(ADA_ID),
  recordedAt: hoursFromNow(-3),
  completionAt: hoursFromNow(-3),
  deadlineResult: 'on_time',
  supersedesOutcomeId: null,
}

const HANDLED_CYCLE: FeedbackHandlingState = {
  ...OPEN_CYCLE,
  stateRevision: 2,
  status: 'closed',
  closeReason: 'private_feedback_handled',
  currentOutcome: FOLLOW_UP_COMPLETED,
  history: [FOLLOW_UP_COMPLETED],
}

/**
 * Withdrawn by the guest: the domain refuses a manager outcome for this cycle
 * forever, so the status reads `Closed — no outcome` rather than `Handled`
 * (`feedback-handling-presentation.ts`, `feedbackHandlingStatusLabel`).
 */
const WITHDRAWN_CYCLE: FeedbackHandlingState = {
  ...OPEN_CYCLE,
  stateRevision: 2,
  status: 'closed',
  closeReason: 'guest_withdrawn',
}

// ─── response targets ────────────────────────────────────────────────────────

// A measured Google-review cycle, still running. Every other target below is
// this one with the fields the presenter actually branches on swapped.
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
  startAt: hoursFromNow(-17),
  dueAt: hoursFromNow(31),
  completionAt: null,
  result: null,
  stopReason: null,
  propertyTimezone: 'America/New_York',
  evaluation: { state: 'active', overdue: false, elapsedMinutes: 1_020 },
}

const dueSoonTarget: ResponseTargetView = { ...activeTarget, dueAt: hoursFromNow(6) }

const overdueTarget: ResponseTargetView = {
  ...activeTarget,
  dueAt: hoursFromNow(-48),
  evaluation: { state: 'active', overdue: true, elapsedMinutes: 5_760 },
}

const repliedOnTimeTarget: ResponseTargetView = {
  ...activeTarget,
  completionAt: hoursFromNow(-1),
  result: 'on_time',
  stopReason: 'confirmed_on_google',
  evaluation: { state: 'completed', overdue: false, elapsedMinutes: 960 },
}

const repliedLateTarget: ResponseTargetView = {
  ...activeTarget,
  dueAt: hoursFromNow(-20),
  completionAt: hoursFromNow(-1),
  result: 'late',
  stopReason: 'confirmed_on_google',
  evaluation: { state: 'completed', overdue: true, elapsedMinutes: 4_020 },
}

// An onboarding import has no reliable start, so the cycle carries no duration,
// no policy and no due time. v1 rendered that absence as a popover chip; row 6
// renders nothing at all.
const notMeasuredTarget: ResponseTargetView = {
  ...activeTarget,
  eligibility: 'historical_onboarding',
  durationMinutes: null,
  policySource: null,
  policyVersion: null,
  startAt: null,
  dueAt: null,
  evaluation: { state: 'excluded', overdue: false, elapsedMinutes: null },
}

const feedbackTarget: ResponseTargetView = {
  ...activeTarget,
  inboxItemId: feedbackItem.id,
  targetKind: 'private_feedback_handling',
  dueAt: hoursFromNow(6),
}

const handledOnTimeTarget: ResponseTargetView = {
  ...feedbackTarget,
  completionAt: hoursFromNow(-3),
  result: 'on_time',
  stopReason: null,
  evaluation: { state: 'completed', overdue: false, elapsedMinutes: 840 },
}

// ─── meta ────────────────────────────────────────────────────────────────────

const onAssign = fn()
const onReopen = fn()
const onEscalate = fn()
const onResolveEscalation = fn()

const meta: Meta<typeof InboxCaseToolbar> = {
  title: 'Inbox/Case Toolbar',
  component: InboxCaseToolbar,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen', paneWidth: PANE_WIDTH_PX },
  decorators: [
    // The width is the story's own, as an inline style: an arbitrary Tailwind
    // width would be inert in the Vitest project and, built from a variable,
    // would never be generated by `pnpm storybook` either. A 390 px twin sets
    // `parameters.paneWidth` (see `PHONE`).
    (Story, { parameters }) => (
      <div
        style={{
          width:
            typeof parameters.paneWidth === 'number'
              ? parameters.paneWidth
              : PANE_WIDTH_PX,
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    item: reviewItem,
    target: null,
    feedbackHandling: null,
    assignmentOptions,
    currentUser: VIEWER,
    isPending: false,
    isEscalationActive: false,
    now: STORY_NOW,
    onReopen,
    onAssign,
    onEscalate,
    onResolveEscalation,
  },
}
export default meta
type Story = StoryObj<typeof InboxCaseToolbar>

// ─── helpers ─────────────────────────────────────────────────────────────────

type Canvas = ReturnType<typeof within>

/** Region 2 itself — the name the pane's own stories address it by. */
function toolbarOf(canvas: Canvas): HTMLElement {
  return canvas.getByRole('region', { name: 'Case status' })
}

/**
 * The `ButtonGroup`: status, owner, escalation. Everything that is a control
 * lives in here; the reply-due detail deliberately does not (row 3 puts it on
 * the trailing edge, outside the group).
 */
function controlsOf(canvas: Canvas): Canvas {
  return within(within(toolbarOf(canvas)).getByRole('group'))
}

/**
 * The text of every FACT in the group, in order. A fact is marked
 * `data-case-fact` — the attribute `CASE_GROUP_CLASS` restores a neighbouring
 * control's edge by — so a fact that lost it would still read here as missing.
 */
function factTexts(canvas: Canvas): ReadonlyArray<string> {
  const group = within(toolbarOf(canvas)).getByRole('group')
  return Array.from(group.querySelectorAll(':scope > [data-case-fact]'), (fact) =>
    (fact.textContent ?? '').trim(),
  )
}

/**
 * Which person glyph a mark drew. Lucide names every icon in its `class`
 * (`lucide-user-round`, `lucide-user-round-check`) — the icon's identity, not a
 * Tailwind utility, so it holds in this project. `null` when the mark is a disc.
 */
function personGlyph(element: HTMLElement): 'nobody' | 'somebody' | null {
  if (element.querySelector('svg.lucide-user-round-check')) return 'somebody'
  if (element.querySelector('svg.lucide-user-round')) return 'nobody'
  return null
}

/** The reply-due detail's trigger, by the name v1 gave it and row 6 kept. */
const DETAIL_NAME = /\. Show timing details$/

/** Every menu item the owner control is currently offering, in order. */
async function openOwnerMenu(label: string): Promise<ReadonlyArray<string>> {
  const body = within(document.body)
  await userEvent.click(body.getByRole('button', { name: `Assignment: ${label}` }))
  const items = await body.findAllByRole('menuitem')
  await waitFor(() => expect(items[0]).toBeVisible())
  return items.map((item) => item.textContent?.trim() ?? '')
}

async function closeMenu(): Promise<void> {
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(within(document.body).queryByRole('menuitem')).toBeNull())
}

// ─── status ──────────────────────────────────────────────────────────────────

/**
 * Open review, the everyday case. The status is a FACT: an open item has no
 * status move (`update-inbox-status.ts:165` refuses a manual close), so `Open`
 * is text inside the group with no chevron and no button — which is also what
 * keeps the pane free of a control named `Close`. The owner and escalation
 * beside it ARE controls, and the reply-due text beside the group is a DETAIL:
 * a button, but one outside the group, named for what it shows.
 */
export const OpenReview: Story = {
  args: { target: activeTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const controls = controlsOf(canvas)

    await expect(controls.getByText('Open')).toBeVisible()
    await expect(factTexts(canvas)).toEqual(['Open'])
    await expect(canvas.queryByRole('button', { name: /work status/i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Open/ })).toBeNull()

    await expect(
      controls.getByRole('button', { name: 'Assignment: Unassigned' }),
    ).toBeEnabled()
    await expect(controls.getByRole('button', { name: 'Escalate' })).toBeEnabled()

    const detail = canvas.getByRole('button', { name: DETAIL_NAME })
    await expect(detail).toHaveAccessibleName('Reply due in 31 h. Show timing details')
    await expect(canvas.getByText('Reply due in 31 h')).toBeVisible()
    await expect(controls.queryByRole('button', { name: DETAIL_NAME })).toBeNull()
  },
}
export const OpenReview390: Story = { ...OpenReview, parameters: PHONE }

/**
 * Closed review — the one status that is a CONTROL. Its only move is forward:
 * `Reopen`, which asks the pane to open its reason dialog and issues nothing
 * itself. The name `Work status: Closed` is pinned by three e2e journeys, and
 * the visible word is contained in it (WCAG 2.5.3).
 */
export const ClosedReview: Story = {
  args: { item: closedItem, target: repliedOnTimeTarget },
  play: async ({ canvasElement }) => {
    onReopen.mockClear()
    const canvas = within(canvasElement)
    const status = controlsOf(canvas).getByRole('button', { name: /work status/i })
    // The regex is load-bearing: Playwright's `name` is a substring match and
    // Testing Library's string form is exact, so the e2e suites and this gate
    // would otherwise disagree about what a plain 'Work status' means.
    await expect(status).toHaveAccessibleName(/^Work status: Closed$/)
    await expect(status).toHaveTextContent('Closed')
    await expect(factTexts(canvas)).toEqual([])

    await userEvent.click(status)
    const body = within(document.body)
    const reopen = await body.findByRole('menuitem', { name: 'Reopen' })
    await waitFor(() => expect(reopen).toBeVisible())
    await expect(body.getAllByRole('menuitem')).toHaveLength(1)
    await expect(body.queryByRole('menuitem', { name: 'Close' })).toBeNull()

    await userEvent.click(reopen)
    await waitFor(() => expect(onReopen).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(body.queryByRole('menuitem')).toBeNull())
  },
}
export const ClosedReview390: Story = { ...ClosedReview, parameters: PHONE }

/**
 * Private feedback, open. The anatomy holds and the vocabulary swaps: the
 * status fact reads `Needs attention`, and the detail counts down with
 * `Handle within`, never `Reply due in`.
 */
export const FeedbackOpen: Story = {
  args: { item: feedbackItem, target: feedbackTarget, feedbackHandling: OPEN_CYCLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(controlsOf(canvas).getByText('Needs attention')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /work status/i })).toBeNull()
    await expect(canvas.getByText('Handle within 6 h')).toBeVisible()
    await expect(canvas.queryByText(/reply due/i)).toBeNull()
  },
}
export const FeedbackOpen390: Story = { ...FeedbackOpen, parameters: PHONE }

/**
 * Feedback handled with a recorded outcome. The outcome is part of the status,
 * not decoration beside it, so it is in the control's accessible name as well
 * as its text — a reader that only hears the name still hears which outcome
 * closed the work.
 */
export const FeedbackHandled: Story = {
  args: {
    item: closedFeedbackItem,
    target: handledOnTimeTarget,
    feedbackHandling: HANDLED_CYCLE,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const status = controlsOf(canvas).getByRole('button', { name: /work status/i })
    await expect(status).toHaveAccessibleName(
      'Work status: Handled · Follow-up completed',
    )
    await expect(status).toHaveTextContent('Handled · Follow-up completed')
    await expect(canvas.getByText('Handled on time')).toBeVisible()
  },
}
export const FeedbackHandled390: Story = { ...FeedbackHandled, parameters: PHONE }

/**
 * Feedback closed with no outcome, because the guest withdrew it. `Handled`
 * would assert a judgement the domain will never let exist, so the word is
 * `Closed — no outcome`. The cycle's target was cancelled with it, which is a
 * `Not measured` target — and so no detail at all on the trailing edge.
 */
export const FeedbackClosedNoOutcome: Story = {
  args: { item: closedFeedbackItem, target: null, feedbackHandling: WITHDRAWN_CYCLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const status = controlsOf(canvas).getByRole('button', { name: /work status/i })
    await expect(status).toHaveAccessibleName('Work status: Closed — no outcome')
    await expect(canvas.queryByText(/^Handled/)).toBeNull()
    await expect(canvas.queryByRole('button', { name: DETAIL_NAME })).toBeNull()
  },
}
export const FeedbackClosedNoOutcome390: Story = {
  ...FeedbackClosedNoOutcome,
  parameters: PHONE,
}

/**
 * The same private-feedback item read by someone the server withholds
 * `feedbackHandling` from (`get-inbox-item-detail.ts:132`). The item kind must
 * still come from `item.sourceType`: a toolbar that inferred it from the
 * handling state would label private feedback `Open` / `Closed` for exactly
 * the audience least equipped to know what that means.
 */
export const FeedbackHandlingWithheld: Story = {
  args: { item: feedbackItem, target: feedbackTarget, feedbackHandling: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Needs attention')).toBeVisible()
    await expect(canvas.queryByText('Open')).toBeNull()
    await expect(canvas.queryByText('Closed')).toBeNull()
  },
}

// ─── escalation ──────────────────────────────────────────────────────────────

/**
 * Escalated, for a manager. Row 5 moved the header's button into the group as
 * its third member. The escalation is two things and they are drawn as two: a
 * CONTROL whose word says what a press does — `Resolve`, the name two e2e
 * journeys click with `exact: true` — and a FACT, `Escalated`, that says what
 * IS, after it. PR 2 first folded the state into the control (a negative fill
 * and a `title`), and on a phone, where the control is a glyph square, that
 * left a red square with no word on screen (review). The canvas's `Escalated`
 * could not go on the control instead: a visible word its name does not
 * contain fails WCAG 2.5.3. So the word is a fact, the fact is the control's
 * description, and the fact is not inside the button.
 */
export const Escalated: Story = {
  args: { item: escalatedItem, target: activeTarget, isEscalationActive: true },
  play: async ({ canvasElement }) => {
    onEscalate.mockClear()
    onResolveEscalation.mockClear()
    const canvas = within(canvasElement)
    const controls = controlsOf(canvas)

    const resolve = controls.getByRole('button', { name: 'Resolve' })
    await expect(resolve).toHaveAccessibleDescription('Escalated')
    await expect(canvas.queryByRole('button', { name: 'Escalate' })).toBeNull()
    // The state is printed, once, as the group's last member and outside the
    // button — a word inside it would change the name e2e clicks by.
    await expect(controls.getByText('Escalated')).toBeVisible()
    await expect(within(resolve).queryByText('Escalated')).toBeNull()
    await expect(factTexts(canvas)).toEqual(['Open', 'Escalated'])

    await userEvent.click(resolve)
    await expect(onResolveEscalation).toHaveBeenCalledTimes(1)
    await expect(onEscalate).not.toHaveBeenCalled()
  },
}
export const Escalated390: Story = { ...Escalated, parameters: PHONE }

/**
 * Light theme, escalated. Dark is this project's default, so without this the
 * axe `color-contrast` pass would only ever see the negative `Escalated` fact
 * in one of the two palettes it ships in.
 */
export const EscalatedLight: Story = {
  ...Escalated,
  parameters: { theme: 'light' },
}

/**
 * An escalation that was raised and then resolved. `isEscalated` is still
 * true — the flag is durable — so this is the state a predicate reading the
 * flag alone gets wrong: it must offer `Escalate` again, carry no escalated
 * description, and issue `escalate`, not `resolveEscalation`.
 */
export const EscalationResolved: Story = {
  args: {
    item: resolvedEscalationItem,
    target: activeTarget,
    isEscalationActive: false,
  },
  play: async ({ canvasElement }) => {
    onEscalate.mockClear()
    onResolveEscalation.mockClear()
    const canvas = within(canvasElement)

    const escalate = controlsOf(canvas).getByRole('button', { name: 'Escalate' })
    await expect(escalate).not.toHaveAccessibleDescription()
    await expect(canvas.queryByRole('button', { name: 'Resolve' })).toBeNull()
    await expect(canvas.queryByText('Escalated')).toBeNull()

    await userEvent.click(escalate)
    await expect(onEscalate).toHaveBeenCalledTimes(1)
    await expect(onResolveEscalation).not.toHaveBeenCalled()
  },
}
export const EscalationResolved390: Story = { ...EscalationResolved, parameters: PHONE }

// ─── reply due ───────────────────────────────────────────────────────────────

/**
 * Inside the last twelve hours the detail changes tone without changing shape
 * — the words carry the urgency, the tint only reinforces it, and neither is a
 * box.
 */
export const DueSoon: Story = {
  args: { target: dueSoonTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Reply due in 6 h')).toBeVisible()
    await expect(canvas.getByRole('button', { name: DETAIL_NAME })).toHaveAccessibleName(
      'Reply due in 6 h. Show timing details',
    )
  },
}
export const DueSoon390: Story = { ...DueSoon, parameters: PHONE }

/**
 * Light theme — axe runs over it too, so this is the contrast proof for the
 * warning text, the one tone with no token behind it until PR 3 adds `--warn`.
 */
export const DueSoonLight: Story = {
  parameters: { theme: 'light' },
  args: { target: dueSoonTarget },
}

/**
 * Past the target — a DETAIL, so it opens. The popover carries the sentence
 * the deleted response-target card used to hold, plus the exact due time in
 * the property's timezone; the toolbar itself stays one line.
 */
export const Overdue: Story = {
  args: { target: overdueTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const detail = canvas.getByRole('button', { name: /^Overdue by 2 d\./ })
    await expect(
      controlsOf(canvas).queryByRole('button', { name: DETAIL_NAME }),
    ).toBeNull()
    await userEvent.click(detail)

    const body = within(document.body)
    const sentence = await body.findByText(/remains open for follow-up/i)
    await waitFor(() => expect(sentence).toBeVisible())
    await expect(body.getByText('(America/New_York)')).toBeVisible()
    // Radix moves focus into a `role="dialog"`; it must announce as more than
    // "dialog" (axe `aria-dialog-name`). Named by its title, described by the
    // sentence.
    const dialog = body.getByRole('dialog', { name: 'Overdue by 2 d' })
    await expect(dialog).toHaveAccessibleDescription(sentence.textContent ?? '')

    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(body.queryByText(/remains open for follow-up/i)).toBeNull(),
    )
  },
}
export const Overdue390: Story = { ...Overdue, parameters: PHONE }

/** A completed cycle stops counting and reports its result instead. */
export const RepliedOnTime: Story = {
  args: { item: closedItem, target: repliedOnTimeTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Replied on time')).toBeVisible()
    await expect(canvas.getByRole('button', { name: DETAIL_NAME })).toHaveAccessibleName(
      'Replied on time. Show timing details',
    )
  },
}
export const RepliedOnTime390: Story = { ...RepliedOnTime, parameters: PHONE }

/**
 * Replied after the target. Still a completed result, still counted in
 * reporting, and the popover says so — `late` is neutral, not negative,
 * because nothing is left to act on.
 */
export const RepliedLate: Story = {
  args: { item: closedItem, target: repliedLateTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Replied late')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /^Replied late\./ }))

    const body = within(document.body)
    const sentence = await body.findByText(/after the saved target/i)
    await waitFor(() => expect(sentence).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByText(/after the saved target/i)).toBeNull())
  },
}
export const RepliedLate390: Story = { ...RepliedLate, parameters: PHONE }

/**
 * Excluded from reporting — an onboarding import with no trustworthy start.
 * v1 drew this ABSENCE of a fact as a popover chip, one more button in the
 * row's quietest state. Row 6 skips it: no text, no button, nothing on the
 * trailing edge — while the group beside it renders as usual.
 * `presentResponseTargetChip` still returns `Not measured` for a caller that
 * wants it (`response-target-chip.test.ts`); only the toolbar declines.
 */
export const NotMeasured: Story = {
  args: { target: notMeasuredTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(controlsOf(canvas).getByText('Open')).toBeVisible()
    await expect(canvas.queryByText('Not measured')).toBeNull()
    await expect(canvas.queryByRole('button', { name: /not measured/i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: DETAIL_NAME })).toBeNull()
  },
}
export const NotMeasured390: Story = { ...NotMeasured, parameters: PHONE }

// ─── owner ───────────────────────────────────────────────────────────────────

/**
 * Nobody holds it. The owner is a control with the person glyph and no disc —
 * a placeholder is never drawn as an initial — and a manager may hand it to
 * anyone, themselves included. `Unassign` is absent: releasing an unheld item
 * is not a move.
 */
export const Unassigned: Story = {
  args: { target: activeTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const owner = controlsOf(canvas).getByRole('button', {
      name: 'Assignment: Unassigned',
    })
    // The glyph is an `svg` with no text, so the whole text is the word: no
    // `U` disc was drawn for a person who does not exist.
    await expect(owner).toHaveTextContent(/^Unassigned$/)
    await expect(personGlyph(owner)).toBe('nobody')

    const labels = await openOwnerMenu('Unassigned')
    await expect(labels).toEqual(['Assign to me', 'Grace Hopper', 'Ada Lovelace'])
    await closeMenu()
  },
}

/**
 * Held by someone else. The opaque id resolves through the directory — a raw
 * user id is never rendered, as a label or as initials — and the disc draws
 * that person's initials beside their name. A manager gets every move the
 * server will accept: take it, hand it on, or release it.
 */
export const AssignedToSomeone: Story = {
  args: { item: assignedTo(reviewItem, GRACE_ID), target: activeTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const owner = controlsOf(canvas).getByRole('button', {
      name: 'Assignment: Grace Hopper',
    })
    await expect(within(owner).getByText('GH')).toBeInTheDocument()
    await expect(within(owner).getByText('Grace Hopper')).toBeInTheDocument()
    await expect(canvas.queryByText(GRACE_ID)).toBeNull()

    const labels = await openOwnerMenu('Grace Hopper')
    await expect(labels).toEqual([
      'Assign to me',
      'Grace HopperAssigned',
      'Ada Lovelace',
      'Unassign',
    ])
    await closeMenu()
  },
}
export const AssignedToSomeone390: Story = { ...AssignedToSomeone, parameters: PHONE }

/**
 * Held by someone the directory cannot name — a member whose role
 * `toInboxAssignmentOptions` filters out. The label falls back to `Assigned`,
 * and below `md` the trigger shows nothing but its mark, so the mark has to say
 * "somebody" on its own: before review it was the same `UserRound` an
 * unassigned item draws, and at 390 the two triggers were pixel-identical. The
 * held item draws `UserRoundCheck`.
 */
export const AssignedUnresolved: Story = {
  args: { item: assignedTo(reviewItem, 'user-not-in-directory'), target: activeTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const owner = controlsOf(canvas).getByRole('button', { name: 'Assignment: Assigned' })
    await expect(owner).toHaveTextContent(/^Assigned$/)
    await expect(personGlyph(owner)).toBe('somebody')
    await expect(canvas.queryByText('user-not-in-directory')).toBeNull()
  },
}
export const AssignedUnresolved390: Story = { ...AssignedUnresolved, parameters: PHONE }

/**
 * The viewer holds it. The label is `You`, and the disc is the viewer's OWN
 * initials — row 4's reason for widening the page's `currentUserId` into
 * `currentUser`. The viewer is not in the directory here, so `MP` can only
 * have come from the session's name.
 */
export const AssignedToYou: Story = {
  args: { item: assignedTo(reviewItem, VIEWER.id), target: activeTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const owner = controlsOf(canvas).getByRole('button', { name: 'Assignment: You' })
    await expect(within(owner).getByText('MP')).toBeInTheDocument()
    await expect(within(owner).getByText('You')).toBeInTheDocument()
    await expect(canvas.queryByText('Maria Petrova')).toBeNull()
    await expect(canvas.queryByText(VIEWER.id)).toBeNull()
  },
}
export const AssignedToYou390: Story = { ...AssignedToYou, parameters: PHONE }

// ─── member: facts where a manager has controls ─────────────────────────────

/**
 * Member, on a closed, escalated review held by someone else — the widest
 * composition a caller with NO move at all can reach. Every member of the
 * group becomes a fact: reopening is a manager move, stealing an item held by
 * Grace needs `inbox.manage`, and so does escalation. Not one control is
 * offered that the server would refuse — and not one fact is hidden either:
 * the escalation still says `Escalated`, because v1's chip showed it to
 * everyone and a manager-only control must not make that fact manager-only.
 * The reply-due detail is still a button, which is right: it opens timing
 * prose and issues nothing.
 */
export const MemberView: Story = {
  decorators: [withRole('Member')],
  args: {
    item: assignedTo({ ...closedItem, isEscalated: true }, GRACE_ID),
    target: repliedOnTimeTarget,
    isEscalationActive: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const controls = controlsOf(canvas)

    await expect(controls.queryAllByRole('button')).toHaveLength(0)
    await expect(controls.getByText('Closed')).toBeVisible()
    await expect(controls.getByText('GH')).toBeInTheDocument()
    await expect(controls.getByText('Grace Hopper')).toBeVisible()
    await expect(controls.getByText('Escalated')).toBeVisible()
    // All three members are facts, so all three carry the words — and none of
    // them is a box the group squares against a control.
    await expect(factTexts(canvas)).toEqual(['Closed', 'GHGrace Hopper', 'Escalated'])

    await expect(canvas.queryByRole('button', { name: /work status/i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Assignment:/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Resolve' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Escalate' })).toBeNull()
    await expect(canvas.getByRole('button', { name: DETAIL_NAME })).toBeEnabled()
  },
}
export const MemberView390: Story = { ...MemberView, parameters: PHONE }

/**
 * The same Member on an unclaimed, unescalated review may do exactly one
 * thing: claim it. Handing it to Grace or Ada is a manager move and must not
 * appear, and with nothing escalated there is no escalation fact to state — the
 * third member renders nothing and the group closes up around the owner.
 */
export const MemberClaimsUnassigned: Story = {
  decorators: [withRole('Member')],
  args: { target: activeTarget },
  play: async ({ canvasElement }) => {
    onAssign.mockClear()
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Escalate' })).toBeNull()
    await expect(canvas.queryByText('Escalated')).toBeNull()

    await expect(
      personGlyph(canvas.getByRole('button', { name: 'Assignment: Unassigned' })),
    ).toBe('nobody')
    const labels = await openOwnerMenu('Unassigned')
    await expect(labels).toEqual(['Assign to me'])

    const body = within(document.body)
    await userEvent.click(body.getByRole('menuitem', { name: 'Assign to me' }))
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith(VIEWER.id))
    await waitFor(() => expect(body.queryByRole('menuitem')).toBeNull())
  },
}

/** A Member holding the item may release it, and only that. */
export const MemberReleasesOwnItem: Story = {
  decorators: [withRole('Member')],
  args: { item: assignedTo(reviewItem, VIEWER.id), target: activeTarget },
  play: async () => {
    onAssign.mockClear()
    const labels = await openOwnerMenu('You')
    await expect(labels).toEqual(['Unassign'])

    const body = within(document.body)
    await userEvent.click(body.getByRole('menuitem', { name: 'Unassign' }))
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith(null))
    await waitFor(() => expect(body.queryByRole('menuitem')).toBeNull())
  },
}

/**
 * The second permission split, the one `inbox.write` alone does not answer.
 * Every inbox command runs `canHandleInboxSource` after its write check, so a
 * private-feedback item needs `inbox.write` AND `feedback.handle`, which
 * Member does not hold. The identical unassigned item that gives this Member
 * an `Assign to me` menu on a review must be a fact here.
 */
export const MemberSeesFeedbackOwnerAsText: Story = {
  decorators: [withRole('Member')],
  args: { item: feedbackItem, target: feedbackTarget, feedbackHandling: OPEN_CYCLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(controlsOf(canvas).getByText('Unassigned')).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /^Assignment:/ })).toBeNull()
  },
}

/**
 * A Member has no `member.list`, so the page never fetches the directory and
 * `assignmentOptions` is empty: every colleague's item resolves to `Assigned`.
 * It is a fact for this Member (taking it is a manager move), and the fact
 * keeps its word at every width. Beside `MemberClaimsUnassigned` this is the
 * pair a phone must tell apart — "taken by a colleague" against "free to
 * claim" — which before review differed only by a fill: both drew `UserRound`
 * and both hid their word below `md`.
 */
export const MemberSeesColleagueWithoutDirectory: Story = {
  decorators: [withRole('Member')],
  args: {
    item: assignedTo(reviewItem, GRACE_ID),
    target: activeTarget,
    assignmentOptions: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /^Assignment:/ })).toBeNull()
    await expect(factTexts(canvas)).toEqual(['Open', 'Assigned'])
    const fact = controlsOf(canvas).getByText('Assigned')
    await expect(fact).toBeVisible()
    await expect(personGlyph(fact.parentElement as HTMLElement)).toBe('somebody')
    await expect(canvas.queryByText(GRACE_ID)).toBeNull()
  },
}
export const MemberSeesColleagueWithoutDirectory390: Story = {
  ...MemberSeesColleagueWithoutDirectory,
  parameters: PHONE,
}

// ─── pending ─────────────────────────────────────────────────────────────────

/**
 * A command is in flight: every control in the group locks until it settles,
 * so a second press cannot race the first against the same command revision.
 * The selector computes this over all six item commands
 * (`inbox-case-toolbar-props.test.ts`); one flag reaches all three members.
 */
export const CommandPending: Story = {
  args: {
    item: assignedTo({ ...closedItem, isEscalated: true }, GRACE_ID),
    target: activeTarget,
    isEscalationActive: true,
    isPending: true,
  },
  play: async ({ canvasElement }) => {
    const controls = controlsOf(within(canvasElement))
    await expect(controls.getByRole('button', { name: /work status/i })).toBeDisabled()
    await expect(
      controls.getByRole('button', { name: 'Assignment: Grace Hopper' }),
    ).toBeDisabled()
    await expect(controls.getByRole('button', { name: 'Resolve' })).toBeDisabled()
  },
}
