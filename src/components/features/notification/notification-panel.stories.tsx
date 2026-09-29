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
import { toast } from 'sonner'
import { Toaster } from '#/components/ui/sonner'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
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
import { findOpenBellPopover, openBell } from './notification.stories.bell'
import type { NotificationServerFns } from './types'

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'

const unreadCount = notificationFixtures.filter((n) => n.status === 'unread').length

const loadedFns = makeNotificationFns({
  getFeedHead: (async () => ({
    page: notificationPageFixture(notificationFixtures),
    unreadCount,
    filterUnreadCount: unreadCount,
    watermark: 'story-loaded',
  })) as unknown as NotificationServerFns['getFeedHead'],
})

/** The head for every fixture row, with its unread count. */
const loadedFeedHead = (async () =>
  notificationFeedHeadFixture(
    notificationFixtures,
    unreadCount,
  )) as unknown as NotificationServerFns['getFeedHead']

type Popover = ReturnType<typeof within>

/** Picks `item` from the first row's menu. Radix portals the menu outside the popover. */
async function chooseFromFirstRowMenu(popover: Popover, item: string): Promise<void> {
  await userEvent.click(
    popover.getAllByRole('button', { name: /^More actions for:/ })[0]!,
  )
  await userEvent.click(
    await within(document.body).findByRole('menuitem', { name: item }),
  )
}

/** Dismisses the first row from its menu; answers how many rows the list held before. */
async function dismissFirstRow(popover: Popover): Promise<number> {
  const before = (await popover.findAllByRole('listitem')).length
  await chooseFromFirstRowMenu(popover, 'Dismiss')
  return before
}

/**
 * Opens a row's menu from the keyboard and chooses Dismiss. The menu opens on
 * its first item, "Mark as read" on an unread row; Dismiss is the next.
 */
async function dismissFromTheKeyboard(trigger: HTMLElement): Promise<void> {
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  const menu = within(document.body)
  await waitFor(() =>
    expect(menu.getByRole('menuitem', { name: 'Mark as read' })).toHaveFocus(),
  )
  await userEvent.keyboard('{ArrowDown}')
  expect(menu.getByRole('menuitem', { name: 'Dismiss' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
}

const meta: Meta<typeof NotificationPanel> = {
  title: 'Notification/NotificationPanel',
  component: NotificationPanel,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { notificationFns: loadedFns, organizationId: ORGANIZATION_ID },
  // Sonner's store outlives a story, and a Toaster that mounts replays every
  // toast still showing, so one story's toast would reappear in the next.
  beforeEach: () => {
    toast.dismiss()
  },
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
        filterUnreadCount: unreadCount,
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
    // Radix portals the popover outside the story canvas.
    const portal = await openBell(canvasElement)
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
      getFeedHead: loadedFeedHead,
      // Never settles: anything the user sees change is purely optimistic.
      dismiss: (() =>
        Promise.withResolvers<void>()
          .promise) as unknown as NotificationServerFns['dismiss'],
    }),
  },
  play: async ({ canvasElement }) => {
    const portal = await openBell(canvasElement)
    const before = await dismissFirstRow(portal)
    await waitFor(() => {
      expect(portal.getAllByRole('listitem')).toHaveLength(before - 1)
    })
  },
}

/** Row commands that never settle: everything the user sees is optimistic. */
const pendingRowFns = (rows: typeof notificationFixtures) =>
  makeNotificationFns({
    getFeedHead: (async () =>
      notificationFeedHeadFixture(
        rows,
      )) as unknown as NotificationServerFns['getFeedHead'],
    dismiss: (() =>
      Promise.withResolvers<void>()
        .promise) as unknown as NotificationServerFns['dismiss'],
    markRead: (() =>
      Promise.withResolvers<void>()
        .promise) as unknown as NotificationServerFns['markRead'],
  })

/**
 * The dismissed row takes the menu button that opened its menu with it. Focus
 * moves to the same control on the next row, so a keyboard user can clear one
 * notice after another, instead of landing on <body> outside the non-modal
 * popover.
 */
