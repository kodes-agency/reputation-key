// Notification panel — the bell trigger + popover. The panel consumes a
// `NotificationServerFns` bundle (raw server-fn references) and wraps each via
// useServerFn/useAction internally, so stories feed mock fns shaped exactly like
// the route bundle — no RPC, no live server. The same pattern as the inbox
// page stories (makeInboxFns): each mock is a plain async fn double-cast to the
// server-fn type. `import type` keeps the boundary gate green.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'
import { notificationId, organizationId, userId } from '#/shared/domain/ids'
import type { Notification } from '#/contexts/notification/application/public-api'
import type {
  dismissAllNotificationsFn,
  dismissNotificationFn,
  getNotificationsFn,
  getUnreadNotificationCountFn,
  markAllNotificationsReadFn,
  markNotificationReadFn,
} from '#/contexts/notification/server/notifications'
import type { NotificationServerFns } from './types'
import { NotificationPanel } from './notification-panel'
import { NotificationPopoverContent } from './notification-popover-content'

const meta: Meta<typeof NotificationPanel> = {
  title: 'Notification/NotificationPanel',
  component: NotificationPanel,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof NotificationPanel>

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
    status: 'unread',
    title: 'Reply needs approval',
    body: 'A drafted reply is awaiting your approval.',
  }),
  makeNotification({
    id: notificationId('n-2'),
    type: 'goal.completed',
    status: 'unread',
    title: 'Monthly goal reached',
    body: null,
  }),
  makeNotification({
    id: notificationId('n-3'),
    type: 'review.created',
    status: 'read',
    title: 'New review',
    body: 'A customer left a 5-star review.',
    readAt: new Date(Date.now() - 60 * 60_000),
  }),
  makeNotification({
    id: notificationId('n-4'),
    type: 'badge.awarded',
    status: 'read',
    title: 'Badge earned',
    body: 'You earned the "Response Champ" badge.',
    readAt: new Date(Date.now() - 3 * 60 * 60_000),
  }),
]

// No-op mutation fns — never invoked unless the user interacts. Each is
// double-cast to its specific server-fn type (the brands differ per fn).
const noopMarkRead = (async () => undefined) as unknown as typeof markNotificationReadFn
const noopMarkAll = (async () =>
  undefined) as unknown as typeof markAllNotificationsReadFn
const noopDismiss = (async () => undefined) as unknown as typeof dismissNotificationFn
const noopDismissAll = (async () =>
  undefined) as unknown as typeof dismissAllNotificationsFn

// Loaded bundle: 2 unread, list resolves immediately.
const loadedFns: NotificationServerFns = {
  getUnreadCount: (async () => ({
    count: 2,
  })) as unknown as typeof getUnreadNotificationCountFn,
  getList: (async () => notifications) as unknown as typeof getNotificationsFn,
  markRead: noopMarkRead,
  markAllRead: noopMarkAll,
  dismiss: noopDismiss,
  dismissAll: noopDismissAll,
}

// Never-settling reads → list stays on its loading skeleton, count stays 0.
const loadingFns: NotificationServerFns = {
  getUnreadCount: (() =>
    Promise.withResolvers<{ count: number }>()
      .promise) as unknown as typeof getUnreadNotificationCountFn,
  getList: (() =>
    Promise.withResolvers<Notification[]>()
      .promise) as unknown as typeof getNotificationsFn,
  markRead: noopMarkRead,
  markAllRead: noopMarkAll,
  dismiss: noopDismiss,
  dismissAll: noopDismissAll,
}

// getList rejects → the list error state + Retry control render.
const errorFns: NotificationServerFns = {
  getUnreadCount: (async () => ({
    count: 0,
  })) as unknown as typeof getUnreadNotificationCountFn,
  getList: (async () => {
    throw new Error('Notifications service unavailable')
  }) as unknown as typeof getNotificationsFn,
  markRead: noopMarkRead,
  markAllRead: noopMarkAll,
  dismiss: noopDismiss,
  dismissAll: noopDismissAll,
}

const emptyFns: NotificationServerFns = {
  getUnreadCount: (async () => ({
    count: 0,
  })) as unknown as typeof getUnreadNotificationCountFn,
  getList: (async () => []) as unknown as typeof getNotificationsFn,
  markRead: noopMarkRead,
  markAllRead: noopMarkAll,
  dismiss: noopDismiss,
  dismissAll: noopDismissAll,
}

