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
// references and wraps each one internally, so stories feed a mock bundle — no
// RPC, no live server, and the only casts live in the fixture factory.
//
// The bell reads the feed the way the owner chose (docs/design/notifications,
// D1–D2): its badge and first list are what needs the reader, and below them
// the popover reads Updates itself, only while it is open. Both go through the
// one `getFeedHead`, by filter, so the stories run against a server that
// answers each filter as the endpoint does (`makeStatefulNotificationFns`),
// with any command a story holds open replaced.
import type { Meta, StoryObj } from '@storybook/react'
import { focusManager } from '@tanstack/react-query'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { toast } from 'sonner'
import { Toaster } from '#/components/ui/sonner'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  makeNotification,
  makeNotificationFns,
  notificationFeedHeadFixture,
  makeStatefulNotificationFns,
  notificationFixtures,
  notificationPageFixture,
  notificationUserSettingsFixture,
} from './notification.stories.fixtures'
import { NotificationPanel } from './notification-panel'
import { needsReader } from './notification-filters'
import { findOpenBellPopover, openBell } from './notification.stories.bell'
import type { NotificationServerFns } from './types'

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const HARBOUR = '66666666-6666-4666-8666-666666666666'
const RIVERSIDE = '33333333-3333-4333-8333-333333333333'
const MINUTE = 60_000

/** What the fixture feed holds that needs the reader: the three unread requests. */
const needsYouCount = notificationFixtures.filter(needsReader).length
const counted = `Notifications, ${needsYouCount} need you`

/** A command that never settles, so everything the reader sees change is optimistic. */
function heldOpen<K extends keyof NotificationServerFns>(): NotificationServerFns[K] {
  return (() =>
    Promise.withResolvers<never>().promise) as unknown as NotificationServerFns[K]
}

/** The fixture feed, with dismissing and marking read held open. */
const pendingRowFns = (rows: typeof notificationFixtures) =>
  makeStatefulNotificationFns(rows, {
    dismiss: heldOpen<'dismiss'>(),
    markRead: heldOpen<'markRead'>(),
  })

type Popover = ReturnType<typeof within>

/** The bell's two lists, each a focusable group named for what it holds. */
async function bellLists(popover: Popover) {
  const needsYou = await popover.findByRole('group', { name: 'Needs you' })
  const updates = await popover.findByRole('group', { name: 'Updates' })
  return { needsYou, updates }
}

/** The ids a section lists, in order: a stack answers to its newest member. */
const idsIn = (section: HTMLElement) =>
  within(section)
    .getAllByRole('listitem')
    .map((row) => row.dataset.notificationId)

/** Picks `item` from the first row's menu. Radix portals the menu outside the popover. */
async function chooseFromFirstRowMenu(popover: Popover, item: string): Promise<void> {
  await userEvent.click(
    popover.getAllByRole('button', { name: /^More actions for:/ })[0]!,
  )
  await userEvent.click(
    await within(document.body).findByRole('menuitem', { name: item }),
  )
}

/** Dismisses the first row from its menu; answers how many rows the lists held before. */
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

const meta: Meta<typeof NotificationPanel> = {
  title: 'Notification/NotificationPanel',
  component: NotificationPanel,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    notificationFns: makeStatefulNotificationFns(notificationFixtures),
    organizationId: ORGANIZATION_ID,
  },
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

/** The badge counts what needs the reader, without the popover being opened. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByRole('button', { name: counted })).toBeInTheDocument()
    expect(
      canvas.getByText(`${needsYouCount} notifications need you`),
    ).toBeInTheDocument()
  },
}

/**
 * The badge and the Needs-you rows come from one request, never two observers,
 * and a closed bell reads nothing else: not Updates, not history.
 */