export const DismissKeepsFocusInTheList: Story = {
  args: { notificationFns: pendingRowFns(notificationFixtures) },
  play: async ({ canvasElement }) => {
    const popover = await openBell(canvasElement)
    const [first, second] = await popover.findAllByRole('button', {
      name: /^More actions for:/,
    })
    await dismissFromTheKeyboard(first!)
    await waitFor(() => expect(second).toHaveFocus())
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull())
  },
}

/** Marking read moves the row from New to Earlier (a remount); focus stays on New. */
export const MarkReadFromTheMenuKeepsFocus: Story = {
  args: { notificationFns: pendingRowFns(notificationFixtures) },
  play: async ({ canvasElement }) => {
    const popover = await openBell(canvasElement)
    const triggers = await popover.findAllByRole('button', { name: /^More actions for:/ })
    triggers[0]!.focus()
    await userEvent.keyboard('{Enter}')
    const markRead = await within(document.body).findByRole('menuitem', {
      name: 'Mark as read',
    })
    await waitFor(() => expect(markRead).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(triggers[1]).toHaveFocus())
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull())
  },
}

/** With no row left to move to, focus lands on the list itself, which says it is empty. */
export const DismissingTheLastRowFocusesTheList: Story = {
  args: { notificationFns: pendingRowFns(notificationFixtures.slice(0, 1)) },
  play: async ({ canvasElement }) => {
    const popover = await openBell(canvasElement)
    await dismissFromTheKeyboard(
      await popover.findByRole('button', { name: /^More actions for:/ }),
    )
    const list = await popover.findByRole('group', { name: 'Notification list' })
    await waitFor(() => expect(list).toHaveFocus())
    expect(within(list).getByText(/nothing here right now/i)).toBeInTheDocument()
  },
}

/** Mark-all-read is optimistic too: the "New" group empties immediately. */
export const MarkAllReadIsOptimistic: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: loadedFeedHead,
      markAllRead: (() =>
        Promise.withResolvers<void>()
          .promise) as unknown as NotificationServerFns['markAllRead'],
    }),
  },
  play: async ({ canvasElement }) => {
    const portal = await openBell(canvasElement)
    await userEvent.click(await portal.findByRole('button', { name: /mark all read/i }))
    await waitFor(() => {
      expect(portal.queryByRole('heading', { name: 'New' })).toBeNull()
    })
    expect(portal.getByRole('heading', { name: 'Earlier' })).toBeInTheDocument()
  },
}

/**
 * Opening the bell arms nothing. Radix used to focus the first tabbable
 * control, "Mark all read", with no ring after a pointer open, so one stray
 * Space or Enter marked every notification read. Focus starts on the list.
 * The bell is opened once first so its lazy body is already loaded, as a
 * hover over the bell has done by the time a real click lands.
 */
const armedMarkAllRead = fn(async () => undefined)
export const OpeningTheBellArmsNothing: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: loadedFeedHead,
      markAllRead: armedMarkAllRead as unknown as NotificationServerFns['markAllRead'],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openBell(canvasElement)
    await userEvent.keyboard('{Escape}')
    armedMarkAllRead.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: /^Notifications/ }))
    const popover = await findOpenBellPopover()
    const list = await popover.findByRole('group', { name: 'Notification list' })
    await waitFor(() => expect(list).toHaveFocus())
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{Enter}')

    expect(armedMarkAllRead).not.toHaveBeenCalled()
    expect(
      canvas.getByRole('button', { name: `Notifications, ${unreadCount} unread` }),
    ).toBeInTheDocument()
  },
}

/**
 * Two rows still waiting on the reader, and one whose work was settled
 * upstream: still unread, but asking for nothing, so not on the Unread tab.
 */
