// The /notifications page: Needs you, Updates and All; Needs you most pressing
// first, the others by day; stacks, and the bulk actions.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  makeNotification,
  makeNotificationFns,
  makeStatefulNotificationFns,
  notificationFeedHeadFixture,
  notificationFixtures,
  notificationUserSettingsFixture,
} from './notification.stories.fixtures'
import { NotificationPage } from './notification-page'
import { NotificationPanel } from './notification-panel'
import { findOpenBellPopover } from './notification.stories.bell'
import { needsReader, parseNotificationFilter } from './notification-filters'
import type { NotificationServerFns } from './types'

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const HARBOUR = '66666666-6666-4666-8666-666666666666'
const RIVERSIDE = '33333333-3333-4333-8333-333333333333'
const MINUTE = 60_000
const unreadCount = notificationFixtures.filter((n) => n.status === 'unread').length
const needsYouCount = notificationFixtures.filter(needsReader).length

const onFilterChange = fn()

const meta: Meta<typeof NotificationPage> = {
  title: 'Notification/NotificationPage',
  component: NotificationPage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    // The fixture feed, answered by filter as the endpoint answers it.
    notificationFns: makeStatefulNotificationFns(notificationFixtures),
    organizationId: ORGANIZATION_ID,
    filter: 'all',
    onFilterChange,
    // One Property: the filter is not offered (it needs two or more).
    properties: [],
    propertyId: null,
    onPropertyChange: fn(),
  },
}
export default meta
type Story = StoryObj<typeof NotificationPage>

/** The ids a group lists, in order. */
const idsIn = (group: HTMLElement) =>
  within(group)
    .getAllByRole('listitem')
    .map((row) => row.dataset.notificationId)

/**
 * The All tab reads by day now, not by Property, so each row names its
 * Property in its facts line; no identifier reaches the page either way.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getAllByRole('listitem')).toHaveLength(notificationFixtures.length),
    )
    expect(canvas.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0)
    expect(canvas.getAllByText('Riverside Hotel')).toHaveLength(2)
    expect(canvas.getAllByText('Harbour View Suites')).toHaveLength(1)
    for (const notification of notificationFixtures) {
      expect(canvasElement.textContent).not.toContain(notification.propertyId)
      expect(canvasElement.textContent).not.toContain(notification.resourceId)
    }
  },
}

export const FilterIsLifted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    onFilterChange.mockClear()
    await userEvent.click(await canvas.findByRole('tab', { name: 'Updates' }))
    // The page does not own the filter — the route does, so it stays in the URL.
    expect(onFilterChange).toHaveBeenCalledWith('updates')
  },
}

/**
 * Tabs activate on Enter, not on arrowing past them: each tab starts a server
 * read, so a keyboard user passing one must not fire a request (and a loading
 * flash) for it.
 */
export const TabsWaitForEnter: Story = {
  args: { filter: 'needs_you' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    onFilterChange.mockClear()
    const needsYou = await canvas.findByRole('tab', { name: 'Needs you' })
    needsYou.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(canvas.getByRole('tab', { name: 'Updates' })).toHaveFocus()
    expect(needsYou).toHaveAttribute('aria-selected', 'true')
    expect(onFilterChange).not.toHaveBeenCalled()

    await userEvent.keyboard('{Enter}')
    expect(onFilterChange).toHaveBeenCalledWith('updates')
  },
}

/** Requests of the reader in the order the server sends them — newest first — and news. */
const pressingFeed = [
  makeNotification({
    id: '62100000-0000-4000-8000-000000000001',
    type: 'feedback.created',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites', platform: 'portal', guestRating: 4 },
    createdAt: new Date(Date.now() - MINUTE),
  }),
  makeNotification({
    id: '62100000-0000-4000-8000-000000000002',
    type: 'reply.published',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - 2 * MINUTE),
  }),
  makeNotification({
    id: '62100000-0000-4000-8000-000000000003',
    type: 'review.created',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - 5 * MINUTE),
  }),
  makeNotification({
    id: '62100000-0000-4000-8000-000000000004',
    type: 'inbox.escalated',
    priority: 'urgent',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites' },
    createdAt: new Date(Date.now() - 30 * MINUTE),
  }),
]