export const AtomicFeedHeadAuthority: Story = {
  args: {
    notificationFns: (() => {
      const server = makeStatefulNotificationFns(notificationFixtures)
      return {
        ...server,
        getFeedHead: fn(
          server.getFeedHead,
        ) as unknown as NotificationServerFns['getFeedHead'],
        getList: fn(server.getList) as unknown as NotificationServerFns['getList'],
      }
    })(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByRole('button', { name: counted })).toBeInTheDocument()
    expect(args.notificationFns.getFeedHead).toHaveBeenCalledTimes(1)
    expect(args.notificationFns.getFeedHead).toHaveBeenCalledWith({
      data: { limit: 20, filter: 'needs_you' },
    })
    expect(args.notificationFns.getList).not.toHaveBeenCalled()
  },
}

/** Clicking the real bell opens the real popover: Needs you, then Updates. */
export const OpensOnClick: Story = {
  play: async ({ canvasElement }) => {
    // Radix portals the popover outside the story canvas.
    const portal = await openBell(canvasElement)
    expect(
      await portal.findByRole('heading', { name: 'Notifications' }),
    ).toBeInTheDocument()
    expect(await portal.findByRole('heading', { name: 'Needs you' })).toBeInTheDocument()
    expect(await portal.findByRole('heading', { name: 'Updates' })).toBeInTheDocument()
    expect(
      portal.getByRole('link', { name: 'View all notifications' }),
    ).toBeInTheDocument()
  },
}

/**
 * Two requests of the reader, one piece of unread news and one read. The
 * news is unread, but it asks for nothing.
 */
const sectionFeed = [
  makeNotification({
    id: '65000000-0000-4000-8000-000000000001',
    type: 'inbox.escalated',
    priority: 'urgent',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 2 * MINUTE),
  }),
  makeNotification({
    id: '65000000-0000-4000-8000-000000000002',
    type: 'reply.published',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - 3 * MINUTE),
  }),
  makeNotification({
    id: '65000000-0000-4000-8000-000000000003',
    type: 'feedback.created',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites', platform: 'portal', guestRating: 2 },
    createdAt: new Date(Date.now() - 4 * MINUTE),
  }),
  makeNotification({
    id: '65000000-0000-4000-8000-000000000004',
    type: 'inbox_note.added',
    status: 'read',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites' },
    createdAt: new Date(Date.now() - 5 * MINUTE),
  }),
]
const sectionServer = makeStatefulNotificationFns(sectionFeed)
const readSectionHead = fn(sectionServer.getFeedHead)
const readSectionHistory = fn(sectionServer.getList)

/**
 * What needs the reader comes first, and is what the badge counts: two, though
 * three rows are unread — the unread news keeps its dot under Updates and does
 * not raise the badge. Updates are read only once the bell is open, a few rows
 * deep and with no history: the page holds the rest.
 */
export const NeedsYouAboveUpdates: Story = {
  args: {
    notificationFns: {
      ...sectionServer,
      getFeedHead: readSectionHead as unknown as NotificationServerFns['getFeedHead'],
      getList: readSectionHistory as unknown as NotificationServerFns['getList'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bell = await canvas.findByRole('button', { name: 'Notifications, 2 need you' })
    expect(canvas.getByText('2 notifications need you')).toBeInTheDocument()
    expect(readSectionHead).toHaveBeenCalledWith({
      data: { limit: 20, filter: 'needs_you' },
    })
    expect(readSectionHead).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ filter: 'updates' }),
    })

    await userEvent.click(bell)
    const popover = await findOpenBellPopover()
    const needsYou = await popover.findByRole('region', { name: 'Needs you' })
    const updates = await popover.findByRole('region', { name: 'Updates' })
    expect(
      needsYou.compareDocumentPosition(updates) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(idsIn(needsYou)).toEqual([sectionFeed[0]!.id, sectionFeed[2]!.id])
    expect(
      within(updates)
        .getAllByRole('listitem')
        .map((row) => [row.dataset.notificationId, row.dataset.notificationState]),
    ).toEqual([
      [sectionFeed[1]!.id, 'unread'],
      [sectionFeed[3]!.id, 'read'],
    ])
    expect(readSectionHead).toHaveBeenCalledWith({
      data: { limit: 8, filter: 'updates' },
    })
    expect(readSectionHistory).not.toHaveBeenCalled()
  },
}

