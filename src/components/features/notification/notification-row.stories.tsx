// The densest visual surface in the app, and until now it had zero stories.
//
// Every fixture comes from the one story/test-only factory,
// which returns a COMPLETE `Notification` — the old per-story helpers cast an
// incomplete object to `Notification` and would have rendered `undefined` once
// the row started reading `payload`.
//
// The whole row is one link. Its visible title leaves the Property to the
// facts line under it; its accessible name is one sentence — the full title,
// the facts in words, when, and whether it is unread — and the detail line is
// its description. A sighted reader and a screen-reader user get these
// separately, so the stories assert both.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  longPropertyNameNotification,
  makeNotification,
  notificationFixtures,
  type NotificationFixtureOverrides,
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

/** The row's one link: the whole row opens what the notice is about. */
const rowLink = (canvasElement: HTMLElement) => within(canvasElement).getByRole('link')

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
 * The copy stories are all pinned the same way: the title the row shows, the
 * facts under it, the detail line (the link's description, or none when the
 * title says it all), the one sentence a screen reader hears, and — where the
 * story exists because the old wording was wrong — the phrasing that must not
 * survive anywhere in the row. Only the fixture and those facts differ, so the
 * assertions are written once here. Every fixture is unread, the state this
 * copy is written for and the factory's default, so every name ends "unread".
 */
type RowCopySpec = Readonly<{
  notification: NotificationFixtureOverrides
  /** The visible title, without the Property: the facts line names it. */
  title: string
  facts: ReadonlyArray<string>
  detail: RegExp | string | null
  /** The link's name, which leads with the title as every other channel shows it. */
  name: RegExp
  neverSays?: RegExp
}> &
  Omit<NonNullable<Story['args']>, 'notification'>

const rowSays = ({
  notification,
  title,
  facts,
  detail,
  name,
  neverSays,
  ...args
}: RowCopySpec): Story => ({
  args: { ...args, notification: makeNotification(notification) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = rowLink(canvasElement)
    expect(canvas.getByText(title)).toBeInTheDocument()
    for (const fact of facts) {
      expect(canvas.getByText(fact)).toBeInTheDocument()
    }
    if (detail === null) expect(link).not.toHaveAttribute('aria-describedby')
    else expect(link).toHaveAccessibleDescription(detail)
    expect(link).toHaveAccessibleName(name)
    if (neverSays) {
      expect(canvasElement.textContent).not.toMatch(neverSays)
      expect(link).not.toHaveAccessibleName(neverSays)
    }
  },
})

/**
 * Why the item is open again. The reopen fact's closed reason replaces the
 * generic "needs another look"; the manager's free-text explanation beside it
 * never leaves Inbox.
 */
export const ReopenedSaysWhy: Story = rowSays({
  notification: {
    id: '20000000-0000-4000-8000-000000000031',
    type: 'inbox.reopened',
    payload: {
      propertyName: 'Riverside Hotel',
      platform: 'google',
      reopenReason: 'provider_reply_deleted',
    },
  },
  title: 'Reopened: review',
  facts: ['Riverside Hotel'],
  detail: 'The published reply was removed from Google.',
  name: /^Reopened: review at Riverside Hotel, \d+ minutes? ago, unread$/,
  neverSays: /needs another look/,
})

/**
 * A reminder says by when, on the READER's clock. Two managers responsible for
 * one item need not share a timezone, so the row formats the stored instant
 * with the format it already resolves rather than reading a frozen label.
 */
export const ResponseTargetSaysByWhen: Story = rowSays({
  notification: {
    id: '20000000-0000-4000-8000-000000000032',
    type: 'inbox.response_target_halfway',
    payload: {
      propertyName: 'Riverside Hotel',
      targetDueAt: '2026-09-29T12:00:00.000Z',
    },
  },
  format: { locale: 'en-US', timeZone: 'America/New_York' },
  title: 'Halfway to the response target',
  facts: ['Riverside Hotel'],
  detail: 'Target time Tue, Sep 29, 08:00.',
  name: /^Halfway to the response target at Riverside Hotel, \d+ minutes? ago, unread$/,
  // The product's term is "target time"; "due" is not a word it uses.
  neverSays: /\bdue\b/i,
})