const tabbedFeed = [
  makeNotification({
    id: '60000000-0000-4000-8000-000000000001',
    type: 'inbox.escalated',
    priority: 'urgent',
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 2 * 60_000),
  }),
  makeNotification({
    id: '60000000-0000-4000-8000-000000000002',
    type: 'inbox_note.added',
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 3 * 60_000),
  }),
  makeNotification({
    id: '60000000-0000-4000-8000-000000000003',
    type: 'reply.pending_approval',
    resolvedAt: new Date(Date.now() - 60_000),
    payload: { propertyName: 'Harbour View Suites' },
    createdAt: new Date(Date.now() - 4 * 60_000),
  }),
]
const tabbedServer = makeStatefulNotificationFns(tabbedFeed)
const markTabRead = fn(tabbedServer.markAllRead)

/**
 * "Mark all read" marks what the tab shows. It sends the tab, so on Unread it
 * marks the rows still waiting and nothing else: the settled row keeps its
 * unread status. A settled row shows no read state, so that is read back from
 * the server the story runs against.
 */
export const MarkAllReadFollowsTheTab: Story = {
  args: {
    notificationFns: {
      ...tabbedServer,
      markAllRead: markTabRead as unknown as NotificationServerFns['markAllRead'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const popover = await openBell(canvasElement)
    await userEvent.click(await popover.findByRole('tab', { name: 'Unread' }))
    await waitFor(() => expect(popover.getAllByRole('listitem')).toHaveLength(2))
    await userEvent.click(popover.getByRole('button', { name: /mark all read/i }))

    expect(markTabRead).toHaveBeenCalledWith({ data: { filter: 'unread' } })
    await canvas.findByRole('button', { name: 'Notifications' })
    expect(popover.queryByRole('button', { name: /mark all read/i })).toBeNull()
    expect(await popover.findByText(/nothing here right now/i)).toBeInTheDocument()

    const { page } = await tabbedServer.getFeedHead({
      data: { limit: 20, filter: 'all' },
    })
    expect(page.notifications.map((row) => [row.id, row.status])).toEqual([
      [tabbedFeed[0]!.id, 'read'],
      [tabbedFeed[1]!.id, 'read'],
      [tabbedFeed[2]!.id, 'unread'],
    ])

    // On All the tab's rows are listed as read; the settled one is done.
    await userEvent.click(popover.getByRole('tab', { name: 'All' }))
    const earlier = await popover.findByRole('region', { name: 'Earlier' })
    await waitFor(() =>
      expect(
        within(earlier)
          .getAllByRole('listitem')
          .map((row) => row.dataset.notificationState),
      ).toEqual(['read', 'read', 'done']),
    )
  },
}

/**
 * The unread count is the Organization's, whatever the filter, so choosing a
 * tab must not blank the badge or tell a screen reader there is nothing
 * unread while that tab's first read is in flight. Tabs activate on Enter, not
 * on arrowing past them, and the popover opens on All again.
 */
export const FilterSwitchKeepsTheCount: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: ((input: Readonly<{ data: Readonly<{ filter: string }> }>) =>
        input.data.filter === 'all'
          ? Promise.resolve(
              notificationFeedHeadFixture(notificationFixtures, unreadCount),
            )
          : Promise.withResolvers<never>()
              .promise) as unknown as NotificationServerFns['getFeedHead'],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const counted = `Notifications, ${unreadCount} unread`
    await userEvent.click(await canvas.findByRole('button', { name: counted }))
    const popover = await findOpenBellPopover()
    const all = await popover.findByRole('tab', { name: 'All' })
    all.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(popover.getByRole('tab', { name: 'Unread' })).toHaveFocus()
    expect(all).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{Enter}')
    await popover.findByText('Loading notifications…')
    expect(canvas.getByRole('button', { name: counted })).toBeInTheDocument()
    expect(canvas.getByText(`${unreadCount} unread notifications`)).toBeInTheDocument()
    expect(canvas.queryByText('No unread notifications')).toBeNull()

    await userEvent.keyboard('{Escape}')
    await userEvent.click(canvas.getByRole('button', { name: counted }))
    const reopened = await findOpenBellPopover()
    expect(await reopened.findByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

/**
 * Ten rows: taller than a landscape phone, so the list has to scroll. Four are
 * unread, and the fifth was settled upstream: still unread, but done, so the
 * metrics can tell the unread dot from its absence.
 */
const tallFeed = Array.from({ length: 10 }, (_, n) =>
  makeNotification({
    id: `50000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
    type: n === 4 ? 'reply.pending_approval' : 'review.created',
    status: n <= 4 ? 'unread' : 'read',
    resolvedAt: n === 4 ? new Date(Date.now() - 60_000) : null,
    payload: { propertyName: 'Harbour View Suites', platform: 'google' },
    createdAt: new Date(Date.now() - (n + 1) * 7 * 60_000),
  }),
)

/**
 * The bell where the app puts it, at the right end of the top bar, on a phone.
 * The popover must stay inside the viewport at 320-375 px and in landscape,
 * with its footer reachable. Geometry is measured against compiled Tailwind by
 * e2e/storybook-metrics/notification-popover.metrics.ts; this runner compiles
 * none, so its play only opens the bell.
 */
export const PhoneTopBar: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () =>
        notificationFeedHeadFixture(
          tallFeed,
        )) as unknown as NotificationServerFns['getFeedHead'],
    }),
  },
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobileNarrow' } },
  render: (args) => (
    <header className="flex h-12 items-center justify-end border-b px-2">
      <NotificationPanel {...args} />
    </header>
  ),
  play: async ({ canvasElement }) => {
    const popover = await openBell(canvasElement)
    await waitFor(() => expect(popover.getAllByRole('listitem')).toHaveLength(10))
    expect(
      popover.getByRole('link', { name: 'View all notifications' }),
    ).toBeInTheDocument()
  },
}

/**
 * The same popover in the light theme, where the unread dot has to hold its
 * own against a white popover. Measured by the same metrics file.
 */
export const PhoneTopBarLight: Story = {
  ...PhoneTopBar,
  parameters: { ...PhoneTopBar.parameters, theme: 'light' },
}

/** More rows than the bell's page of 20, so it offers "Load more". */
const pagedFeed = Array.from({ length: 25 }, (_, n) =>
  makeNotification({
    id: `63000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
    type: 'review.created',
    status: 'read',
    payload: { propertyName: 'Harbour View Suites', platform: 'google' },
    createdAt: new Date(Date.now() - (n + 1) * 60_000),
  }),
)
const olderPage = Promise.withResolvers<ReturnType<typeof notificationPageFixture>>()

/**
 * "Load more" keeps keyboard focus while it loads. It used to disable itself,
 * and a focused button that becomes disabled drops focus to <body> in
 * Chromium, outside the non-modal popover. When the last page arrives and the
 * button goes, focus moves to the list.
 */
export const LoadMoreKeepsFocus: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () =>
        notificationFeedHeadFixture(
          pagedFeed.slice(0, 20),
          0,
          true,
        )) as unknown as NotificationServerFns['getFeedHead'],
      getList: (() => olderPage.promise) as unknown as NotificationServerFns['getList'],
    }),
  },
  play: async ({ canvasElement }) => {
    const popover = await openBell(canvasElement)
    ;(await popover.findByRole('button', { name: 'Load more' })).focus()
    await userEvent.keyboard('{Enter}')

    const loading = await popover.findByRole('button', { name: /loading/i })
    expect(loading).toHaveFocus()
    expect(loading).toHaveAttribute('aria-disabled', 'true')

    olderPage.resolve(notificationPageFixture(pagedFeed.slice(20)))
    await waitFor(() => expect(popover.getAllByRole('listitem')).toHaveLength(25))
    expect(popover.queryByRole('button', { name: /load more|loading/i })).toBeNull()
    await waitFor(() =>
      expect(popover.getByRole('group', { name: 'Notification list' })).toHaveFocus(),
    )
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
    const portal = await openBell(canvasElement)
    expect(await portal.findByRole('button', { name: /retry/i })).toBeInTheDocument()
  },
}