/**
 * Needs you, most pressing first: what is on a clock — urgent, or past its
 * Response Target — then the rest, each newest first. The server sends them
 * newest first.
 */
const pressingFeed = [
  makeNotification({
    id: '66000000-0000-4000-8000-000000000001',
    type: 'feedback.created',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites', platform: 'portal', guestRating: 4 },
    createdAt: new Date(Date.now() - MINUTE),
  }),
  makeNotification({
    id: '66000000-0000-4000-8000-000000000002',
    type: 'inbox.response_target_passed',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 10 * MINUTE),
  }),
  makeNotification({
    id: '66000000-0000-4000-8000-000000000003',
    type: 'review.created',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - 20 * MINUTE),
  }),
  makeNotification({
    id: '66000000-0000-4000-8000-000000000004',
    type: 'inbox.escalated',
    priority: 'urgent',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites' },
    createdAt: new Date(Date.now() - 40 * MINUTE),
  }),
]

export const NeedsYouMostPressingFirst: Story = {
  args: { notificationFns: makeStatefulNotificationFns(pressingFeed) },
  play: async ({ canvasElement }) => {
    const popover = await openBell(canvasElement)
    const needsYou = await popover.findByRole('region', { name: 'Needs you' })
    await waitFor(() =>
      expect(idsIn(needsYou)).toEqual(
        [1, 3, 0, 2].map((index) => pressingFeed[index]!.id),
      ),
    )
    expect(within(needsYou).getAllByRole('link')[0]).toHaveAccessibleName(
      /^Response target passed at Riverside Hotel, target passed, /,
    )
  },
}

