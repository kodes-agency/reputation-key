// The /notifications page: filters, per-property grouping, bulk actions.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  makeNotification,
  makeNotificationFns,
  makeStatefulNotificationFns,
  notificationFeedHeadFixture,
  notificationFixtures,
  notificationPageFixture,
  notificationPropertyFixtures,
} from './notification.stories.fixtures'
import { NotificationPage } from './notification-page'
import { NotificationPanel } from './notification-panel'
import { findOpenBellPopover } from './notification.stories.bell'
import {
  matchesNotificationFilter,
  parseNotificationFilter,
} from './notification-filters'
import type { NotificationServerFns } from './types'

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const unreadCount = notificationFixtures.filter((n) => n.status === 'unread').length

const getFilteredNotifications = (input: unknown) => {
  const filter = (input as Readonly<{ data: Readonly<{ filter: string }> }>).data.filter
  return notificationFixtures.filter((notification) =>
    matchesNotificationFilter(notification, parseNotificationFilter(filter)),
  )
}

const getFilteredFeedHead = async (input: unknown) => {
  const notifications = getFilteredNotifications(input)
  return notificationFeedHeadFixture(
    notifications,
    notifications.filter((notification) => notification.status === 'unread').length,
  )
}

const getFilteredHistory = async (input: unknown) =>
  notificationPageFixture(
    notificationFixtures.filter((notification) =>
      matchesNotificationFilter(
        notification,
        parseNotificationFilter(
          (input as Readonly<{ data: Readonly<{ filter: string }> }>).data.filter,
        ),
      ),
    ),
  )

const loadedFns = makeNotificationFns({
  getFeedHead: getFilteredFeedHead as unknown as NotificationServerFns['getFeedHead'],
  getList: getFilteredHistory as unknown as NotificationServerFns['getList'],
})

const onFilterChange = fn()

const meta: Meta<typeof NotificationPage> = {
  title: 'Notification/NotificationPage',
  component: NotificationPage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    notificationFns: loadedFns,
    organizationId: ORGANIZATION_ID,
    properties: notificationPropertyFixtures,
    filter: 'all',
    onFilterChange,
  },
}
export default meta
type Story = StoryObj<typeof NotificationPage>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByRole('heading', { level: 2, name: 'Riverside Hotel' }),
    ).toBeInTheDocument()
    expect(
      canvas.getByRole('heading', { level: 2, name: 'Harbour View Suites' }),
    ).toBeInTheDocument()
    // Group headings are property NAMES; no identifier reaches the page.
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
    await userEvent.click(await canvas.findByRole('tab', { name: 'Workflow' }))
    // The page does not own the filter — the route does, so it stays in the URL.
    expect(onFilterChange).toHaveBeenCalledWith('workflow_collaboration')
  },
}

export const UrgentFilter: Story = {
  args: { filter: 'urgent' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(async () => {
      expect(await canvas.findAllByRole('listitem')).toHaveLength(2)
    })
  },
}

export const FilterIsAppliedBeforePagination: Story = {
  args: {
    filter: 'urgent',
    notificationFns: makeNotificationFns({
      getFeedHead: (async (input: unknown) => {
        const requestedFilter = (
          input as Readonly<{ data: Readonly<{ filter?: string }> }>
        ).data.filter
        return notificationFeedHeadFixture(
          requestedFilter === 'urgent'
            ? notificationFixtures.filter(
                (notification) => notification.priority === 'urgent',
              )
            : notificationFixtures.filter(
                (notification) => notification.priority !== 'urgent',
              ),
        )
      }) as unknown as NotificationServerFns['getFeedHead'],
    }),
  },
  play: async ({ canvasElement }) => {
    const rows = await within(canvasElement).findAllByRole('listitem')
    expect(rows).toHaveLength(2)
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
 * The confirmed dialog cannot hand focus back to "Dismiss all": that button is
 * disabled once nothing is left. Focus goes to the emptied list instead of
 * falling to <body>.
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
    // Nothing to act on: nothing to mark is not offered, and Dismiss all is inert.
    expect(canvas.queryByRole('button', { name: /mark all read/i })).toBeNull()
    expect(canvas.getByRole('button', { name: /dismiss all/i })).toBeDisabled()
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

/** More rows than the bell's page of 20, so its "Load more" has history to load. */
const longFeed = Array.from({ length: 25 }, (_, n) =>
  makeNotification({
    id: `30000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
    type: 'review.created',
    status: 'unread',
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - (n + 1) * 60_000),
  }),
)

/**
 * The bell and the page are two surfaces over one feed. History the bell
 * loaded through "Load more" is never re-read on its own, so it has to follow
 * what the page does: after "Mark all read" here, reopening the bell must not
 * list those rows under "New" while its badge says there is nothing unread.
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
    const bell = await canvas.findByRole('button', { name: 'Notifications, 25 unread' })
    await userEvent.click(bell)
    const popover = await findOpenBellPopover()
    await userEvent.click(await popover.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(popover.getAllByRole('listitem')).toHaveLength(25))
    await userEvent.keyboard('{Escape}')

    await userEvent.click(canvas.getByRole('button', { name: /mark all read/i }))
    await canvas.findByRole('button', { name: 'Notifications' })
    await userEvent.click(canvas.getByRole('button', { name: 'Notifications' }))

    const reopened = await findOpenBellPopover()
    await reopened.findByRole('heading', { name: 'Earlier' })
    expect(reopened.queryByRole('heading', { name: 'New' })).toBeNull()
    expect(reopened.queryByText('Unread.')).toBeNull()
  },
}

/** Two Workflow rows under the Workflow tab, and an urgent alert outside it. */
const workflowTabFeed = [
  makeNotification({
    id: '61000000-0000-4000-8000-000000000001',
    type: 'inbox.escalated',
    priority: 'urgent',
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 2 * 60_000),
  }),
  makeNotification({
    id: '61000000-0000-4000-8000-000000000002',
    type: 'inbox_note.added',
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 3 * 60_000),
  }),
  makeNotification({
    id: '61000000-0000-4000-8000-000000000003',
    type: 'inbox_note.added',
    payload: { propertyName: 'Harbour View Suites' },
    createdAt: new Date(Date.now() - 4 * 60_000),
  }),
]
const workflowTabServer = makeStatefulNotificationFns(workflowTabFeed)
const markWorkflowRead = fn(workflowTabServer.markAllRead)

/**
 * "Mark all read" on the Workflow tab sends that tab and marks its rows only,
 * then gives focus to the list, since the button leaves with nothing to mark.
 */
export const MarkAllReadFollowsTheTab: Story = {
  args: {
    filter: 'workflow_collaboration',
    notificationFns: {
      ...workflowTabServer,
      markAllRead: markWorkflowRead as unknown as NotificationServerFns['markAllRead'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByRole('listitem')).toHaveLength(2))
    canvas.getByRole('button', { name: /mark all read/i }).focus()
    await userEvent.keyboard('{Enter}')

    expect(markWorkflowRead).toHaveBeenCalledWith({
      data: { filter: 'workflow_collaboration' },
    })
    expect(canvas.getByRole('group', { name: 'Notification list' })).toHaveFocus()
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: /mark all read/i })).toBeNull(),
    )
    await waitFor(() => expect(canvas.queryAllByText('Unread.')).toHaveLength(0))
  },
}

const leftAloneFeed = [0, 1, 2].map((n) =>
  makeNotification({
    id: `62000000-0000-4000-8000-00000000000${n}`,
    type: 'inbox_note.added',
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - (n + 1) * 60_000),
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
    canvas.getAllByRole('button', { name: /^Dismiss:/ })[1]!.focus()
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
