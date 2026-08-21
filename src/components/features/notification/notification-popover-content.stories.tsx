// Bell popover content: header actions, filter tabs, list body, and the
// "View all notifications" foot link. Pure presentational; stories vary the
// header affordances, the active filter and the body state.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { notificationFixtures } from './notification-fixtures'
import { groupByReadState, matchesNotificationFilter } from './notification-filters'
import { NotificationPopoverContent } from './notification-popover-content'
import type { NotificationRowActions } from './types'

const actions: NotificationRowActions = {
  onActivate: fn(),
  onMarkRead: fn(),
  onMarkUnread: fn(),
  onDismiss: fn(),
  onMuteCategory: fn(),
}

const noop = () => {}
const onFilterChange = fn()

const meta: Meta<typeof NotificationPopoverContent> = {
  title: 'Notification/NotificationPopoverContent',
  component: NotificationPopoverContent,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    groups: groupByReadState(notificationFixtures),
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    unreadCount: 3,
    filter: 'all',
    onFilterChange,
    isMarkingAllRead: false,
    isClearingAll: false,
    onRetry: noop,
    onLoadMore: noop,
    onMarkAllRead: noop,
    onClearAll: noop,
    actions,
  },
  decorators: [
    (Story) => (
      <div className="w-96 rounded-xl border bg-popover text-popover-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof NotificationPopoverContent>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(canvas.getByRole('heading', { name: 'New' })).toBeInTheDocument()
    expect(canvas.getByRole('heading', { name: 'Earlier' })).toBeInTheDocument()
    // The popover is no longer the whole surface — it links to the full page.
    expect(canvas.getByRole('link', { name: 'View all notifications' })).toHaveAttribute(
      'href',
      '/notifications',
    )
  },
}

/**
 * Tabs are derived from GOVERNING_NOTIFICATION_CATEGORIES, so `mandatory` — which
 * governs zero notification types — must never appear as a filter.
 */
export const FilterTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tabs = canvas.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual([
      'All',
      'Unread',
      'Urgent',
      'Operations',
      'Workflow',
      'Recognition',
    ])
    expect(tabs).not.toContain('Account')
    onFilterChange.mockClear()
    await userEvent.click(canvas.getByRole('tab', { name: 'Urgent' }))
    expect(onFilterChange).toHaveBeenCalledWith('urgent')
  },
}

/** Urgent filter applied: only the two urgent rows survive. */
export const UrgentFilterApplied: Story = {
  args: {
    filter: 'urgent',
    groups: groupByReadState(
      notificationFixtures.filter((n) => matchesNotificationFilter(n, 'urgent')),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('listitem')).toHaveLength(2)
    expect(canvas.getAllByText('Urgent').length).toBeGreaterThan(0)
  },
}

export const Loading: Story = {
  args: { isLoading: true, groups: [] },
}

export const ErrorState: Story = {
  args: { groups: [], error: new Error('Notifications service unavailable') },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: /retry/i }),
    ).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: { groups: [], unreadCount: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/nothing here right now/i)).toBeInTheDocument()
    // Bulk actions are hidden when there is nothing to act on.
    expect(canvas.queryByRole('button', { name: /mark all read/i })).toBeNull()
  },
}

/** Mark-all-read holds its disabled pending state while the mutation is in flight. */
export const MarkingAllRead: Story = {
  args: { isMarkingAllRead: true },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: /mark all read/i }),
    ).toBeDisabled()
  },
}