/** Dismiss is optimistic: the row leaves before the server answers. */
export const DismissRemovesRowOptimistically: Story = {
  args: {
    notificationFns: makeStatefulNotificationFns(notificationFixtures, {
      dismiss: heldOpen<'dismiss'>(),
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

/**
 * Marking a row read takes it out of Needs you (a remount): it no longer waits
 * on the reader. Focus moves to the next row there.
 */
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
    const needsYou = popover.getByRole('region', { name: 'Needs you' })
    expect(idsIn(needsYou)).not.toContain(notificationFixtures[0]!.id)
  },
}

/**
 * With no row left to move to, focus lands on the list itself — the Needs-you
 * list, which now says so in one line.
 */
export const DismissingTheLastRowFocusesTheList: Story = {
  args: { notificationFns: pendingRowFns(notificationFixtures.slice(0, 1)) },
  play: async ({ canvasElement }) => {
    const popover = await openBell(canvasElement)
    await dismissFromTheKeyboard(
      await popover.findByRole('button', { name: /^More actions for:/ }),
    )
    const { needsYou } = await bellLists(popover)
    await waitFor(() => expect(needsYou).toHaveFocus())
    expect(within(needsYou).getByText('Nothing needs you right now')).toBeInTheDocument()
  },
}

/** Mark-all-read is optimistic too: Needs you empties at once. */
export const MarkAllReadIsOptimistic: Story = {
  args: {
    notificationFns: makeStatefulNotificationFns(notificationFixtures, {
      markAllRead: heldOpen<'markAllRead'>(),
    }),
  },
  play: async ({ canvasElement }) => {
    const portal = await openBell(canvasElement)
    await userEvent.click(await portal.findByRole('button', { name: /mark all read/i }))
    await waitFor(() => {
      expect(portal.queryByRole('heading', { name: 'Needs you' })).toBeNull()
    })
    expect(portal.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(portal.getByRole('heading', { name: 'Updates' })).toBeInTheDocument()
  },
}

/**
 * Opening the bell arms nothing. Radix used to focus the first tabbable
 * control, "Mark all read", with no ring after a pointer open, so one stray
 * Space or Enter marked every notification read. Focus starts on the
 * Needs-you list. The bell is opened once first so its lazy body is already
 * loaded, as a hover over the bell has done by the time a real click lands.
 */
const armedMarkAllRead = fn(async () => undefined)
export const OpeningTheBellArmsNothing: Story = {
  args: {
    notificationFns: makeStatefulNotificationFns(notificationFixtures, {
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
    const { needsYou } = await bellLists(popover)
    await waitFor(() => expect(needsYou).toHaveFocus())
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{Enter}')

    expect(armedMarkAllRead).not.toHaveBeenCalled()
    expect(canvas.getByRole('button', { name: counted })).toBeInTheDocument()
  },
}

/** Two requests of the reader, and an unread update: all three wait on them. */
const waitingFeed = [
  makeNotification({
    id: '60000000-0000-4000-8000-000000000001',
    type: 'inbox.escalated',
    priority: 'urgent',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 2 * MINUTE),
  }),
  makeNotification({
    id: '60000000-0000-4000-8000-000000000002',
    type: 'feedback.created',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites', platform: 'portal' },
    createdAt: new Date(Date.now() - 3 * MINUTE),
  }),
  makeNotification({
    id: '60000000-0000-4000-8000-000000000003',
    type: 'reply.published',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - 4 * MINUTE),
  }),
]
const waitingServer = makeStatefulNotificationFns(waitingFeed)
const markEverythingRead = fn(waitingServer.markAllRead)

/**
 * "Mark all read" in the bell marks what the bell shows: both lists. It sends
 * `all`, so the unread update is read as well as what needed the reader, and
 * the badge clears. (The page's tabs keep their own scope.)
 */
export const MarkAllReadCoversBothLists: Story = {
  args: {
    notificationFns: {
      ...waitingServer,
      markAllRead: markEverythingRead as unknown as NotificationServerFns['markAllRead'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const popover = await openBell(canvasElement)
    const updates = await popover.findByRole('region', { name: 'Updates' })
    await waitFor(() => expect(idsIn(updates)).toEqual([waitingFeed[2]!.id]))
    await userEvent.click(popover.getByRole('button', { name: /mark all read/i }))

    expect(markEverythingRead).toHaveBeenCalledWith({ data: { filter: 'all' } })
    await canvas.findByRole('button', { name: 'Notifications' })
    expect(popover.queryByRole('button', { name: /mark all read/i })).toBeNull()
    expect(await popover.findByText('Nothing needs you right now')).toBeInTheDocument()
    // Read now, all three are updates, and none is unread.
    await waitFor(() =>
      expect(
        within(popover.getByRole('region', { name: 'Updates' }))
          .getAllByRole('listitem')
          .map((row) => row.dataset.notificationState),
      ).toEqual(['read', 'read', 'read']),
    )
  },
}

type HeadRead = Parameters<NotificationServerFns['getFeedHead']>[0]
const slowUpdatesServer = makeStatefulNotificationFns(notificationFixtures)

/**
 * The badge is the Needs-you head's count, so the Updates read the open bell
 * starts must not blank it, or tell a screen reader that nothing needs them,
 * while it is in flight.
 */
export const UpdatesLoadingKeepsTheCount: Story = {
  args: {
    notificationFns: {
      ...slowUpdatesServer,
      getFeedHead: ((input: HeadRead) =>
        input.data.filter === 'updates'
          ? Promise.withResolvers<never>().promise
          : slowUpdatesServer.getFeedHead(
              input,
            )) as unknown as NotificationServerFns['getFeedHead'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: counted }))
    const popover = await findOpenBellPopover()
    const { updates } = await bellLists(popover)
    expect(await within(updates).findByText('Loading notifications…')).toBeInTheDocument()
    expect(idsIn(popover.getByRole('region', { name: 'Needs you' }))).toHaveLength(
      needsYouCount,
    )
    expect(canvas.getByRole('button', { name: counted })).toBeInTheDocument()
    expect(
      canvas.getByText(`${needsYouCount} notifications need you`),
    ).toBeInTheDocument()
    expect(canvas.queryByText('Nothing needs you')).toBeNull()
  },
}

/** Four kinds of request, none of which stack: each is a row of its own. */
const TALL_FEED_TYPES = [
  'inbox.escalated',
  'reply.pending_approval',
  'inbox.response_target_halfway',
  'portal.health_attention',
  // Settled upstream: unread, but done.
  'reply.pending_approval',
  'reply.published',
  'reply.approved',
  'inbox.assigned',
  'goal.completed',
  'inbox.escalation_resolved',
] as const

/**
 * Ten rows: taller than a landscape phone, so the lists have to scroll. Four
 * need the reader; six are updates — one settled upstream (still unread, but
 * done) and five read — so the metrics can tell the unread dot from its
 * absence.
 */
const tallFeed = TALL_FEED_TYPES.map((type, n) =>
  makeNotification({
    id: `50000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
    type,
    status: n <= 4 ? 'unread' : 'read',
    resolvedAt: n === 4 ? new Date(Date.now() - MINUTE) : null,
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites', platform: 'google' },
    createdAt: new Date(Date.now() - (n + 1) * 7 * MINUTE),
  }),
)

/**
 * The bell where the app puts it, at the right end of the top bar, on a phone,
 * where it opens a full-screen sheet (D8); the metrics file also opens this
 * story on a desktop-sized page, where it is the popover. Geometry is measured
 * against compiled Tailwind by
 * e2e/storybook-metrics/notification-popover.metrics.ts; this runner compiles
 * none, so its play only opens the bell.
 */
export const PhoneTopBar: Story = {
  args: { notificationFns: makeStatefulNotificationFns(tallFeed) },
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

/**
 * More requests than the bell's page of 20, so Needs you offers "Load more".
 * Escalations never stack, so each stays a row.
 */
const pagedFeed = Array.from({ length: 25 }, (_, n) =>
  makeNotification({
    id: `63000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
    type: 'inbox.escalated',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites' },
    createdAt: new Date(Date.now() - (n + 1) * MINUTE),
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
    notificationFns: makeStatefulNotificationFns(pagedFeed, {
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
    const { needsYou } = await bellLists(popover)
    await waitFor(() => expect(needsYou).toHaveFocus())
  },
}

/** Reads that never settle → the lists hold their skeletons, the badge stays absent. */
export const Loading: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: heldOpen<'getFeedHead'>(),
    }),
  },
}

/** The feed head rejects → each list says so, with its own Retry. */
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
    expect(await portal.findAllByRole('button', { name: /retry/i })).toHaveLength(2)
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
      (await popover.findAllByRole('link', { name: 'Sign in again' })).length,
    ).toBeGreaterThan(0)
    expect(popover.queryByRole('button', { name: /retry/i })).toBeNull()
  },
}

