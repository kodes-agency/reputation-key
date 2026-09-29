// The list-state machine: error → loading skeleton → empty → grouped list
// (+ optional "load more"). Pure presentational; each story pins one branch.
//
// Fixtures come from the shared factory, so every row carries a real `payload`,
// `category`, `propertyId` and coalescing fields — the previous fixtures cast an
// incomplete object to `Notification` and omitted all four.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { makeNotification, notificationFixtures } from './notification.stories.fixtures'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { groupByDay, needsReader, type NotificationGroup } from './notification-filters'
import { NotificationListBody } from './notification-list-body'
import type { NotificationRowActions } from './types'

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
const HARBOUR = '66666666-6666-4666-8666-666666666666'

/** The bell's two sections, as its body builds them from the fixture feed. */
const bellSections: ReadonlyArray<NotificationGroup> = [
  {
    key: 'needs-you',
    label: 'Needs you',
    notifications: notificationFixtures.filter(needsReader),
  },
  {
    key: 'updates',
    label: 'Updates',
    notifications: notificationFixtures.filter((row) => !needsReader(row)),
  },
]

const meta: Meta<typeof NotificationListBody> = {
  title: 'Notification/NotificationListBody',
  component: NotificationListBody,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    groups: bellSections,
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
  args: { groups: [], error: new Error('Notifications service unavailable') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/couldn't load notifications/i)).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  },
}

/** A failure notice beside the list: every loaded row stays, with a way to retry. */
const expectRowsKeptWithNotice = (
  canvasElement: HTMLElement,
  notice: RegExp,
  retry: RegExp | string,
) => {
  const canvas = within(canvasElement)
  expect(canvas.getAllByRole('listitem')).toHaveLength(notificationFixtures.length)
  expect(canvas.getByText(notice)).toBeInTheDocument()
  expect(canvas.getByRole('button', { name: retry })).toBeInTheDocument()
}

/**
 * One failed refresh (a deploy, a dropped connection) keeps the rows the user
 * was reading; it used to swap the whole list for the error state.
 */
export const RefreshFailureKeepsTheRows: Story = {
  args: { error: new Error('Notifications service unavailable') },
  play: async ({ canvasElement }) => {
    expectRowsKeptWithNotice(canvasElement, /couldn't refresh notifications/i, /retry/i)
  },
}

const sessionEnded = new ServerFunctionError(
  'AuthError',
  'Unauthorized',
  'unauthorized',
  401,
)

/** A 401 cannot be retried into success: the way out is signing in again. */
export const SessionEnded: Story = {
  args: { groups: [], error: sessionEnded },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/your session has ended/i)).toBeInTheDocument()
    expect(canvas.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/login\?redirect=/),
    )
    expect(canvas.queryByRole('button', { name: /retry/i })).toBeNull()
  },
}

/** A failed "Load more" says so beside the button and keeps every loaded row. */
export const LoadMoreFailure: Story = {
  args: { hasMore: true, loadMoreError: new Error('Notifications service unavailable') },
  play: async ({ canvasElement }) => {
    expectRowsKeptWithNotice(
      canvasElement,
      /couldn't load older notifications/i,
      'Try again',
    )
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
    expect(canvas.getByRole('heading', { name: 'Needs you' })).toBeInTheDocument()
    expect(canvas.getByRole('heading', { name: 'Updates' })).toBeInTheDocument()
    // Rows are <li> in a <ul>: two groups, one row per fixture.
    expect(canvas.getAllByRole('list')).toHaveLength(2)
    expect(canvas.getAllByRole('listitem')).toHaveLength(notificationFixtures.length)
  },
}

/** Noon on the day the story reads the feed, in UTC: 13:00 in London. */
const DAY_NOW = new Date('2026-09-30T12:00:00.000Z')
const RIVERSIDE = '33333333-3333-4333-8333-333333333333'

/** An update at `at`, at one of two Properties. */
const updateAt = (n: number, at: string, atRiverside: boolean) =>
  makeNotification({
    id: `69000000-0000-4000-8000-00000000000${n}`,
    type: 'reply.published',
    status: 'read',
    propertyId: atRiverside ? RIVERSIDE : HARBOUR,
    payload: {
      propertyName: atRiverside ? 'Riverside Hotel' : 'Harbour View Suites',
      platform: 'google',
    },
    createdAt: new Date(at),
  })

