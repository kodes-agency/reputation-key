// The bell trigger + popover, mounted for real.
//
// The previous version of this file carried a comment claiming
// `PopoverTrigger asChild` swallowed Radix's merged props so the bell could
// never open — and, because of that claim, 4 of its 5 stories overrode `render:`
// to mount NotificationPopoverContent directly. NotificationPanel itself was
// therefore never exercised and its `args` were inert. It does open: the trigger
// wraps `Button`, which forwards every prop. These stories click the real bell.
//
// The panel consumes a `NotificationServerFns` bundle of raw server-fn
// references and wraps each one internally, so stories feed a mock bundle built
// by `makeNotificationFns` — no RPC, no live server, and the only casts live in
// that one factory.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Toaster } from '#/components/ui/sonner'
import {
  makeNotification,
  makeNotificationFns,
  makeStatefulNotificationFns,
  notificationFeedHeadFixture,
  notificationFixtures,
  notificationPageFixture,
  notificationUserSettingsFixture,
} from './notification.stories.fixtures'
import { NotificationPanel } from './notification-panel'
import type { NotificationServerFns } from './types'

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'

const unreadCount = notificationFixtures.filter((n) => n.status === 'unread').length

const loadedFns = makeNotificationFns({
  getFeedHead: (async () => ({
    page: notificationPageFixture(notificationFixtures),
    unreadCount,
    watermark: 'story-loaded',
  })) as unknown as NotificationServerFns['getFeedHead'],
})

const meta: Meta<typeof NotificationPanel> = {
  title: 'Notification/NotificationPanel',
  component: NotificationPanel,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { notificationFns: loadedFns, organizationId: ORGANIZATION_ID },
  // The app's toaster: failures and mutes must be seen, not only announced.
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof NotificationPanel>

/** The badge reflects the unread count without the popover being opened. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByRole('button', { name: `Notifications, ${unreadCount} unread` }),
    ).toBeInTheDocument()
  },
}

/** The badge and offset-zero rows come from one request, never two observers. */
export const AtomicFeedHeadAuthority: Story = {
  args: {
    notificationFns: (() => {
      const getFeedHead = fn(async () => ({
        page: notificationPageFixture(notificationFixtures),
        unreadCount,
        watermark: 'story-atomic-head',
      }))
      const getList = fn(async () => notificationPageFixture())
      return makeNotificationFns({
        getFeedHead: getFeedHead as unknown as NotificationServerFns['getFeedHead'],
        getList: getList as unknown as NotificationServerFns['getList'],
      })
    })(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByRole('button', { name: `Notifications, ${unreadCount} unread` }),
    ).toBeInTheDocument()
    expect(args.notificationFns.getFeedHead).toHaveBeenCalledTimes(1)
    expect(args.notificationFns.getList).not.toHaveBeenCalled()
  },
}

/** Clicking the real bell opens the real popover. */
export const OpensOnClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
    // Radix portals the popover outside the story canvas.
    const portal = within(document.body)
    expect(
      await portal.findByRole('heading', { name: 'Notifications' }),
    ).toBeInTheDocument()
    expect(await portal.findByRole('heading', { name: 'New' })).toBeInTheDocument()
    expect(
      portal.getByRole('link', { name: 'View all notifications' }),
    ).toBeInTheDocument()
  },
}

/** Dismiss is optimistic: the row leaves before the server answers. */
export const DismissRemovesRowOptimistically: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () =>
        notificationFeedHeadFixture(
          notificationFixtures,
          unreadCount,
        )) as unknown as NotificationServerFns['getFeedHead'],
      // Never settles: anything the user sees change is purely optimistic.
      dismiss: (() =>
        Promise.withResolvers<void>()
          .promise) as unknown as NotificationServerFns['dismiss'],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
    const portal = within(document.body)
    const before = (await portal.findAllByRole('listitem')).length
    await userEvent.click(portal.getAllByRole('button', { name: /^Dismiss:/ })[0])
    await waitFor(() => {
      expect(portal.getAllByRole('listitem')).toHaveLength(before - 1)
    })
  },
}

/** Mark-all-read is optimistic too: the "New" group empties immediately. */
export const MarkAllReadIsOptimistic: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () =>
        notificationFeedHeadFixture(
          notificationFixtures,
          unreadCount,
        )) as unknown as NotificationServerFns['getFeedHead'],
      markAllRead: (() =>
        Promise.withResolvers<void>()
          .promise) as unknown as NotificationServerFns['markAllRead'],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
    const portal = within(document.body)
    await userEvent.click(await portal.findByRole('button', { name: /mark all read/i }))
    await waitFor(() => {
      expect(portal.queryByRole('heading', { name: 'New' })).toBeNull()
    })
    expect(portal.getByRole('heading', { name: 'Earlier' })).toBeInTheDocument()
  },
}

/** Reads that never settle → the list holds its skeleton, the badge stays absent. */
export const Loading: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (() =>
        Promise.withResolvers<ReturnType<typeof notificationFeedHeadFixture>>()
          .promise) as unknown as NotificationServerFns['getFeedHead'],
    }),
  },
}

