// The list-state machine: error → loading skeleton → empty → grouped list
// (+ optional "load more"). Pure presentational; each story pins one branch.
//
// Fixtures come from the shared factory, so every row carries a real `payload`,
// `category`, `propertyId` and coalescing fields — the previous fixtures cast an
// incomplete object to `Notification` and omitted all four.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, within } from 'storybook/test'
import {
  notificationFixtures,
  notificationPropertyFixtures,
} from './notification-fixtures'
import { groupByProperty, groupByReadState } from './notification-filters'
import { NotificationListBody } from './notification-list-body'
import type { NotificationRowActions } from './types'

const actions: NotificationRowActions = {
  onActivate: fn(),
  onMarkRead: fn(),
  onMarkUnread: fn(),
  onDismiss: fn(),
  onMuteCategory: fn(),
}

const noop = () => {}

const meta: Meta<typeof NotificationListBody> = {
  title: 'Notification/NotificationListBody',
  component: NotificationListBody,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    groups: groupByReadState(notificationFixtures),
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    onRetry: noop,
    onLoadMore: noop,
    actions,
  },
  decorators: [
    (Story) => (
      <div className="w-96 rounded-xl border bg-popover p-1 text-popover-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof NotificationListBody>

export const ErrorState: Story = {
  args: { error: new Error('Notifications service unavailable') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/couldn't load notifications/i)).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  },
}

export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Assistive tech is told the region is busy, not left with silent skeletons.
    expect(canvas.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(canvas.getByText('Loading notifications…')).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: { groups: [] },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText(/you're all caught up/i)).toBeInTheDocument()
  },
}

/** Unread + read mix, grouped under real headings and real list semantics. */
export const UnreadAndReadMix: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'New' })).toBeInTheDocument()
    expect(canvas.getByRole('heading', { name: 'Earlier' })).toBeInTheDocument()
    // Rows are <li> in a <ul>: two groups, one row per fixture.
    expect(canvas.getAllByRole('list')).toHaveLength(2)
    expect(canvas.getAllByRole('listitem')).toHaveLength(notificationFixtures.length)
  },
}

/** The /notifications page grouping — headings are names, never UUIDs. */
export const GroupedByProperty: Story = {
  args: {
    groups: groupByProperty(
      notificationFixtures,
      Object.fromEntries(
        notificationPropertyFixtures.map((property) => [property.id, property.name]),
      ),
    ),
    headingLevel: 2,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('heading', { level: 2, name: 'Riverside Hotel' }),
    ).toBeInTheDocument()
    expect(
      canvas.getByRole('heading', { level: 2, name: 'Harbour View Suites' }),
    ).toBeInTheDocument()
    for (const notification of notificationFixtures) {
      expect(canvasElement.textContent).not.toContain(notification.propertyId)
    }
  },
}

export const WithPagination: Story = {
  args: { hasMore: true },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: 'Load more' }),
    ).toBeInTheDocument()
  },
}

export const LoadingMore: Story = {
  args: { hasMore: true, isLoadingMore: true },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button', { name: /loading/i })).toBeDisabled()
  },
}