/**
 * The page's grouping for Updates and All: by calendar day on the reader's
 * clock, not by 24-hour spans. 23:30 UTC on the 29th is already the 30th in
 * London, so it reads "Today"; 22:50 UTC is 23:50 there, "Yesterday".
 */
const dayRows = [
  updateAt(1, '2026-09-30T09:00:00.000Z', true),
  updateAt(2, '2026-09-29T23:30:00.000Z', false),
  updateAt(3, '2026-09-29T22:50:00.000Z', true),
  updateAt(4, '2026-09-27T12:00:00.000Z', false),
  updateAt(5, '2026-09-18T12:00:00.000Z', true),
]

/**
 * Groups by day, headed as the page heads them, under an h1. Each row names
 * its Property; no identifier reaches the page.
 */
export const GroupedByDay: Story = {
  args: {
    groups: groupByDay(dayRows, 'Europe/London', DAY_NOW),
    headingLevel: 2,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const headings = canvas.getAllByRole('heading', { level: 2 })
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Today',
      'Yesterday',
      'Earlier this week',
      'Older',
    ])
    const idsUnder = (label: string) =>
      within(canvas.getByRole('region', { name: label }))
        .getAllByRole('listitem')
        .map((row) => row.dataset.notificationId)
    expect(idsUnder('Today')).toEqual([dayRows[0]!.id, dayRows[1]!.id])
    expect(idsUnder('Yesterday')).toEqual([dayRows[2]!.id])
    expect(idsUnder('Earlier this week')).toEqual([dayRows[3]!.id])
    expect(idsUnder('Older')).toEqual([dayRows[4]!.id])
    expect(canvas.getAllByText('Riverside Hotel')).toHaveLength(3)
    expect(canvas.getAllByText('Harbour View Suites')).toHaveLength(2)
    for (const notification of dayRows) {
      expect(canvasElement.textContent).not.toContain(notification.propertyId)
    }
  },
}

/** New feedback at one Property; the caller says whose category each row keeps. */
const feedbackAt = (n: number, guestRating: 2 | 5, category?: 'workflow_collaboration') =>
  makeNotification({
    id: `68000000-0000-4000-8000-00000000000${n}`,
    type: 'feedback.created',
    category,
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites', platform: 'portal', guestRating },
    createdAt: new Date(Date.now() - n * 60_000),
  })

/**
 * A stack never hides a notice among others that ask less. Its key carries
 * the category, so a 2-star feedback (Action needed) stays a row of its own
 * beside a stack of feedback stored under another category, even at the same
 * Property. The rows are stored with categories the type alone would not
 * give them, which is what the override is for.
 */
export const StackKeepsADifferentCategoryApart: Story = {
  args: {
    groups: [
      {
        key: 'needs-you',
        label: 'Needs you',
        notifications: [
          feedbackAt(1, 5, 'workflow_collaboration'),
          feedbackAt(2, 2),
          feedbackAt(3, 5, 'workflow_collaboration'),
        ],
      },
    ],
    stack: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rows = canvas.getAllByRole('listitem')
    expect(rows).toHaveLength(2)

    const [stack, lowRating] = rows
    expect(stack).toHaveAttribute('data-notification-stack', '2')
    const stackLink = within(stack!).getByRole('link', {
      name: /^2 new feedback items at Harbour View Suites, latest \d+ minutes? ago, 2 unread$/,
    })
    const href = new URL(stackLink.getAttribute('href') ?? '', 'https://repkey.test')
    expect(href.pathname).toBe('/inbox')
    expect(href.searchParams.get('queue')).toBe('feedback')
    expect(href.searchParams.get('propertyId')).toBe(HARBOUR)

    expect(lowRating).not.toHaveAttribute('data-notification-stack')
    expect(lowRating).toHaveAttribute('data-notification-id', feedbackAt(2, 2).id)
    expect(within(lowRating!).getByRole('link')).toHaveAccessibleName(
      /^New guest feedback at Harbour View Suites, rated 2 of 5, /,
    )
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

/** Busy, not disabled: a disabled button would drop the focus it holds. */
export const LoadingMore: Story = {
  args: { hasMore: true, isLoadingMore: true, onLoadMore: fn() },
  play: async ({ args, canvasElement }) => {
    const loading = within(canvasElement).getByRole('button', { name: /loading/i })
    expect(loading).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(loading)
    expect(args.onLoadMore).not.toHaveBeenCalled()
  },
}