/**
 * A guest portal that guests cannot reach at all, and what to do about it.
 * The notice used to say only that it "may need attention".
 */
export const PortalOffline: Story = rowSays({
  notification: {
    id: '20000000-0000-4000-8000-000000000033',
    type: 'portal.health_attention',
    payload: {
      propertyName: 'Harbour Lodge',
      portalHealthStatus: 'unavailable',
      portalHealthReason: 'public_address_unavailable',
    },
  },
  title: 'Guest portal is offline',
  facts: ['Harbour Lodge'],
  detail:
    'Its web address no longer resolves, so guests cannot reach it. Check the address.',
  name: /^Guest portal is offline at Harbour Lodge, \d+ minutes? ago, unread$/,
  neverSays: /may need attention/,
})

/**
 * Which month, whose goal, and which way it went — the three facts that tell
 * one Portal's monthly result from its nine siblings'. The body only restates
 * the title, so the row has no detail line.
 */
export const GoalResultNamesItsMonth: Story = rowSays({
  notification: {
    id: '20000000-0000-4000-8000-000000000034',
    type: 'goal.result_revised',
    payload: {
      propertyName: 'Harbour Lodge',
      goalName: 'Lobby QR scans',
      goalMonth: '2026-10',
      goalSubjectKind: 'portal',
      goalOutcome: 'not_met',
    },
  },
  title: 'October goal no longer met: Lobby QR scans',
  facts: ['Harbour Lodge'],
  // Which of ten sibling results: the title says only "goal".
  detail: 'This Portal goal no longer meets its target.',
  name: /^October goal no longer met: Lobby QR scans at Harbour Lodge, \d+ minutes? ago, unread$/,
})

/**
 * Urgent + unread: the unread state, the rating in words, the wait, a compact
 * clock, and one link carrying the resource id. There is no Urgent pill any
 * more: an urgent row's icon turns red, which this runner cannot see (it
 * compiles no CSS).
 */
export const UrgentUnread: Story = {
  args: { notification: escalatedWaiting },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = rowLink(canvasElement)
    // Copy comes from renderNotification, never from the stored snapshot.
    expect(canvas.queryByText(/LEGACY SNAPSHOT/i)).not.toBeInTheDocument()
    // The whole point: no identifier on screen, nor in what a screen reader
    // hears. The id lives in the href only.
    for (const id of [escalated.resourceId, escalated.id]) {
      expect(canvasElement.textContent).not.toContain(id)
      expect(link).not.toHaveAccessibleName(expect.stringContaining(id))
    }
    // Each fact once: the title leaves the Property to the facts line.
    expect(canvas.getByText('Escalated: feedback')).toBeInTheDocument()
    expect(canvas.getAllByText(/Riverside Hotel/)).toHaveLength(1)
    // Rating is never glyph-or-colour alone, and the sentences leave it to
    // the stars.
    expect(canvas.getByText('Rated 2 of 5')).toBeInTheDocument()
    expect(canvasElement.textContent).not.toMatch(/2-star/)
    // Raised 26 hours into the wait renders as the compact "1d": the wait the
    // notice was raised with, which never grows while the row sits unread.
    expect(canvas.getByText('waited 1d')).toBeInTheDocument()
    // One sentence for a screen reader: the full title, the facts, when, and
    // that it is unread.
    expect(link).toHaveAccessibleName(
      /^Escalated: feedback at Riverside Hotel, rated 2 of 5, waited 1d, \d+ minutes? ago, unread$/,
    )
    expect(canvasElement.querySelector('li')).toHaveAttribute(
      'data-notification-state',
      'unread',
    )
    // The row's own clock is compact; the absolute time, zone named, is its title.
    const time = canvasElement.querySelector('time')
    expect(time).toHaveTextContent(/^\d+m$/)
    expect(time).toHaveAttribute('title', expect.stringMatching(/ UTC$/))
    // The deep link carries the resource id as a typed search param.
    expect(link).toHaveAttribute('href', expect.stringContaining(escalated.resourceId))
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
  'inbox.bulk_unassigned': 'open',
} as const