/**
 * The session ended under the open tab (signed out elsewhere, expired, or a
 * password change revoked it): the bell offers sign-in, not a Retry that can
 * never succeed.
 */
export const SessionEnded: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: (async () => {
        throw new ServerFunctionError('AuthError', 'Unauthorized', 'unauthorized', 401)
      }) as unknown as NotificationServerFns['getFeedHead'],
    }),
  },
  play: async ({ canvasElement }) => {
    const popover = await openBell(canvasElement)
    expect(
      await popover.findByRole('link', { name: 'Sign in again' }),
    ).toBeInTheDocument()
    expect(popover.queryByRole('button', { name: /retry/i })).toBeNull()
  },
}

export const Empty: Story = {
  args: { notificationFns: makeNotificationFns() },
  play: async ({ canvasElement }) => {
    const portal = await openBell(canvasElement)
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
async function expectToast(message: string | RegExp): Promise<HTMLElement> {
  const text = await within(document.body).findByText(message)
  await waitFor(() => expect(text).toBeVisible())
  return text
}

/** The Undo offered by the toast that says `message`. */
async function findToastUndo(message: string): Promise<HTMLElement> {
  const shown = (await expectToast(message)).closest<HTMLElement>('[data-sonner-toast]')
  if (shown === null) throw new Error(`"${message}" is not in a toast`)
  return within(shown).getByRole('button', { name: 'Undo' })
}

const MUTE_ITEM = 'Mute workflow and collaboration for this property'
const MUTE_CONFIRMATION =
  'In-app workflow and collaboration notices muted for Harbour View Suites, including earlier ones.'

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
    // Scoped to the popover: a sonner toast is a list item of its own.
    const portal = await openBell(canvasElement)
    await waitFor(() => expect(portal.getAllByRole('listitem')).toHaveLength(3))
    const readsBefore = readMuteFeedHead.mock.calls.length
    await chooseFromFirstRowMenu(portal, MUTE_ITEM)

    await waitFor(() => expect(portal.getAllByRole('listitem')).toHaveLength(1))
    expect(
      portal.getByRole('link', { name: /^New review at Riverside Hotel,/ }),
    ).toBeInTheDocument()
    expect(muteInApp).toHaveBeenCalledWith({
      data: { propertyId: HARBOUR, category: 'workflow_collaboration' },
    })
    await expectToast(MUTE_CONFIRMATION)
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
      getFeedHead: loadedFeedHead,
      dismiss: (async () => {
        throw new Error('network down')
      }) as unknown as NotificationServerFns['dismiss'],
    }),
  },
  play: async ({ canvasElement }) => {
    const portal = await openBell(canvasElement)
    const before = await dismissFirstRow(portal)
    await expectToast("Couldn't dismiss that notification. Try again.")
    await waitFor(() => expect(portal.getAllByRole('listitem')).toHaveLength(before))
  },
}