/** Nothing at all: each list is one quiet line, and nothing is offered to mark. */
export const Empty: Story = {
  args: { notificationFns: makeNotificationFns() },
  play: async ({ canvasElement }) => {
    const portal = await openBell(canvasElement)
    expect(await portal.findByText('Nothing needs you right now')).toBeInTheDocument()
    expect(await portal.findByText('No updates yet')).toBeInTheDocument()
    expect(portal.queryByRole('button', { name: /mark all read/i })).toBeNull()
  },
}

/**
 * Two Harbour notices of the workflow category — an assignment that needs the
 * reader and a note under Updates — and a Riverside assignment a Harbour mute
 * must keep. (A new review is an arrival, its own category, since D4.)
 */
const muteFeed = [
  makeNotification({
    id: '40000000-0000-4000-8000-000000000001',
    type: 'inbox.assigned',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites', platform: 'google' },
    createdAt: new Date(Date.now() - MINUTE),
  }),
  makeNotification({
    id: '40000000-0000-4000-8000-000000000002',
    type: 'inbox.assigned',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - 2 * MINUTE),
  }),
  makeNotification({
    id: '40000000-0000-4000-8000-000000000003',
    type: 'inbox_note.added',
    status: 'read',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites', platform: 'google' },
    createdAt: new Date(Date.now() - 3 * MINUTE),
  }),
]

