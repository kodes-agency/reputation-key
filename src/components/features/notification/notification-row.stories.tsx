// The densest visual surface in the app, and until now it had zero stories.
//
// Every fixture comes from the one story/test-only factory,
// which returns a COMPLETE `Notification` — the old per-story helpers cast an
// incomplete object to `Notification` and would have rendered `undefined` once
// the row started reading `payload`.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  longPropertyNameNotification,
  makeNotification,
  notificationFixtures,
} from './notification.stories.fixtures'
import { NotificationRow } from './notification-row'
import type { NotificationRowActions } from './types'

const actions: NotificationRowActions = {
  onActivate: fn(),
  onMarkRead: fn(),
  onMarkUnread: fn(),
  onDismiss: fn(),
  onMuteCategory: fn(),
}

const meta: Meta<typeof NotificationRow> = {
  title: 'Notification/NotificationRow',
  component: NotificationRow,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { actions },
  decorators: [
    (Story) => (
      // The row IS an <li>; a bare <li> outside a list is an axe violation.
      <ul className="w-[26rem] rounded-xl border bg-popover p-1 text-popover-foreground">
        <Story />
      </ul>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof NotificationRow>

const [escalated, pendingApproval, newFeedback, noMetadata] = notificationFixtures

/** The escalated fixture, raised 26 hours into the current cycle's wait. */
const escalatedWaiting = {
  ...escalated,
  payload: { ...escalated.payload, waitedHours: 26 },
}

const muteableReview = makeNotification({
  id: '20000000-0000-4000-8000-000000000002',
  type: 'review.created',
  status: 'unread',
  payload: { propertyName: 'Harbour View Suites', platform: 'google' },
})

/** Opens the row's overflow menu. Radix portals the menu outside the story canvas. */
async function openRowMenu(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: /^More actions for:/ }),
  )
  return within(canvasElement.ownerDocument.body)
}

/** A menu item once Radix has animated the menu in from opacity 0. */
async function findVisibleMenuItem(menu: ReturnType<typeof within>, name: string) {
  const item = await menu.findByRole('menuitem', { name })
  await waitFor(() => expect(item).toBeVisible())
  return item
}

/**
 * Waits until the menu is closed AND Radix has lifted its modal fence from the
 * canvas. OverflowMenu explains why a story must not end before then.
 */
async function expectMenuSettled(canvasElement: HTMLElement) {
  const ownerDocument = canvasElement.ownerDocument
  await waitFor(() => {
    expect(ownerDocument.querySelector('[role="menu"]')).toBeNull()
    expect(canvasElement).not.toHaveAttribute('aria-hidden')
    expect(canvasElement).not.toHaveAttribute('data-aria-hidden')
    expect(ownerDocument.body.style.pointerEvents).toBe('')
  })
}

/**
 * Why the item is open again. The reopen fact's closed reason replaces the
 * generic "needs another look"; the manager's free-text explanation beside it
 * never leaves Inbox.
 */
export const ReopenedSaysWhy: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-000000000031',
      type: 'inbox.reopened',
      status: 'unread',
      payload: {
        propertyName: 'Riverside Hotel',
        platform: 'google',
        reopenReason: 'provider_reply_deleted',
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByText(/The published reply was removed from Google\./),
    ).toBeInTheDocument()
    expect(canvasElement.textContent).not.toMatch(/needs another look/)
  },
}

/**
 * A reminder says by when, on the READER's clock. Two managers responsible for
 * one item need not share a timezone, so the row formats the stored instant
 * with the format it already resolves rather than reading a frozen label.
 */
export const ResponseTargetSaysByWhen: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-000000000032',
      type: 'inbox.response_target_halfway',
      status: 'unread',
      payload: {
        propertyName: 'Riverside Hotel',
        targetDueAt: '2026-09-29T12:00:00.000Z',
      },
    }),
    format: { locale: 'en-US', timeZone: 'America/New_York' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Target time Tue, Sep 29, 08:00\./)).toBeInTheDocument()
    // The product's term is "target time"; "due" is not a word it uses.
    expect(canvasElement.textContent).not.toMatch(/\bdue\b/i)
  },
}

/**
 * A guest portal that guests cannot reach at all, and what to do about it.
 * The notice used to say only that it "may need attention".
 */