const GROUPED_NOTICE_IDS = {
  'inbox.bulk_assigned': '20000000-0000-4000-8000-0000000000c1',
  'inbox.bulk_reopened': '20000000-0000-4000-8000-0000000000c2',
  'inbox.assignments_released': '20000000-0000-4000-8000-0000000000c3',
  'inbox.bulk_unassigned': '20000000-0000-4000-8000-0000000000c4',
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
export const BulkUnassignedOpensItsQueue: Story = opensItsQueue('inbox.bulk_unassigned')

/**
 * ADR 0046 r.2 coalescing: one unread row absorbing repeat events. A stored
 * row reads its count from the coalescing column into `occurrences`, and the
 * row says it once: as "×3" in its facts line, and in words in its name. The
 * email's "This happened 3 times." sentence stays in the email.
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
    expect(canvas.getByText('×3')).toBeInTheDocument()
    expect(canvasElement.textContent?.match(/×3/g)).toHaveLength(1)
    expect(canvasElement.textContent).not.toMatch(/happened|times/)
    expect(rowLink(canvasElement)).toHaveAccessibleName(
      /^Approve a reply at Riverside Hotel, 3 times, \d+ minutes? ago, unread$/,
    )
    expect(canvas.queryByText(/Updated/)).not.toBeInTheDocument()
  },
}

/**
 * A notice about finished work carries no wait. A row written before waits
 * were anchored still holds a frozen age; it must not come back as a fact.
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
    expect(canvas.getByText('Your reply is live on Google')).toBeInTheDocument()
    expect(canvasElement.textContent).not.toMatch(/waited/i)
    expect(rowLink(canvasElement)).not.toHaveAccessibleName(/waited/i)
  },
}

/** The urgent approval of SettledStopsAsking: its work was done upstream. */
const settledApproval = makeNotification({
  id: '20000000-0000-4000-8000-000000000004',
  type: 'reply.pending_approval',
  status: 'unread',
  priority: 'urgent',
  resolvedAt: new Date(Date.now() - 2 * 60 * 1000),
  payload: { propertyName: 'Riverside Hotel', platform: 'google' },
})

/**
 * The work an urgent notice asked for was done upstream. Read is not resolved,
 * so the row is still unread — but it has stopped asking: no unread dot, a
 * check in place of its red icon, "Done" in its facts line, and a name that
 * says done rather than unread.
 */
export const SettledStopsAsking: Story = {
  args: { notification: settledApproval },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvasElement.querySelector('li')).toHaveAttribute(
      'data-notification-state',
      'done',
    )
    expect(canvas.getByText('Done')).toBeInTheDocument()
    expect(rowLink(canvasElement)).toHaveAccessibleName(
      /^Approve a reply at Riverside Hotel, done, \d+ minutes? ago$/,
    )
  },
}

/**
 * A settled row has stopped asking, so its menu offers no read state to
 * change: "Mark as read" would clear a dot the row does not show, and "Mark as
 * unread" would bring none back. Dismiss is what is left, read or not.
 */
export const SettledRowOffersOnlyDismiss: Story = {
  args: { notification: settledApproval },
  render: (args) => (
    <>
      <NotificationRow {...args} />
      <NotificationRow
        {...args}
        notification={makeNotification({
          id: '20000000-0000-4000-8000-000000000005',
          type: 'reply.pending_approval',
          status: 'read',
          resolvedAt: new Date(Date.now() - 2 * 60 * 1000),
          payload: { propertyName: 'Harbour View Suites', platform: 'google' },
        })}
      />
    </>
  ),
  play: async ({ canvasElement }) => {
    const triggers = within(canvasElement).getAllByRole('button', {
      name: /^More actions for:/,
    })
    expect(triggers).toHaveLength(2)
    for (const trigger of triggers) {
      await userEvent.click(trigger)
      const menu = within(canvasElement.ownerDocument.body)
      await findVisibleMenuItem(menu, 'Dismiss')
      expect(menu.queryByRole('menuitem', { name: /^Mark as/ })).toBeNull()
      expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Dismiss',
      ])
      await userEvent.keyboard('{Escape}')
      await expectMenuSettled(canvasElement)
    }
  },
}