const MUTE_ITEM = 'Mute workflow and collaboration for this property'
const MUTE_CONFIRMATION =
  'In-app workflow and collaboration notices muted for Harbour View Suites, including earlier ones.'

/**
 * Muting sends only the semantic command, takes that Property's rows of the
 * category out of both lists at once (the server hides them from now on,
 * earlier ones included), and says so where a sighted user can see it.
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
      portal.getByRole('link', { name: /^Assigned to you: review at Riverside Hotel,/ }),
    ).toBeInTheDocument()
    expect(portal.getByText('No updates yet')).toBeInTheDocument()
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
    notificationFns: makeStatefulNotificationFns(notificationFixtures, {
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
    await canvas.findByRole('button', { name: 'Notifications, 1 needs you' })

    await userEvent.click(await findToastUndo(MUTE_CONFIRMATION))
    await waitFor(() =>
      expect(undoMuteInApp).toHaveBeenCalledWith({
        data: { propertyId: HARBOUR, category: 'workflow_collaboration', previous: null },
      }),
    )
    await expectToast('Mute undone.')
    await canvas.findByRole('button', { name: 'Notifications, 2 need you' })

    // The press on the toast was not a press outside the bell: it stays open,
    // and the rows come back where the reader is looking.
    await waitFor(() =>
      expect(
        popover.getAllByRole('listitem').map((row) => row.dataset.notificationId),
      ).toEqual(muteFeed.map((row) => row.id)),
    )
  },
}

/** A review that needs the reader, and an unread note under Updates. */
const undoableFeed = [
  makeNotification({
    id: '64000000-0000-4000-8000-000000000001',
    type: 'review.created',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
    createdAt: new Date(Date.now() - MINUTE),
  }),
  makeNotification({
    id: '64000000-0000-4000-8000-000000000002',
    type: 'inbox_note.added',
    propertyId: HARBOUR,
    payload: { propertyName: 'Harbour View Suites' },
    createdAt: new Date(Date.now() - 2 * MINUTE),
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
    // The note is still unread, but nothing needs the reader now.
    await canvas.findByRole('button', { name: 'Notifications' })

    await userEvent.click(await findToastUndo('Notification dismissed.'))
    await waitFor(() =>
      expect(restoreDismissed).toHaveBeenCalledWith({
        data: { notificationId: undoableFeed[0]!.id },
      }),
    )
    await expectToast('Notification restored.')
    await canvas.findByRole('button', { name: 'Notifications, 1 needs you' })

    // The bell stayed open under the toast, and the row is back in it, unread.
    const restored = await popover.findByRole('link', {
      name: /^New review at Riverside Hotel, .*, unread$/,
    })
    expect(restored.closest('li')).toHaveAttribute('data-notification-state', 'unread')
    expect(popover.getAllByRole('listitem')).toHaveLength(before)
  },
}

const phoneSheetServer = makeStatefulNotificationFns(undoableFeed)

/**
 * On a phone the bell is a full-screen sheet, named by its visible title (D8).
 * It is not modal, like the popover: a modal dialog would set
 * `pointer-events: none` on the page, and the Undo a dismissal offers — in a
 * toast, outside the sheet — could not be pressed. Close hands focus back to
 * the bell.
 */
export const PhoneOpensAFullScreenSheet: Story = {
  args: { notificationFns: phoneSheetServer },
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobileNarrow' } },
  render: (args) => (
    <header className="flex h-12 items-center justify-end border-b px-2">
      <NotificationPanel {...args} />
    </header>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sheet = await openBell(canvasElement)
    expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    within(document.body).getByRole('dialog', { name: 'Notifications' })
    await waitFor(() =>
      expect(sheet.getByRole('group', { name: 'Needs you' })).toHaveFocus(),
    )

    const before = await dismissFirstRow(sheet)
    await waitFor(() => expect(sheet.getAllByRole('listitem')).toHaveLength(before - 1))
    await userEvent.click(await findToastUndo('Notification dismissed.'))
    await expectToast('Notification restored.')
    await waitFor(() => expect(sheet.getAllByRole('listitem')).toHaveLength(before))

    await userEvent.click(sheet.getByRole('button', { name: 'Close notifications' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    expect(canvas.getByRole('button', { name: /^Notifications/ })).toHaveFocus()
  },
}

/** Three new reviews at one Property, and an escalation elsewhere. */
const reviewStackFeed = [
  ...[2, 4, 6].map((minutes, n) =>
    makeNotification({
      id: `67000000-0000-4000-8000-00000000000${n + 1}`,
      type: 'review.created',
      propertyId: HARBOUR,
      payload: { propertyName: 'Harbour View Suites', platform: 'google' },
      createdAt: new Date(Date.now() - minutes * MINUTE),
    }),
  ),
  makeNotification({
    id: '67000000-0000-4000-8000-000000000004',
    type: 'inbox.escalated',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel' },
    createdAt: new Date(Date.now() - 8 * MINUTE),
  }),
]
const reviewIds = reviewStackFeed.slice(0, 3).map((row) => row.id)
const stackServer = makeStatefulNotificationFns(reviewStackFeed)
const dismissEach = fn(stackServer.dismiss)
const restoreEach = fn(stackServer.restore)
const STACK_NAME =
  /^3 new reviews at Harbour View Suites, latest \d+ minutes? ago, 3 unread$/

/**
 * Three new reviews at one Property read as one row that opens that
 * Property's reply queue. Its menu acts on all three: "Dismiss all 3" takes
 * them out together, says so in one toast, and that toast's one Undo brings
 * all three back.
 */
export const StackDismissAllOffersUndo: Story = {
  args: {
    notificationFns: {
      ...stackServer,
      dismiss: dismissEach as unknown as NotificationServerFns['dismiss'],
      restore: restoreEach as unknown as NotificationServerFns['restore'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const popover = await openBell(canvasElement)
    const needsYou = await popover.findByRole('region', { name: 'Needs you' })
    await waitFor(() => expect(within(needsYou).getAllByRole('listitem')).toHaveLength(2))

    const stack = within(needsYou).getByRole('link', { name: STACK_NAME })
    const row = stack.closest('li')!
    expect(row).toHaveAttribute('data-notification-stack', '3')
    expect(row).toHaveAttribute('data-notification-id', reviewIds[0])
    expect(within(row).getByText('3 new reviews')).toBeInTheDocument()
    expect(within(row).getByText('Harbour View Suites')).toBeInTheDocument()
    const href = new URL(stack.getAttribute('href') ?? '', 'https://repkey.test')
    expect(href.pathname).toBe('/inbox')
    expect(href.searchParams.get('queue')).toBe('reply')
    expect(href.searchParams.get('propertyId')).toBe(HARBOUR)

    await userEvent.click(
      within(row).getByRole('button', { name: /^More actions for: 3 new reviews / }),
    )
    const menu = within(document.body)
    await menu.findByRole('menuitem', { name: 'Mark all as read' })
    await userEvent.click(menu.getByRole('menuitem', { name: 'Dismiss all 3' }))

    await waitFor(() =>
      expect(popover.queryByRole('link', { name: STACK_NAME })).toBeNull(),
    )
    expect(dismissEach).toHaveBeenCalledTimes(3)
    for (const notificationId of reviewIds) {
      expect(dismissEach).toHaveBeenCalledWith({ data: { notificationId } })
    }
    await canvas.findByRole('button', { name: 'Notifications, 1 needs you' })

    const undo = await findToastUndo('3 notifications dismissed.')
    expect(within(document.body).getAllByText(/notifications? dismissed\./)).toHaveLength(
      1,
    )
    await userEvent.click(undo)
    await waitFor(() => expect(restoreEach).toHaveBeenCalledTimes(3))
    for (const notificationId of reviewIds) {
      expect(restoreEach).toHaveBeenCalledWith({ data: { notificationId } })
    }
    await expectToast('3 notifications restored.')
    await canvas.findByRole('button', { name: 'Notifications, 4 need you' })
    // The bell stayed open under the toast, and the stack is back in it.
    expect(await popover.findByRole('link', { name: STACK_NAME })).toBeInTheDocument()
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
    notificationFns: makeStatefulNotificationFns(notificationFixtures, {
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

/**
 * Already listed when the page loads: calm work, and an escalation that is
 * urgent — so "nothing listed at load toasts" can fail. Then an escalation
 * arrives.
 */
const calmRequest = makeNotification({
  id: '71000000-0000-4000-8000-000000000001',
  type: 'inbox.assigned',
  priority: 'normal',
  payload: { propertyName: 'Harbour View Suites' },
  createdAt: new Date(Date.now() - 10 * MINUTE),
})
const listedEscalation = makeNotification({
  id: '71000000-0000-4000-8000-000000000003',
  type: 'inbox.escalated',
  priority: 'urgent',
  payload: { propertyName: 'Harbour View Suites', platform: 'portal' },
  createdAt: new Date(Date.now() - 30 * MINUTE),
})
const arrivingEscalation = makeNotification({
  id: '71000000-0000-4000-8000-000000000002',
  type: 'inbox.escalated',
  priority: 'urgent',
  payload: { propertyName: 'Riverside Hotel', platform: 'portal' },
  createdAt: new Date(),
})
let escalationArrived = false
const readArrivingHead = fn(async ({ data }: Readonly<{ data: { filter?: string } }>) =>
  notificationFeedHeadFixture(
    data.filter === 'needs_you'
      ? escalationArrived
        ? [arrivingEscalation, calmRequest, listedEscalation]
        : [calmRequest, listedEscalation]
      : [],
  ),
)

/** Lets sonner render anything it was asked to: it mounts toasts a task later. */
const toastsSettled = () => new Promise((resolve) => setTimeout(resolve, 50))

/**
 * Something urgent arriving while the bell is closed says so (D9): the badge
 * moving by one was the only sign. What was listed when the page loaded never
 * toasts, urgent or not; the arrival does, and Open opens the bell on it.
 */
export const UrgentArrivalShowsAToast: Story = {
  args: {
    notificationFns: makeNotificationFns({
      getFeedHead: readArrivingHead as unknown as NotificationServerFns['getFeedHead'],
    }),
  },
  // Reset before render, so a replay starts from the page-load feed too.
  beforeEach: () => {
    escalationArrived = false
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Notifications, 2 need you' })
    await toastsSettled()
    expect(document.querySelector('[data-sonner-toast]')).toBeNull()

    escalationArrived = true
    // The tab coming back into view reads the head again, as a poll would.
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await canvas.findByRole('button', { name: 'Notifications, 3 need you' })

    const shown = (
      await expectToast('Something urgent needs you at Riverside Hotel')
    ).closest<HTMLElement>('[data-sonner-toast]')
    if (shown === null) throw new Error('the arrival is not in a toast')
    await userEvent.click(within(shown).getByRole('button', { name: 'Open' }))
    const popover = await findOpenBellPopover()
    await popover.findByRole('link', { name: /^Escalated: feedback at Riverside Hotel,/ })
  },
}
