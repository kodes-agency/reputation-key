// Bell popover content: header actions, filter tabs, list body, and the
// "View all notifications" foot link. Pure presentational; stories vary the
// header affordances, the active filter and the body state.
import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { notificationFixtures } from './notification.stories.fixtures'
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
    onRetry: noop,
    onLoadMore: noop,
    onMarkAllRead: noop,
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
    expect(canvas.queryByRole('button', { name: /dismiss all/i })).toBeNull()
  },
}

/**
 * Tabs are derived from GOVERNING_NOTIFICATION_CATEGORIES: a category earns a
 * filter exactly when it governs a live notification type.
 */
export const FilterTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tabs = canvas.getAllByRole('tab').map((tab) => tab.textContent)
    // Derived from the domain, never hand-listed. `Account` appeared when the
    // Organization access/role/purge-pending notices made `mandatory` govern
    // real types: a category the reader cannot switch off is still one they
    // may filter TO. `Goals` is the live goal-result category (`recognition`).
    expect(tabs).toEqual([
      'All',
      'Unread',
      'Urgent',
      'Account',
      'Action',
      'Workflow',
      'Goals',
    ])
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

/**
 * The popover opens at once, and its body's chunk can arrive after it: the
 * popover holds focus meanwhile. When the body mounts, the list takes that
 * focus over, so the first key press lands on the list, not on a button.
 */
function LateBody(props: Parameters<typeof NotificationPopoverContent>[0]) {
  const popover = useRef<HTMLDivElement>(null)
  const [arrived, setArrived] = useState(false)
  useEffect(() => {
    popover.current?.focus()
    // The chunk lands a moment after the popover opened.
    const arrival = setTimeout(() => setArrived(true), 0)
    return () => clearTimeout(arrival)
  }, [])
  return (
    <div ref={popover} role="dialog" aria-label="Notifications" tabIndex={-1}>
      {arrived && <NotificationPopoverContent {...props} />}
    </div>
  )
}

export const TakesOverFocusTheLoadingPopoverHeld: Story = {
  render: (args) => <LateBody {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = await canvas.findByRole('group', { name: 'Notification list' })
    await waitFor(() => expect(list).toHaveFocus())
  },
}