/**
 * The page opens on Needs you: it is what the route passes when the URL names
 * no tab, and for a retired one (an old `?filter=unread` bookmark). The tabs
 * read Needs you, Updates, All. Needs you is one list, most pressing first,
 * holding only what waits on the reader: the news is not in it.
 */
export const NeedsYouByDefault: Story = {
  args: {
    filter: parseNotificationFilter(undefined),
    notificationFns: makeStatefulNotificationFns(pressingFeed),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(parseNotificationFilter('unread')).toBe('needs_you')
    expect(canvas.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Needs you',
      'Updates',
      'All',
    ])
    expect(canvas.getByRole('tab', { name: 'Needs you' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const group = await canvas.findByRole('region', { name: 'Most pressing first' })
    await waitFor(() =>
      expect(idsIn(group)).toEqual([3, 0, 2].map((index) => pressingFeed[index]!.id)),
    )
    for (const row of within(group).getAllByRole('listitem')) {
      expect(row).toHaveAttribute('data-notification-state', 'unread')
    }
  },
}

/** Noon `daysAgo` calendar days back on the reader's clock, whatever the hour now. */
function noonDaysAgo(daysAgo: number): Date {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: notificationUserSettingsFixture.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const [year, month, day] = today.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! - daysAgo, 12))
}

/** An update of a kind that never stacks, at `createdAt`. */
const updateAt = (
  n: number,
  type: 'reply.published' | 'inbox.assigned',
  createdAt: Date,
) =>
  makeNotification({
    id: `62200000-0000-4000-8000-00000000000${n}`,
    type,
    status: 'read',
    propertyId: n % 2 === 0 ? HARBOUR : RIVERSIDE,
    payload: {
      propertyName: n % 2 === 0 ? 'Harbour View Suites' : 'Riverside Hotel',
      platform: 'google',
    },
    createdAt,
  })

const dayFeed = [
  makeNotification({
    id: '62200000-0000-4000-8000-000000000000',
    type: 'inbox.escalated',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites' },
  }),
  updateAt(1, 'reply.published', new Date()),
  updateAt(2, 'inbox.assigned', noonDaysAgo(1)),
  updateAt(3, 'reply.published', noonDaysAgo(3)),
  updateAt(4, 'inbox.assigned', noonDaysAgo(10)),
]

/**
 * Updates read by calendar day on the reader's clock: Today, Yesterday,
 * Earlier this week, Older. The escalation needs the reader, so it is not an
 * update.
 */