export const PortalOffline: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-000000000033',
      type: 'portal.health_attention',
      status: 'unread',
      payload: {
        propertyName: 'Harbour Lodge',
        portalHealthStatus: 'unavailable',
        portalHealthReason: 'public_address_unavailable',
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByText(/Guest portal is offline at Harbour Lodge/),
    ).toBeInTheDocument()
    expect(canvasElement.textContent).not.toMatch(/may need attention/)
  },
}

/**
 * Which month, whose goal, and which way it went — the three facts that tell
 * one Portal's monthly result from its nine siblings'.
 */
export const GoalResultNamesItsMonth: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-000000000034',
      type: 'goal.result_revised',
      status: 'unread',
      payload: {
        propertyName: 'Harbour Lodge',
        goalName: 'Lobby QR scans',
        goalMonth: '2026-10',
        goalSubjectKind: 'portal',
        goalOutcome: 'not_met',
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByText('October goal no longer met: Lobby QR scans at Harbour Lodge'),
    ).toBeInTheDocument()
    expect(
      canvas.getByText(/This Portal goal no longer meets its target\./),
    ).toBeInTheDocument()
  },
}

/** Urgent + unread: pill, unread dot, rating glyphs, waiting age, accent CTA. */
export const UrgentUnread: Story = {
  args: { notification: escalatedWaiting },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Copy comes from renderNotification, never from the stored snapshot.
    expect(canvas.queryByText(/LEGACY SNAPSHOT/i)).not.toBeInTheDocument()
    // The whole point: no identifier on screen. The id lives in the href only.
    expect(canvasElement.textContent).not.toContain(escalated.resourceId)
    expect(canvasElement.textContent).not.toContain(escalated.id)
    expect(canvas.getByText('Urgent')).toBeInTheDocument()
    // Each fact once: the title names the Property, and the strip beside it
    // does not name it again.
    expect(canvas.getAllByText(/Riverside Hotel/)).toHaveLength(1)
    // Rating is never glyph-or-colour alone, and the sentences leave it to
    // the stars.
    expect(canvas.getByText('Rated 2 out of 5 stars')).toBeInTheDocument()
    expect(canvasElement.textContent).not.toMatch(/2-star/)
    // Raised 26 hours into the wait renders as the compact "1d": the wait the
    // notice was raised with, which never grows while the row sits unread.
    expect(canvas.getAllByText(/Waited 1d/).length).toBeGreaterThan(0)
    // The deep link carries the resource id as a typed search param.
    const cta = canvas.getByRole('link')
    expect(cta).toHaveAttribute('href', expect.stringContaining(escalated.resourceId))
  },
}

/**
 * A grouped notice stands for several items, so its row opens that queue at
 * its Property, as its email does, never the one item that keys the row.
 */
const groupedNotices = {
  'inbox.bulk_assigned': 'mine',
  'inbox.bulk_reopened': 'open',
  'inbox.assignments_released': 'open',
} as const

const GROUPED_NOTICE_IDS = {
  'inbox.bulk_assigned': '20000000-0000-4000-8000-0000000000c1',
  'inbox.bulk_reopened': '20000000-0000-4000-8000-0000000000c2',
  'inbox.assignments_released': '20000000-0000-4000-8000-0000000000c3',
} as const

const groupedNotice = (type: keyof typeof groupedNotices) =>
  makeNotification({
    id: GROUPED_NOTICE_IDS[type],
    type,
    status: 'unread',
    payload: {
      propertyName: 'Riverside Hotel',
      itemCount: 3,
      actorRole: 'account_admin',
    },
  })

const opensItsQueue = (type: keyof typeof groupedNotices): Story => {
  const notification = groupedNotice(type)
  return {
    args: { notification },
    play: async ({ canvasElement }) => {
      const cta = within(canvasElement).getByRole('link')
      const href = new URL(cta.getAttribute('href') ?? '', 'https://repkey.test')
      expect(href.pathname).toBe('/inbox')
      expect(href.searchParams.get('queue')).toBe(groupedNotices[type])
      expect(href.searchParams.get('propertyId')).toBe(notification.propertyId)
      expect(href.searchParams.has('itemId')).toBe(false)
    },
  }
}

export const BulkAssignedOpensItsQueue: Story = opensItsQueue('inbox.bulk_assigned')
export const BulkReopenedOpensItsQueue: Story = opensItsQueue('inbox.bulk_reopened')
export const AssignmentsReleasedOpensItsQueue: Story = opensItsQueue(
  'inbox.assignments_released',
)

