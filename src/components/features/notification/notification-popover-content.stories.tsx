// Bell popover content: header actions, what needs the reader, Updates, and
// the "View all notifications" foot link. It is handed the Needs-you rows (the
// panel's polling head, which the badge counts) and reads Updates itself, so
// stories vary the header affordances, each list's state, and the server the
// Updates list reads from.
import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { NotificationView } from '#/contexts/feed/application/public-api'
import {
  makeNotification,
  makeNotificationFns,
  makeStatefulNotificationFns,
  notificationFixtures,
} from './notification.stories.fixtures'
import { needsReader } from './notification-filters'
import { NotificationPopoverContent } from './notification-popover-content'
import type { NotificationRowActions } from './types'

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'

const actions: NotificationRowActions = {
  onActivate: fn(),
  onMarkRead: fn(),
  onMarkUnread: fn(),
  onDismiss: fn(),
  onMuteCategory: fn(),
  onMarkManyRead: fn(),
  onDismissMany: fn(),
}

const noop = () => {}
const onMarkAllRead = fn()

/** The Needs-you list as the panel hands it over: loaded, nothing more to load. */
const needsYouList = (notifications: ReadonlyArray<NotificationView>) => ({
  notifications,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: false,
  onRetry: noop,
  onLoadMore: noop,
})

const needsYouRows = notificationFixtures.filter(needsReader)

const meta: Meta<typeof NotificationPopoverContent> = {
  title: 'Notification/NotificationPopoverContent',
  component: NotificationPopoverContent,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    needsYou: needsYouList(needsYouRows),
    unreadCount: needsYouRows.length,
    isMarkingAllRead: false,
    onMarkAllRead,
    actions,
    // Where the body reads Updates from: the fixture feed, by filter.
    notificationFns: makeStatefulNotificationFns(notificationFixtures),
    organizationId: ORGANIZATION_ID,
  },
  decorators: [
    (Story) => (
      <div className="w-96 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover text-popover-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof NotificationPopoverContent>

/** "Mark all read" is offered only while something is unread to mark. */
const expectNoMarkAllRead = (canvasElement: HTMLElement) =>
  expect(
    within(canvasElement).queryByRole('button', { name: /mark all read/i }),
  ).toBeNull()

/** The Needs-you list: where focus goes when the body hands it on. */
const needsYouListOf = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('group', { name: 'Needs you' })

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(canvas.getByRole('heading', { name: 'Needs you' })).toBeInTheDocument()
    // Updates are read by the body itself: the read note arrives there.
    const updates = await canvas.findByRole('region', { name: 'Updates' })
    expect(within(updates).getAllByRole('listitem')).toHaveLength(1)
    // The popover is not the whole surface — it links to the full page.
    expect(canvas.getByRole('link', { name: 'View all notifications' })).toHaveAttribute(
      'href',
      '/notifications',
    )
    expect(canvas.queryByRole('button', { name: /dismiss all/i })).toBeNull()
  },
}

export const Loading: Story = {
  args: { needsYou: { ...needsYouList([]), isLoading: true } },
}

export const ErrorState: Story = {
  args: {
    needsYou: {
      ...needsYouList([]),
      error: new Error('Notifications service unavailable'),
    },
  },
  play: async ({ canvasElement }) => {
    expect(
      within(needsYouListOf(canvasElement)!).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
  },
}

/** Nothing at all: each list is one quiet line, and nothing is offered to mark. */
export const Empty: Story = {
  args: {
    needsYou: needsYouList([]),
    unreadCount: 0,
    notificationFns: makeNotificationFns(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(await canvas.findByText('No updates yet')).toBeInTheDocument()
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
 * The bell lists rows, but none of them still waits on the reader — one is
 * read, one was settled upstream: "Mark all read" would change nothing a
 * reader can see, so it is not offered.
 */
export const NothingUnreadNothingToMark: Story = {
  args: {
    needsYou: needsYouList([]),
    unreadCount: 0,
    notificationFns: makeStatefulNotificationFns([
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
    const canvas = within(canvasElement)
    const updates = await canvas.findByRole('region', { name: 'Updates' })
    expect(within(updates).getAllByRole('listitem')).toHaveLength(2)
    expect(canvas.getByText('Nothing needs you right now')).toBeInTheDocument()
    expectNoMarkAllRead(canvasElement)
  },
}

/**
 * "Mark all read" leaves once its rows are read, so it hands focus to the
 * Needs-you list rather than to <body> outside the non-modal popover.
 */
export const MarkAllReadHandsFocusToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    onMarkAllRead.mockClear()
    canvas.getByRole('button', { name: /mark all read/i }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onMarkAllRead).toHaveBeenCalledTimes(1)
    expect(needsYouListOf(canvasElement)).toHaveFocus()
  },
}

/**
 * The popover opens at once, and its body's chunk can arrive after it: the
 * popover holds focus meanwhile. When the body mounts, the Needs-you list
 * takes that focus over, so the first key press lands on a list, not on a
 * button.
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
    await canvas.findByRole('group', { name: 'Needs you' })
    await waitFor(() => expect(needsYouListOf(canvasElement)).toHaveFocus())
  },
}