export const UpdatesGroupByDay: Story = {
  args: { filter: 'updates', notificationFns: makeStatefulNotificationFns(dayFeed) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('tab', { name: 'Updates' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await waitFor(() =>
      expect(
        canvas
          .getAllByRole('heading', { level: 2 })
          .map((heading) => heading.textContent),
      ).toEqual(['Today', 'Yesterday', 'Earlier this week', 'Older']),
    )
    const idsUnder = (label: string) => idsIn(canvas.getByRole('region', { name: label }))
    expect(idsUnder('Today')).toEqual([dayFeed[1]!.id])
    expect(idsUnder('Yesterday')).toEqual([dayFeed[2]!.id])
    expect(idsUnder('Earlier this week')).toEqual([dayFeed[3]!.id])
    expect(idsUnder('Older')).toEqual([dayFeed[4]!.id])
  },
}

/** When nothing waits on the reader, Needs you says so; the updates are a tab away. */
export const NothingNeedsYou: Story = {
  args: {
    filter: 'needs_you',
    notificationFns: makeStatefulNotificationFns(dayFeed.slice(1)),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('Nothing needs you right now')).toBeInTheDocument()
    expect(canvas.queryAllByRole('listitem')).toHaveLength(0)
    expect(canvas.queryByRole('button', { name: /mark all read/i })).toBeNull()
    expect(canvas.getByRole('tab', { name: 'Updates' })).toBeInTheDocument()
  },
}

/**
 * The server filters, before its limit: asked for anything but Needs you,
 * this head answers only the rows that do not need the reader, so a page that
 * read All and filtered its own rows would list none.
 */
export const FilterIsAppliedBeforePagination: Story = {
  args: {
    filter: 'needs_you',
    notificationFns: makeNotificationFns({
      getFeedHead: (async (input: unknown) => {
        const requestedFilter = (
          input as Readonly<{ data: Readonly<{ filter?: string }> }>
        ).data.filter
        return notificationFeedHeadFixture(
          requestedFilter === 'needs_you'
            ? notificationFixtures.filter(needsReader)
            : notificationFixtures.filter((notification) => !needsReader(notification)),
        )
      }) as unknown as NotificationServerFns['getFeedHead'],
    }),
  },
  play: async ({ canvasElement }) => {
    const rows = await within(canvasElement).findAllByRole('listitem')
    expect(rows).toHaveLength(needsYouCount)
  },
}

/** Presses "Dismiss all" once the rows are in, and returns its confirmation. */
async function openDismissAllConfirmation(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await canvas.findAllByRole('listitem')
  await userEvent.click(canvas.getByRole('button', { name: /dismiss all/i }))
  return within(await within(document.body).findByRole('alertdialog'))
}

/** Full-page dismissal requires confirmation, then updates optimistically. */
export const DismissAllRequiresConfirmation: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () =>
        notificationFeedHeadFixture(
          notificationFixtures,
          unreadCount,
        )) as unknown as NotificationServerFns['getFeedHead'],
      dismissAll: (() =>
        Promise.withResolvers<void>()
          .promise) as unknown as NotificationServerFns['dismissAll'],
    }),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDismissAllConfirmation(canvasElement)
    await waitFor(() =>
      expect(dialog.getByText(/does not change the underlying/i)).toBeVisible(),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Dismiss all' }))
    await waitFor(() => {
      expect(within(canvasElement).getByText(/you're all caught up/i)).toBeInTheDocument()
    })
  },
}

/**
 * Once confirmed, focus goes to the emptied list — what the action changed —
 * rather than back to "Dismiss all", and never falls to <body>.
 */
export const DismissAllFocusesTheList: Story = {
  args: DismissAllRequiresConfirmation.args,
  play: async ({ canvasElement }) => {
    const dialog = await openDismissAllConfirmation(canvasElement)
    await userEvent.click(await dialog.findByRole('button', { name: 'Dismiss all' }))
    const list = await within(canvasElement).findByRole('group', {
      name: 'Notification list',
    })
    await waitFor(() => expect(list).toHaveFocus())
  },
}

export const Empty: Story = {
  args: { notificationFns: makeNotificationFns() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/you're all caught up/i)).toBeInTheDocument()
    // Nothing to mark is not offered. "Dismiss all" stays: it dismisses every
    // notification, not this tab's, so an empty tab (Needs you, most mornings)
    // does not decide it; its confirmation says what it covers.
    expect(canvas.queryByRole('button', { name: /mark all read/i })).toBeNull()
    expect(canvas.getByRole('button', { name: /dismiss all/i })).toBeEnabled()
  },
}

export const ErrorState: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () => {
        throw new Error('Notifications service unavailable')
      }) as unknown as NotificationServerFns['getFeedHead'],
    }),
  },
  play: async ({ canvasElement }) => {
    expect(
      await within(canvasElement).findByRole('button', { name: /retry/i }),
    ).toBeInTheDocument()
  },
}

/**
 * More new reviews than the bell's page of 20, so its "Load more" has history
 * to load. A Property each, so none stack: every row is one to load.
 */
const longFeed = Array.from({ length: 25 }, (_, n) =>
  makeNotification({
    id: `30000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
    type: 'review.created',
    status: 'unread',
    propertyId: `31000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
    payload: { propertyName: `Property ${n + 1}`, platform: 'google' },
    createdAt: new Date(Date.now() - (n + 1) * MINUTE),
  }),
)

/**
 * The bell and the page are two surfaces over one feed. History the bell
 * loaded through "Load more" is never re-read on its own, so it has to follow
 * what the page does: after "Mark all read" here, reopening the bell must not
 * list those rows under Needs you while its badge says nothing needs you.
 */