/**
 * ADR 0046 r.2 coalescing: one unread row absorbing repeat events. A stored
 * row reads its count from the coalescing column into `occurrences`, and the
 * copy says it once, with the verb for what repeated.
 */
export const Coalesced: Story = {
  args: {
    notification: {
      ...pendingApproval,
      payload: {
        ...pendingApproval.payload,
        occurrences: pendingApproval.coalescedCount,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/This happened 3 times\.$/)).toBeInTheDocument()
    expect(canvasElement.textContent?.match(/3 times/g)).toHaveLength(1)
    expect(canvas.queryByText(/Updated/)).not.toBeInTheDocument()
  },
}

/**
 * A notice about finished work carries no wait. A row written before waits
 * were anchored still holds a frozen age; it must not come back as a chip.
 */
export const OutcomeShowsNoWait: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-000000000003',
      type: 'reply.published',
      payload: { propertyName: 'Riverside Hotel', platform: 'google', waitingHours: 50 },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Your reply is live on Google/)).toBeInTheDocument()
    expect(canvas.queryByText(/Wait/)).not.toBeInTheDocument()
  },
}

/**
 * The work an urgent notice asked for was done upstream. Read is not resolved,
 * so the row is still unread — but it has stopped asking: no unread dot, no
 * Urgent pill, and a "Done" marker in their place.
 */
export const SettledStopsAsking: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-000000000004',
      type: 'reply.pending_approval',
      status: 'unread',
      priority: 'urgent',
      resolvedAt: new Date(Date.now() - 2 * 60 * 1000),
      payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Done')).toBeInTheDocument()
    expect(canvas.queryByText('Urgent')).not.toBeInTheDocument()
    expect(canvas.queryByText('Unread.')).not.toBeInTheDocument()
  },
}

export const HighRating: Story = {
  args: { notification: newFeedback },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Rated 5 out of 5 stars')).toBeInTheDocument()
  },
}

/** Empty payload: the sentence must shorten, never print "undefined". */
export const NoMetadata: Story = {
  args: { notification: noMetadata },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvasElement.textContent).not.toContain('undefined')
    expect(canvas.queryByText(/Wait/)).not.toBeInTheDocument()
    // A CTA is still offered — an unlabelled row would be a dead end.
    expect(canvas.getByRole('link')).toBeInTheDocument()
  },
}

export const LongPropertyName: Story = {
  args: { notification: longPropertyNameNotification },
  play: async ({ canvasElement }) => {
    // The invariant that matters: a long Property name wraps inside the title
    // rather than widening the row.
    const canvas = within(canvasElement)
    const list = canvasElement.querySelector('ul')
    const title = canvas.getByText(/^New review at The Grand Riverside/)
    expect(list).not.toBeNull()
    if (list === null) return
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(
      list.getBoundingClientRect().right,
    )
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth)
  },
}

/**
 * The regression this story pins: dismiss used to be `text-muted-foreground/0`
 * revealed only by `group-hover:`, with no `focus-visible:` rule, so a keyboard
 * user tabbed onto an invisible control.
 */
export const DismissIsKeyboardReachable: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-000000000001',
      payload: { propertyName: 'Riverside Hotel' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dismiss = canvas.getByRole('button', { name: /^Dismiss:/ })
    dismiss.focus()
    expect(dismiss).toHaveFocus()
    expect(dismiss).toBeVisible()
    await userEvent.keyboard('{Enter}')
    expect(actions.onDismiss).toHaveBeenCalled()
  },
}

/**
 * Safe secondary actions only — no inline Approve/Publish — and selecting one
 * reports it.
 *
 * The story deliberately ends with the menu CLOSED AND SETTLED. Radix's
 * DropdownMenu is modal: while open it puts `aria-hidden` on everything outside
 * its portal, which includes `#storybook-root` — the element the a11y addon
 * audits, and which still holds the row's focusable controls. Yielding while
 * that is true makes axe report `aria-hidden-focus` about Radix's overlay
 * strategy rather than about this row. Radix also clears those attributes
 * asynchronously, and the runner's axe pass fires the instant `play` resolves,
 * so the wait below is load-bearing, not cosmetic.
 */
