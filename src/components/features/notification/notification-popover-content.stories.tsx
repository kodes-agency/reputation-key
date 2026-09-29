// Bell popover content: header actions, filter tabs, list body, and the
// "View all notifications" foot link. Pure presentational; stories vary the
// header affordances, the active filter and the body state.
import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { makeNotification, notificationFixtures } from './notification.stories.fixtures'
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
const onMarkAllRead = fn()

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
    filterUnreadCount: 3,
    filter: 'all',
    onFilterChange,
    isMarkingAllRead: false,
    onRetry: noop,
    onLoadMore: noop,
    onMarkAllRead,
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

/** "Mark all read" is offered only while the tab holds an unread row to mark. */
const expectNoMarkAllRead = (canvasElement: HTMLElement) =>
  expect(
    within(canvasElement).queryByRole('button', { name: /mark all read/i }),
  ).toBeNull()

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
 * Two tabs, the questions a reader asks: everything, or what still waits on
 * me. The Urgent tab and one tab per category wrapped onto a second line on a
 * phone and were mostly empty, so they went.
 */
export const FilterTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tabs = canvas.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['All', 'Unread'])
    onFilterChange.mockClear()
    await userEvent.click(canvas.getByRole('tab', { name: 'Unread' }))
    expect(onFilterChange).toHaveBeenCalledWith('unread')
  },
}

/** Unread filter applied: only the rows still waiting survive, all of them New. */
export const UnreadFilterApplied: Story = {
  args: {
    filter: 'unread',
    groups: groupByReadState(
      notificationFixtures.filter((n) => matchesNotificationFilter(n, 'unread')),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('tab', { name: 'Unread' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const rows = canvas.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row).toHaveAttribute('data-notification-state', 'unread')
    }
    expect(canvas.getByRole('heading', { name: 'New' })).toBeInTheDocument()
    expect(canvas.queryByRole('heading', { name: 'Earlier' })).toBeNull()
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
  args: { groups: [], filterUnreadCount: 0 },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText(/nothing here right now/i)).toBeInTheDocument()
    // Bulk actions are hidden when there is nothing to act on.
    expectNoMarkAllRead(canvasElement)
  },
}

/** Nothing is left to mark while the mutation is in flight, so the action is gone. */
export const MarkingAllRead: Story = {
  args: { isMarkingAllRead: true },
  play: async ({ canvasElement }) => {
    expectNoMarkAllRead(canvasElement)
  },
}

/**
 * The tab lists rows, but none of them still waits on the reader — one is
 * read, one was settled upstream: "Mark all read" would change nothing a
 * reader can see, so it is not offered.
 */
export const NothingUnreadOnThisTab: Story = {
  args: {
    filter: 'all',
    filterUnreadCount: 0,
    groups: groupByReadState([
      makeNotification({
        id: '10000000-0000-4000-8000-000000000080',
        type: 'inbox_note.added',
        status: 'read',
      }),
      makeNotification({
        id: '10000000-0000-4000-8000-000000000081',
        type: 'reply.pending_approval',
        status: 'unread',
        resolvedAt: new Date(Date.now() - 60_000),
      }),
    ]),
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getAllByRole('listitem')).toHaveLength(2)
    expectNoMarkAllRead(canvasElement)
  },
}

/**
 * "Mark all read" leaves once its rows are read, so it hands focus to the
 * list it changed rather than to <body> outside the non-modal popover.
 */
export const MarkAllReadHandsFocusToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    onMarkAllRead.mockClear()
    canvas.getByRole('button', { name: /mark all read/i }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onMarkAllRead).toHaveBeenCalledTimes(1)
    expect(canvas.getByRole('group', { name: 'Notification list' })).toHaveFocus()
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