export const BellHistoryFollowsThePage: Story = {
  args: { notificationFns: makeStatefulNotificationFns(longFeed) },
  render: (args) => (
    <>
      <NotificationPanel
        notificationFns={args.notificationFns}
        organizationId={args.organizationId}
      />
      <NotificationPage {...args} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bell = await canvas.findByRole('button', { name: 'Notifications, 25 need you' })
    await userEvent.click(bell)
    const popover = await findOpenBellPopover()
    await userEvent.click(await popover.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(popover.getAllByRole('listitem')).toHaveLength(25))
    await userEvent.keyboard('{Escape}')

    await userEvent.click(canvas.getByRole('button', { name: /mark all read/i }))
    await canvas.findByRole('button', { name: 'Notifications' })
    await userEvent.click(canvas.getByRole('button', { name: 'Notifications' }))

    const reopened = await findOpenBellPopover()
    await reopened.findByRole('heading', { name: 'Updates' })
    expect(reopened.queryByRole('heading', { name: 'Needs you' })).toBeNull()
    expect(reopened.getByText('Nothing needs you right now')).toBeInTheDocument()
    // No row still tells a screen reader it is unread.
    expect(reopened.queryAllByRole('link', { name: /, unread$/ })).toHaveLength(0)
  },
}

/** Two requests of the reader under Needs you, and an unread update outside it. */
const needsYouTabFeed = [
  makeNotification({
    id: '61000000-0000-4000-8000-000000000001',
    type: 'inbox.escalated',
    priority: 'urgent',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 2 * MINUTE),
  }),
  makeNotification({
    id: '61000000-0000-4000-8000-000000000002',
    type: 'feedback.created',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites', platform: 'portal' },
    createdAt: new Date(Date.now() - 3 * MINUTE),
  }),
  makeNotification({
    id: '61000000-0000-4000-8000-000000000003',
    type: 'reply.published',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - 4 * MINUTE),
  }),
]
const needsYouTabServer = makeStatefulNotificationFns(needsYouTabFeed)
const markTabRead = fn(needsYouTabServer.markAllRead)

/**
 * "Mark all read" on the Needs you tab sends that tab and marks its rows only,
 * then gives focus to the list, since the button leaves with nothing to mark.
 * The unread update was not on the tab: on Updates it is still unread.
 */
export const MarkAllReadFollowsTheTab: Story = {
  args: {
    filter: 'needs_you',
    notificationFns: {
      ...needsYouTabServer,
      markAllRead: markTabRead as unknown as NotificationServerFns['markAllRead'],
    },
  },
  render: function OnItsTabs(args) {
    const [filter, setFilter] = useState(args.filter)
    return <NotificationPage {...args} filter={filter} onFilterChange={setFilter} />
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByRole('listitem')).toHaveLength(2))
    canvas.getByRole('button', { name: /mark all read/i }).focus()
    await userEvent.keyboard('{Enter}')

    expect(markTabRead).toHaveBeenCalledWith({ data: { filter: 'needs_you' } })
    expect(canvas.getByRole('group', { name: 'Notification list' })).toHaveFocus()
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: /mark all read/i })).toBeNull(),
    )
    // Read now, they no longer wait on the reader.
    expect(await canvas.findByText('Nothing needs you right now')).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('tab', { name: 'Updates' }))
    await waitFor(() =>
      expect(
        canvas
          .getAllByRole('listitem')
          .map((row) => [row.dataset.notificationId, row.dataset.notificationState]),
      ).toEqual([
        [needsYouTabFeed[0]!.id, 'read'],
        [needsYouTabFeed[1]!.id, 'read'],
        [needsYouTabFeed[2]!.id, 'unread'],
      ]),
    )
  },
}

/** Three notes at three Properties, so none stack. */
const leftAloneFeed = [0, 1, 2].map((n) =>
  makeNotification({
    id: `62000000-0000-4000-8000-00000000000${n}`,
    type: 'inbox_note.added',
    propertyId: `62000000-0000-4000-8000-10000000000${n}`,
    payload: { propertyName: `Property ${n + 1}` },
    createdAt: new Date(Date.now() - (n + 1) * MINUTE),
  }),
)
const leftAloneServer = makeStatefulNotificationFns(leftAloneFeed)

/**
 * Focus the user moved away stays away. Having once focused a row's control,
 * the reader clicks elsewhere on the page; later that row goes on its own (a
 * poll sees it dismissed in another tab). Focus must not be pulled back into
 * the list, and the page must not jump to it.
 */
