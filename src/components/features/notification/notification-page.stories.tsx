// The /notifications page: filters, per-property grouping, bulk actions.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  makeNotificationFns,
  notificationFixtures,
  notificationPropertyFixtures,
} from './notification-fixtures'
import { NotificationPage } from './notification-page'
import {
  matchesNotificationFilter,
  parseNotificationFilter,
} from './notification-filters'
import type { NotificationServerFns } from './types'

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const unreadCount = notificationFixtures.filter((n) => n.status === 'unread').length

const getFilteredNotifications = async (input: unknown) => {
  const filter = (input as Readonly<{ data: Readonly<{ filter: string }> }>).data.filter
  return notificationFixtures.filter((notification) =>
    matchesNotificationFilter(notification, parseNotificationFilter(filter)),
  )
}

const loadedFns = makeNotificationFns({
  getUnreadCount: (async () => ({
    count: unreadCount,
  })) as unknown as NotificationServerFns['getUnreadCount'],
  getList: getFilteredNotifications as unknown as NotificationServerFns['getList'],
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
      getUnreadCount: (async () => ({
        count: unreadCount,
      })) as unknown as NotificationServerFns['getUnreadCount'],
      getList: (async (input: unknown) => {
        const requestedFilter = (
          input as Readonly<{ data: Readonly<{ filter?: string }> }>
        ).data.filter
        return requestedFilter === 'urgent'
          ? notificationFixtures.filter(
              (notification) => notification.priority === 'urgent',
            )
          : notificationFixtures.filter(
              (notification) => notification.priority !== 'urgent',
            )
      }) as unknown as NotificationServerFns['getList'],
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
      getUnreadCount: (async () => ({
        count: unreadCount,
      })) as unknown as NotificationServerFns['getUnreadCount'],
      getList: (async () =>
        notificationFixtures) as unknown as NotificationServerFns['getList'],
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
    expect(within(dialog).getByText(/does not change the underlying/i)).toBeVisible()
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
      getList: (async () => {
        throw new Error('Notifications service unavailable')
      }) as unknown as NotificationServerFns['getList'],
    }),
  },
  play: async ({ canvasElement }) => {
    expect(
      await within(canvasElement).findByRole('button', { name: /retry/i }),
    ).toBeInTheDocument()
  },
}