export const HighRating: Story = {
  args: { notification: newFeedback },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Rated 5 of 5')).toBeInTheDocument()
    expect(rowLink(canvasElement)).toHaveAccessibleName(/, rated 5 of 5, /)
  },
}

/** Empty payload: the sentence must shorten, never print "undefined". */
export const NoMetadata: Story = {
  args: { notification: noMetadata },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvasElement.textContent).not.toContain('undefined')
    expect(canvas.queryByText(/waited/i)).not.toBeInTheDocument()
    // The row still opens what it is about, and says what that is: an
    // unlabelled row would be a dead end.
    expect(rowLink(canvasElement)).toHaveAccessibleName(
      /^New internal note on a review, \d+ hours? ago$/,
    )
  },
}

export const LongPropertyName: Story = {
  args: { notification: longPropertyNameNotification },
  play: async ({ canvasElement }) => {
    // The invariant that matters: a long Property name wraps inside the facts
    // line rather than widening the row. The title leaves it out.
    const canvas = within(canvasElement)
    const list = canvasElement.querySelector('ul')
    const property = canvas.getByText(/^The Grand Riverside/)
    expect(canvas.getByText('New review')).toBeInTheDocument()
    expect(list).not.toBeNull()
    if (list === null) return
    expect(property.getBoundingClientRect().right).toBeLessThanOrEqual(
      list.getBoundingClientRect().right,
    )
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth)
    expect(rowLink(canvasElement)).toHaveAccessibleName(
      /^New review at The Grand Riverside Boulevard Hotel, Conference Centre and Rooftop Spa Resort, /,
    )
  },
}

/**
 * Dismissing is reachable from the keyboard. The regression this story pins:
 * dismiss used to be `text-muted-foreground/0` revealed only by `group-hover:`,
 * with no `focus-visible:` rule, so a keyboard user tabbed onto an invisible
 * control. It now lives in the row's menu, whose trigger follows the row's
 * link in tab order and shows while anything in the row has focus.
 */
export const DismissIsKeyboardReachable: Story = {
  args: {
    notification: makeNotification({
      id: '20000000-0000-4000-8000-000000000001',
      payload: { propertyName: 'Riverside Hotel' },
    }),
  },
  play: async ({ canvasElement, args }) => {
    rowLink(canvasElement).focus()
    await userEvent.tab()
    const trigger = within(canvasElement).getByRole('button', {
      name: 'More actions for: New review at Riverside Hotel',
    })
    expect(trigger).toHaveFocus()
    expect(trigger).toBeVisible()

    await userEvent.keyboard('{Enter}')
    const menu = within(canvasElement.ownerDocument.body)
    await waitFor(() =>
      expect(menu.getByRole('menuitem', { name: 'Mark as read' })).toHaveFocus(),
    )
    await userEvent.keyboard('{ArrowDown}')
    expect(menu.getByRole('menuitem', { name: 'Dismiss' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(actions.onDismiss).toHaveBeenCalledWith(args.notification.id)

    await expectMenuSettled(canvasElement)
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
 * scoped, so nothing names a Property; the deep link opens the Feedback
 * dialog's "Your reports" through an anchor, and never carries the report
 * reference.
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
    const link = within(canvasElement).getByRole('link', {
      name: /^Your report was resolved, \d+ minutes? ago, unread$/,
    })
    // The title and the time are all the row says: no Property, no facts.
    expect(link.textContent).toMatch(/^Your report was resolved\d+m$/)
    expect(link.getAttribute('href')).toMatch(/#beta-feedback-reports$/u)
    expect(link.getAttribute('href')).not.toContain(reportResolved.resourceId)
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