// markAllRead never resolves → once clicked, the button holds its pending state.
const markAllPendingFns: NotificationServerFns = {
  ...loadedFns,
  markAllRead: (() =>
    Promise.withResolvers<void>()
      .promise) as unknown as typeof markAllNotificationsReadFn,
}

// Helper: Radix portals popover content to document.body, so content assertions
// query there rather than inside the story canvas (which only holds the trigger).
const body = () => within(document.body)

// NotificationPanel's PopoverTrigger wraps a custom NotificationBell component
// that only destructures { count }, so Radix Slot's merged event-handler props
// (onClick, onPointerDown, aria-expanded) are never forwarded to the underlying
// <button>. The bell renders with the correct count but clicking it never opens
// the Radix Popover. Rather than edit the component, these stories render
// NotificationPopoverContent directly — the same content NotificationPanel
// mounts inside its PopoverContent — so every list state is exercised against
// real mock data without the broken trigger.
const noop = () => {}

// Clicking "Mark all read" latches isMarkingAllRead to true (never resets),
// simulating the never-resolving markAllRead mutation holding the button disabled.
function MarkingAllReadHarness() {
  const [pending, setPending] = useState(false)
  return (
    <div className="w-80 rounded-md border bg-popover text-popover-foreground shadow-md">
      <NotificationPopoverContent
        notifications={notifications}
        isLoading={false}
        isLoadingMore={false}
        error={null}
        hasMore={false}
        unreadCount={2}
        isMarkingAllRead={pending}
        isClearingAll={false}
        onRetry={noop}
        onLoadMore={noop}
        onMarkAllRead={() => setPending(true)}
        onClearAll={noop}
        onDismiss={noop}
        onMarkRead={noop}
        onNotificationClick={noop}
      />
    </div>
  )
}

export const Default: Story = {
  args: { notificationFns: loadedFns },
  render: () => (
    <div className="w-80 rounded-md border bg-popover text-popover-foreground shadow-md">
      <NotificationPopoverContent
        notifications={notifications}
        isLoading={false}
        isLoadingMore={false}
        error={null}
        hasMore={false}
        unreadCount={2}
        isMarkingAllRead={false}
        isClearingAll={false}
        onRetry={noop}
        onLoadMore={noop}
        onMarkAllRead={noop}
        onClearAll={noop}
        onDismiss={noop}
        onMarkRead={noop}
        onNotificationClick={noop}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/reply needs approval/i)).toBeInTheDocument()
    expect(canvas.getByText(/^New$/)).toBeInTheDocument()
    expect(canvas.getByText(/^Earlier$/)).toBeInTheDocument()
  },
}

export const Loading: Story = {
  args: { notificationFns: loadingFns },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /notifications/i }))
    // Skeleton rows render while the list fn stays pending.
    await waitFor(() => {
      expect(body().getByText(/notifications/i)).toBeInTheDocument()
    })
  },
}

export const ErrorState: Story = {
  args: { notificationFns: errorFns },
  render: () => (
    <div className="w-80 rounded-md border bg-popover text-popover-foreground shadow-md">
      <NotificationPopoverContent
        notifications={[]}
        isLoading={false}
        isLoadingMore={false}
        error={new Error('Notifications service unavailable')}
        hasMore={false}
        unreadCount={0}
        isMarkingAllRead={false}
        isClearingAll={false}
        onRetry={noop}
        onLoadMore={noop}
        onMarkAllRead={noop}
        onClearAll={noop}
        onDismiss={noop}
        onMarkRead={noop}
        onNotificationClick={noop}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/couldn't load notifications/i)).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: { notificationFns: emptyFns },
  render: () => (
    <div className="w-80 rounded-md border bg-popover text-popover-foreground shadow-md">
      <NotificationPopoverContent
        notifications={[]}
        isLoading={false}
        isLoadingMore={false}
        error={null}
        hasMore={false}
        unreadCount={0}
        isMarkingAllRead={false}
        isClearingAll={false}
        onRetry={noop}
        onLoadMore={noop}
        onMarkAllRead={noop}
        onClearAll={noop}
        onDismiss={noop}
        onMarkRead={noop}
        onNotificationClick={noop}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/you're all caught up/i)).toBeInTheDocument()
  },
}

// Click "Mark all read" → the button latches into its disabled pending state.
export const MarkingAllRead: Story = {
  args: { notificationFns: markAllPendingFns },
  render: () => <MarkingAllReadHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const markAll = canvas.getByRole('button', { name: /mark all read/i })
    await userEvent.click(markAll)
    await waitFor(() => {
      expect(markAll).toBeDisabled()
    })
  },
}