export const OverflowMenu: Story = {
  // A routine Review update belongs to the configurable collaboration
  // category. Private feedback is Action Required and is covered separately
  // by ActionNeededCannotBeMuted below.
  args: { notification: muteableReview },
  play: async ({ canvasElement }) => {
    const menu = await openRowMenu(canvasElement)
    expect(
      await menu.findByRole('menuitem', { name: 'Mark as read' }),
    ).toBeInTheDocument()
    expect(menu.getByRole('menuitem', { name: 'Dismiss' })).toBeInTheDocument()
    expect(menu.getByRole('menuitem', { name: /^Mute/ })).toBeInTheDocument()
    // The deliberate omission: approving or publishing a reply must not be one
    // click away from a notification the reader has not opened.
    expect(menu.queryByRole('menuitem', { name: /approve|publish/i })).toBeNull()

    await userEvent.click(menu.getByRole('menuitem', { name: 'Mark as read' }))
    expect(actions.onMarkRead).toHaveBeenCalledWith(muteableReview.id)

    await expectMenuSettled(canvasElement)
  },
}

/** Action-needed rows stay in-app and therefore never offer a mute action. */
export const ActionNeededCannotBeMuted: Story = {
  args: { notification: escalated },
  play: async ({ canvasElement }) => {
    const menu = await openRowMenu(canvasElement)
    await findVisibleMenuItem(menu, 'Mark as read')
    expect(menu.queryByRole('menuitem', { name: /^Mute/ })).toBeNull()
    await userEvent.click(menu.getByRole('menuitem', { name: 'Mark as read' }))
    await waitFor(() =>
      expect(canvasElement.ownerDocument.querySelector('[role="menu"]')).toBeNull(),
    )
  },
}

/**
 * Goal results are a configurable category, so their rows offer a mute. One
 * Program over every Portal can close hundreds of results in the same hour.
 */
export const GoalResultCanBeMuted: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-0000000000a1',
      type: 'goal.completed',
      status: 'read',
      resourceType: 'goal',
      payload: { propertyName: 'Harbour View Suites', goalName: 'Monthly ratings' },
    }),
  },
  play: async ({ canvasElement, args }) => {
    const menu = await openRowMenu(canvasElement)
    await userEvent.click(await findVisibleMenuItem(menu, 'Mute goals for this property'))
    expect(actions.onMuteCategory).toHaveBeenCalledWith(args.notification)
    await expectMenuSettled(canvasElement)
  },
}

/**
 * ADR 0059: the reporter's own beta report reached an outcome. Organization-
 * scoped, so no Property chip; the deep link opens the Feedback dialog's
 * "Your reports" through an anchor, and never carries the report reference.
 */
const reportResolved = makeNotification({
  id: '20000000-0000-4000-8000-0000000000bf',
  type: 'beta_feedback.outcome',
  priority: 'normal',
  status: 'unread',
  propertyId: null,
  resourceType: 'beta_feedback_report',
  resourceId: '00000000-0000-4000-8000-0000000000f1',
  payload: { reportOutcome: 'resolved' },
})

export const ReportOutcome: Story = {
  args: { notification: reportResolved },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Your report was resolved')).toBeInTheDocument()
    expect(canvas.queryByText('Urgent')).not.toBeInTheDocument()
    const cta = canvas.getByRole('link', { name: /view reports/i })
    expect(cta.getAttribute('href')).toMatch(/#beta-feedback-reports$/u)
    expect(cta.getAttribute('href')).not.toContain(reportResolved.resourceId)
    expect(canvasElement.textContent).not.toContain(reportResolved.resourceId)
  },
}

/**
 * ADR 0059: the report outcome cannot be switched off; dismissing it is the
 * control. Its category is configurable per Property, but it has no Property,
 * so a Mute item would promise a switch the server has no row for.
 */
export const ReportOutcomeCannotBeMuted: Story = {
  args: { notification: reportResolved },
  play: async ({ canvasElement }) => {
    const menu = await openRowMenu(canvasElement)
    await findVisibleMenuItem(menu, 'Dismiss')
    expect(menu.queryByRole('menuitem', { name: /^Mute/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await expectMenuSettled(canvasElement)
  },
}

export const ReportOutcomeLight: Story = {
  args: { notification: reportResolved },
  parameters: { theme: 'light' },
}
