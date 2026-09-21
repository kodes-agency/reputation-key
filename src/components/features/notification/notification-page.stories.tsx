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
    const canvas = within(canvasElement)
    await canvas.findAllByRole('listitem')
    await userEvent.click(canvas.getByRole('button', { name: /dismiss all/i }))
    const dialog = await within(document.body).findByRole('alertdialog')
    await waitFor(() =>
      expect(within(dialog).getByText(/does not change the underlying/i)).toBeVisible(),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss all' }))
    await waitFor(() => {
      expect(canvas.getByText(/you're all caught up/i)).toBeInTheDocument()
    })
  },
}

export const Empty: Story = {
  args: { notificationFns: makeNotificationFns() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/you're all caught up/i)).toBeInTheDocument()
    // Nothing to act on → both bulk actions are inert rather than misleading.
    expect(canvas.getByRole('button', { name: /mark all read/i })).toBeDisabled()
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
    const popover = within(await within(document.body).findByRole('dialog'))
    await userEvent.click(await popover.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(popover.getAllByRole('listitem')).toHaveLength(25))
    await userEvent.keyboard('{Escape}')

    await userEvent.click(canvas.getByRole('button', { name: /mark all read/i }))
    await canvas.findByRole('button', { name: 'Notifications' })
    await userEvent.click(canvas.getByRole('button', { name: 'Notifications' }))

    const reopened = within(await within(document.body).findByRole('dialog'))
    await reopened.findByRole('heading', { name: 'Earlier' })
    expect(reopened.queryByRole('heading', { name: 'New' })).toBeNull()
    expect(reopened.queryByText('Unread.')).toBeNull()
  },
}