export const FocusLeftElsewhereStaysThere: Story = {
  args: { notificationFns: leftAloneServer },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByRole('listitem')).toHaveLength(3))
    canvas.getAllByRole('button', { name: /^More actions for:/ })[1]!.focus()
    await userEvent.click(
      canvas.getByRole('heading', { level: 1, name: 'Notifications' }),
    )
    expect(document.activeElement).toBe(document.body)

    // Dismissed in another tab; this tab reads the feed again when it regains focus.
    await leftAloneServer.dismiss({ data: { notificationId: leftAloneFeed[1]!.id } })
    window.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(canvas.getAllByRole('listitem')).toHaveLength(2))

    expect(document.activeElement).toBe(document.body)
  },
}

// ── The Property filter (direction B) ───────────────────────────────────────

const PROPERTIES = [
  { id: HARBOUR, name: 'Harbour View Suites' },
  { id: RIVERSIDE, name: 'Riverside Hotel' },
]

/** Two Properties' notes, and an Organization notice that belongs to neither. */
const twoPropertyFeed = [
  makeNotification({
    id: '68000000-0000-4000-8000-000000000001',
    type: 'inbox.escalated',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites' },
    createdAt: new Date(Date.now() - 2 * MINUTE),
  }),
  makeNotification({
    id: '68000000-0000-4000-8000-000000000002',
    type: 'inbox.escalated',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 4 * MINUTE),
  }),
  makeNotification({
    id: '68000000-0000-4000-8000-000000000003',
    type: 'account.organization_role_changed',
    propertyId: null,
    createdAt: new Date(Date.now() - 6 * MINUTE),
  }),
]
const twoPropertyServer = makeStatefulNotificationFns(twoPropertyFeed)
const markPropertyRead = fn(twoPropertyServer.markAllRead)
const dismissPropertyRows = fn(twoPropertyServer.dismissAll)
const onPropertyChange = fn()

/**
 * A reader with several Properties reads one at a time: its rows only, no
 * Organization notices, and "All properties" puts the whole feed back.
 */
export const FiltersToOneProperty: Story = {
  args: {
    filter: 'all',
    properties: PROPERTIES,
    propertyId: RIVERSIDE,
    onPropertyChange,
    notificationFns: makeStatefulNotificationFns(twoPropertyFeed),
  },
  play: async ({ canvasElement }) => {
    onPropertyChange.mockClear()
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByRole('listitem')).toHaveLength(1))
    expect(
      canvas.getByRole('link', { name: /^Escalated: .* at Riverside Hotel,/ }),
    ).toBeVisible()

    await userEvent.click(
      canvas.getByRole('combobox', { name: 'Property: Riverside Hotel' }),
    )
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'All properties' }),
    )
    expect(onPropertyChange).toHaveBeenCalledWith(null)
  },
}

/** One Property, or none: the filter is not offered to a reader with one. */
export const NoFilterForOneProperty: Story = {
  args: {
    properties: [PROPERTIES[0]!],
    notificationFns: makeStatefulNotificationFns(twoPropertyFeed),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByRole('listitem')).toHaveLength(3))
    expect(canvas.queryByRole('combobox', { name: /^Property:/ })).toBeNull()
  },
}

/**
 * Under the filter, "Mark all read" and "Dismiss all" reach that Property's
 * rows only, and the dismiss dialog names it.
 */
export const BulkActionsStayInTheProperty: Story = {
  args: {
    filter: 'all',
    properties: PROPERTIES,
    propertyId: HARBOUR,
    notificationFns: {
      ...twoPropertyServer,
      markAllRead: markPropertyRead as unknown as NotificationServerFns['markAllRead'],
      dismissAll: dismissPropertyRows as unknown as NotificationServerFns['dismissAll'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByRole('listitem')).toHaveLength(1))

    await userEvent.click(canvas.getByRole('button', { name: /mark all read/i }))
    expect(markPropertyRead).toHaveBeenCalledWith({
      data: { filter: 'all', propertyId: HARBOUR },
    })

    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss all' }))
    const dialog = within(await within(document.body).findByRole('alertdialog'))
    expect(
      dialog.getByRole('heading', {
        name: 'Dismiss all notifications about Harbour View Suites?',
      }),
    ).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Dismiss all' }))
    expect(dismissPropertyRows).toHaveBeenCalledWith({ data: { propertyId: HARBOUR } })
  },
}