const muteUndoServer = makeStatefulNotificationFns(muteFeed)
const undoMuteInApp = fn(muteUndoServer.undoMuteCategory)

/**
 * Nothing else on screen says what a mute covered, so its toast offers Undo.
 * Undo puts the switch back as the mute found it (`previous`, from the mute's
 * own answer) and the muted rows return. A press on a toast is not a press
 * outside the bell, so the popover stays open; the rows come back in it, and
 * the badge counts them at once.
 */
export const MuteOffersUndo: Story = {
  args: {
    notificationFns: {
      ...muteUndoServer,
      undoMuteCategory:
        undoMuteInApp as unknown as NotificationServerFns['undoMuteCategory'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const popover = await openBell(canvasElement)
    await waitFor(() => expect(popover.getAllByRole('listitem')).toHaveLength(3))
    await chooseFromFirstRowMenu(popover, MUTE_ITEM)
    await waitFor(() => expect(popover.getAllByRole('listitem')).toHaveLength(1))
    await canvas.findByRole('button', { name: 'Notifications, 1 unread' })

    await userEvent.click(await findToastUndo(MUTE_CONFIRMATION))
    await waitFor(() =>
      expect(undoMuteInApp).toHaveBeenCalledWith({
        data: { propertyId: HARBOUR, category: 'workflow_collaboration', previous: null },
      }),
    )
    await expectToast('Mute undone.')
    await canvas.findByRole('button', { name: 'Notifications, 3 unread' })

    // The press on the toast was not a press outside the bell: it stays open,
    // and the rows come back where the reader is looking.
    await waitFor(() =>
      expect(
        popover.getAllByRole('listitem').map((row) => row.dataset.notificationId),
      ).toEqual(muteFeed.map((row) => row.id)),
    )
  },
}

/** Two rows to dismiss and take back. */
const undoableFeed = [
  makeNotification({
    id: '64000000-0000-4000-8000-000000000001',
    type: 'review.created',
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - 60_000),
  }),
  makeNotification({
    id: '64000000-0000-4000-8000-000000000002',
    type: 'inbox_note.added',
    payload: { propertyName: 'Harbour View Suites' },
    createdAt: new Date(Date.now() - 2 * 60_000),
  }),
]
const undoableServer = makeStatefulNotificationFns(undoableFeed)
const restoreDismissed = fn(undoableServer.restore)

/**
 * A dismissed row has nowhere else to be found again, so the toast confirming
 * the dismissal offers Undo, and Undo brings the row back as it was, unread.
 * Choosing it does not close the bell (a press on a toast is not a press
 * outside it), so the row comes back in front of the reader, and the badge
 * counts it at once.
 */
export const DismissOffersUndo: Story = {
  args: {
    notificationFns: {
      ...undoableServer,
      restore: restoreDismissed as unknown as NotificationServerFns['restore'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const popover = await openBell(canvasElement)
    const before = await dismissFirstRow(popover)
    await waitFor(() => expect(popover.getAllByRole('listitem')).toHaveLength(before - 1))
    await canvas.findByRole('button', { name: 'Notifications, 1 unread' })

    await userEvent.click(await findToastUndo('Notification dismissed.'))
    await waitFor(() =>
      expect(restoreDismissed).toHaveBeenCalledWith({
        data: { notificationId: undoableFeed[0]!.id },
      }),
    )
    await expectToast('Notification restored.')
    await canvas.findByRole('button', { name: 'Notifications, 2 unread' })

    // The bell stayed open under the toast, and the row is back in it, unread.
    const restored = await popover.findByRole('link', {
      name: /^New review at Riverside Hotel, .*, unread$/,
    })
    expect(restored.closest('li')).toHaveAttribute('data-notification-state', 'unread')
    expect(popover.getAllByRole('listitem')).toHaveLength(before)
  },
}

/**
 * Timestamps use the user's PERSISTED locale and IANA timezone. The old
 * formatter hardcoded `'en-US'` even though the settings page advertises both
 * values as "used for notification formatting". The row's own compact clock
 * ("12m") stays English, like every word in the product; the relative time a
 * screen reader hears and the absolute time in the tooltip follow the reader.
 */
export const HonoursPersistedLocale: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: loadedFeedHead,
      getUserSettings: (async () => ({
        ...notificationUserSettingsFixture,
        locale: 'de-DE',
        timezone: 'Europe/Berlin',
      })) as unknown as NotificationServerFns['getUserSettings'],
    }),
  },
  play: async ({ canvasElement }) => {
    const portal = await openBell(canvasElement)
    await portal.findAllByRole('listitem')
    await waitFor(() => {
      expect(
        portal.getAllByRole('link', { name: /, vor \d+ Minuten, unread$/ }).length,
      ).toBeGreaterThan(0)
    })
    const times = [...document.querySelectorAll('[data-slot="popover-content"] time')]
    expect(times.length).toBeGreaterThan(0)
    for (const time of times) {
      expect(time.textContent).toMatch(/^\d+[mh]$/)
      // "29.09.2026, 23:21 MESZ": the German date, on Berlin's clock.
      expect(time.getAttribute('title')).toMatch(
        /^\d{2}\.\d{2}\.\d{4}, \d{1,2}:\d{2} MES?Z$/,
      )
    }
  },
}
