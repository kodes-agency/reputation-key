// Notification list body — the list-state machine: error → loading skeleton →
// empty state → list (+ optional "load more" pagination). Pure presentational;
// each story pins one branch via props.
import type { Meta, StoryObj } from '@storybook/react'
import { notificationId, organizationId, userId } from '#/shared/domain/ids'
import type { Notification } from '#/contexts/notification/application/public-api'
import { NotificationListBody } from './notification-list-body'

const meta: Meta<typeof NotificationListBody> = {
  title: 'Notification/NotificationListBody',
  component: NotificationListBody,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof NotificationListBody>

const noop = () => {}

function makeNotification(
  overrides: Partial<Notification> & { id: string },
): Notification {
  return {
    userId: userId('user-1'),
    organizationId: organizationId('org-1'),
    type: 'review.created',
    priority: 'normal',
    status: 'unread',
    resourceType: 'inbox_item',
    resourceId: 'res-1',
    eventId: 'evt-1',
    title: 'New review',
    body: 'A customer left a 5-star review.',
    readAt: null,
    createdAt: new Date(Date.now() - 5 * 60_000),
    updatedAt: new Date(),
    ...overrides,
  } as Notification
}

const notifications: Notification[] = [
  makeNotification({
    id: notificationId('n-1'),
    type: 'reply.pending_approval',
    priority: 'urgent',
    title: 'Reply needs approval',
    body: 'A drafted reply is awaiting your approval.',
  }),
  makeNotification({
    id: notificationId('n-2'),
    type: 'badge.awarded',
    title: 'Badge unlocked!',
    body: 'You earned the "Response Champ" badge.',
    status: 'read',
    readAt: new Date(),
  }),
  makeNotification({
    id: notificationId('n-3'),
    type: 'goal.completed',
    title: 'Monthly goal reached',
    body: null,
  }),
]

export const ErrorState: Story = {
  args: {
    notifications: [],
    isLoading: false,
    isLoadingMore: false,
    error: new Error('Notifications service unavailable'),
    hasMore: false,
    onRetry: noop,
    onLoadMore: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}

export const Loading: Story = {
  args: {
    notifications: [],
    isLoading: true,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    onRetry: noop,
    onLoadMore: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}

export const Empty: Story = {
  args: {
    notifications: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    onRetry: noop,
    onLoadMore: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}

export const List: Story = {
  args: {
    notifications,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    onRetry: noop,
    onLoadMore: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}

// More pages available — the "Load more" control renders.
export const WithPagination: Story = {
  args: {
    notifications,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: true,
    onRetry: noop,
    onLoadMore: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}

// Mid-pagination — "Load more" shows its spinner + "Loading…" copy.
export const LoadingMore: Story = {
  args: {
    notifications,
    isLoading: false,
    isLoadingMore: true,
    error: null,
    hasMore: true,
    onRetry: noop,
    onLoadMore: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}