/** The unified feed-head rejects → the error state and its Retry control render. */
export const ErrorState: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () => {
        throw new Error('Notifications service unavailable')
      }) as unknown as NotificationServerFns['getFeedHead'],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
    const portal = within(document.body)
    expect(await portal.findByRole('button', { name: /retry/i })).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: { notificationFns: makeNotificationFns() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
    const portal = within(document.body)
    expect(await portal.findByText(/nothing here right now/i)).toBeInTheDocument()
  },
}

const HARBOUR = '66666666-6666-4666-8666-666666666666'
const RIVERSIDE = '33333333-3333-4333-8333-333333333333'
const workflowRow = (n: number, propertyId: string, propertyName: string) =>
  makeNotification({
    id: `40000000-0000-4000-8000-00000000000${n}`,
    type: 'review.created',
    status: 'unread',
    propertyId,
    payload: { propertyName, platform: 'google' },
    createdAt: new Date(Date.now() - n * 60_000),
  })
/** Two Harbour workflow rows, and one at Riverside that a Harbour mute must keep. */
const muteFeed = [
  workflowRow(1, HARBOUR, 'Harbour View Suites'),
  workflowRow(2, RIVERSIDE, 'Riverside Hotel'),
  workflowRow(3, HARBOUR, 'Harbour View Suites'),
]

/** The toast carrying `message`, once it has entered (sonner animates it in). */
async function expectToast(message: string | RegExp): Promise<void> {
  const text = await within(document.body).findByText(message)
  await waitFor(() => expect(text).toBeVisible())
}

/**
 * Muting sends only the semantic command, takes that Property's rows of the
 * category out of the list at once (the server hides them from now on, earlier
 * ones included), and says so where a sighted user can see it.
 */
const muteServer = makeStatefulNotificationFns(muteFeed)
const readMuteFeedHead = fn(muteServer.getFeedHead)
const muteInApp = fn(muteServer.muteCategory)

export const MuteCategory: Story = {
  args: {
    notificationFns: {
      ...muteServer,
      getFeedHead: readMuteFeedHead as unknown as NotificationServerFns['getFeedHead'],
      muteCategory: muteInApp as unknown as NotificationServerFns['muteCategory'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
    // Scoped to the popover: a sonner toast is a list item of its own.
    const portal = within(await within(document.body).findByRole('dialog'))
    await waitFor(() => expect(portal.getAllByRole('listitem')).toHaveLength(3))
    const readsBefore = readMuteFeedHead.mock.calls.length
    await userEvent.click(
      portal.getAllByRole('button', { name: /^More actions for:/ })[0]!,
    )
    await userEvent.click(
      await within(document.body).findByRole('menuitem', {
        name: 'Mute workflow and collaboration for this property',
      }),
    )

    await waitFor(() => expect(portal.getAllByRole('listitem')).toHaveLength(1))
    expect(portal.getByText('New review at Riverside Hotel')).toBeInTheDocument()
    expect(muteInApp).toHaveBeenCalledWith({
      data: { propertyId: HARBOUR, category: 'workflow_collaboration' },
    })
    await expectToast(
      'In-app workflow and collaboration notices muted for Harbour View Suites, including earlier ones.',
    )
    // The feed is read again, so the badge and any loaded history follow.
    await waitFor(() =>
      expect(readMuteFeedHead.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  },
}

/** A failed dismiss puts the row back and says why, instead of silently undoing itself. */
export const FailedDismissSaysSo: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () =>
        notificationFeedHeadFixture(
          notificationFixtures,
          unreadCount,
        )) as unknown as NotificationServerFns['getFeedHead'],
      dismiss: (async () => {
        throw new Error('network down')
      }) as unknown as NotificationServerFns['dismiss'],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
    const portal = within(await within(document.body).findByRole('dialog'))
    const before = (await portal.findAllByRole('listitem')).length
    await userEvent.click(portal.getAllByRole('button', { name: /^Dismiss:/ })[0]!)
    await expectToast("Couldn't dismiss that notification. Try again.")
    await waitFor(() => expect(portal.getAllByRole('listitem')).toHaveLength(before))
  },
}

/**
 * Timestamps use the user's PERSISTED locale and IANA timezone. The old
 * formatter hardcoded `'en-US'` even though the settings page advertises both
 * values as "used for notification formatting".
 */
export const HonoursPersistedLocale: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () =>
        notificationFeedHeadFixture(
          notificationFixtures,
          unreadCount,
        )) as unknown as NotificationServerFns['getFeedHead'],
      getUserSettings: (async () => ({
        ...notificationUserSettingsFixture,
        locale: 'de-DE',
        timezone: 'Europe/Berlin',
      })) as unknown as NotificationServerFns['getUserSettings'],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
    const portal = within(document.body)
    await portal.findAllByRole('listitem')
    await waitFor(() => {
      expect(portal.getAllByText(/vor \d+ Minuten/).length).toBeGreaterThan(0)
    })
  },
}
