// Notification popover content — header (title + "mark all read") and the list
// body. Pure presentational wrapper; stories vary the header's mark-all-read
// affordance (visible when unread, disabled while marking) and the body state.
import type { Meta, StoryObj } from '@storybook/react'
import { notificationId, organizationId, userId } from '#/shared/domain/ids'
import type { Notification } from '#/contexts/notification/application/public-api'
import { NotificationPopoverContent } from './notification-popover-content'

const meta: Meta<typeof NotificationPopoverContent> = {
  title: 'Notification/NotificationPopoverContent',
  component: NotificationPopoverContent,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-80 rounded-lg border bg-popover text-popover-foreground shadow-md">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof NotificationPopoverContent>

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
    type: 'goal.completed',
    title: 'Monthly goal reached',
    body: null,
  }),
]

// Initial load — skeleton list, no mark-all-read (nothing unread confirmed yet).
export const Loading: Story = {
  args: {
    notifications: [],
    isLoading: true,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    unreadCount: 0,
    isMarkingAllRead: false,
    onRetry: noop,
    onLoadMore: noop,
    onMarkAllRead: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}

export const ErrorState: Story = {
  args: {
    notifications: [],
    isLoading: false,
    isLoadingMore: false,
    error: new Error('Notifications service unavailable'),
    hasMore: false,
    unreadCount: 0,
    isMarkingAllRead: false,
    onRetry: noop,
    onLoadMore: noop,
    onMarkAllRead: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}

// Unread items present → "Mark all read" button visible and enabled.
export const ListWithUnread: Story = {
  args: {
    notifications,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    unreadCount: 2,
    isMarkingAllRead: false,
    onRetry: noop,
    onLoadMore: noop,
    onMarkAllRead: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}

// Mark-all-read in flight → button disabled.
export const MarkingAllRead: Story = {
  args: {
    notifications,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    unreadCount: 2,
    isMarkingAllRead: true,
    onRetry: noop,
    onLoadMore: noop,
    onMarkAllRead: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}

// All read → mark-all-read control hidden.
export const AllRead: Story = {
  args: {
    notifications: [
      makeNotification({
        id: notificationId('n-1'),
        status: 'read',
        readAt: new Date(),
      }),
    ],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    unreadCount: 0,
    isMarkingAllRead: false,
    onRetry: noop,
    onLoadMore: noop,
    onMarkAllRead: noop,
    onDismiss: noop,
    onMarkRead: noop,
    onNotificationClick: noop,
  },
}
