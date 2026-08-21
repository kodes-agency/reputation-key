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
import {
  makeNotificationFns,
  notificationFixtures,
  notificationUserSettingsFixture,
} from './notification-fixtures'
import { NotificationPanel } from './notification-panel'
import type { NotificationServerFns } from './types'

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'

const unreadCount = notificationFixtures.filter((n) => n.status === 'unread').length

const loadedFns = makeNotificationFns({
  getUnreadCount: (async () => ({
    count: unreadCount,
  })) as unknown as NotificationServerFns['getUnreadCount'],
  getList: (async () =>
    notificationFixtures) as unknown as NotificationServerFns['getList'],
})

const meta: Meta<typeof NotificationPanel> = {
  title: 'Notification/NotificationPanel',
  component: NotificationPanel,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { notificationFns: loadedFns, organizationId: ORGANIZATION_ID },
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
      getUnreadCount: (async () => ({
        count: unreadCount,
      })) as unknown as NotificationServerFns['getUnreadCount'],
      getList: (async () =>
        notificationFixtures) as unknown as NotificationServerFns['getList'],
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
      getUnreadCount: (async () => ({
        count: unreadCount,
      })) as unknown as NotificationServerFns['getUnreadCount'],
      getList: (async () =>
        notificationFixtures) as unknown as NotificationServerFns['getList'],
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
      getUnreadCount: (() =>
        Promise.withResolvers<{ count: number }>()
          .promise) as unknown as NotificationServerFns['getUnreadCount'],
      getList: (() =>
        Promise.withResolvers<typeof notificationFixtures>()
          .promise) as unknown as NotificationServerFns['getList'],
    }),
  },
}

/** getList rejects → the error state and its Retry control render. */
export const ErrorState: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getList: (async () => {
        throw new Error('Notifications service unavailable')
      }) as unknown as NotificationServerFns['getList'],
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

/** Muting reads preferences lazily and writes the in-app channel off. */
export const MuteCategory: Story = {
  args: {
    notificationFns: (() => {
      const updatePreference = fn(async () => undefined)
      return makeNotificationFns({
        getUnreadCount: (async () => ({
          count: unreadCount,
        })) as unknown as NotificationServerFns['getUnreadCount'],
        getList: (async () =>
          notificationFixtures) as unknown as NotificationServerFns['getList'],
        updatePreference:
          updatePreference as unknown as NotificationServerFns['updatePreference'],
      })
    })(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Notifications/ }))
    const portal = within(document.body)
    await userEvent.click(
      (await portal.findAllByRole('button', { name: /^More actions for:/ }))[0],
    )
    await userEvent.click(await portal.findByRole('menuitem', { name: /^Mute/ }))
    await waitFor(() => {
      expect(args.notificationFns.updatePreference).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: 'in_app', enabled: false }),
      })
    })
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
      getUnreadCount: (async () => ({
        count: unreadCount,
      })) as unknown as NotificationServerFns['getUnreadCount'],
      getList: (async () =>
        notificationFixtures) as unknown as NotificationServerFns['getList'],
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
