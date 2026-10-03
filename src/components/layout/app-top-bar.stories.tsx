// Storybook stories for AppTopBar — the authenticated header bar.
// AppTopBar renders the sidebar trigger, the notification bell (with an unread
// count badge fed by NotificationPanel), and the signed-in user's avatar/menu.
// Stateful: useThemeMode() reads the persisted theme on mount and the menu holds
// the Light / Dark / System control; the sign-out item calls authClient.signOut()
// on click.
//
// notificationFns is a prop bundle (Phase-1 fn-as-prop channel). Each entry is
// wrapped by useAction(useServerFn(...)) inside the notification hooks, so the
// story feeds plain callables cast to each fn brand — the same pattern every
// notification/inbox story uses. No value import from #/contexts/*/server/**.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { SidebarProvider, SidebarInset } from '#/components/ui/sidebar'
import type { NotificationServerFns } from '#/components/features/notification/types'
import { AppTopBar } from './app-top-bar'

// Build a notification-fn bundle from a desired unread count. getList returns
// an empty page so the panel (mounted on open) renders its empty state
// gracefully; the mutation fns are inert. User settings are pulled only when
// the panel opens so timestamps can use the persisted locale and timezone.
function makeNotificationFns(count: number): NotificationServerFns {
  const inert = <K extends keyof NotificationServerFns>(
    result: unknown,
  ): NotificationServerFns[K] =>
    (async () => result) as unknown as NotificationServerFns[K]

  return {
    getFeedHead: inert<'getFeedHead'>({
      page: { notifications: [], hasMore: false, nextCursor: null },
      unreadCount: count,
      filterUnreadCount: count,
      watermark: 'app-top-bar-story',
    }),
    getList: inert<'getList'>({ notifications: [], hasMore: false, nextCursor: null }),
    markRead: inert<'markRead'>(undefined),
    markUnread: inert<'markUnread'>(undefined),
    markAllRead: inert<'markAllRead'>(undefined),
    dismiss: inert<'dismiss'>(undefined),
    dismissAll: inert<'dismissAll'>(undefined),
    muteCategory: inert<'muteCategory'>({ previous: null }),
    restore: inert<'restore'>(null),
    undoMuteCategory: inert<'undoMuteCategory'>(undefined),
    getUserSettings: inert<'getUserSettings'>(null),
  }
}

const user = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  image: null,
}

const meta: Meta<typeof AppTopBar> = {
  title: 'Layout/AppTopBar',
  component: AppTopBar,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <SidebarProvider>
        <SidebarInset>
          <Story />
        </SidebarInset>
      </SidebarProvider>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof AppTopBar>

// Default: no avatar image → initials fallback, unread count of 3 → badge.
export const Default: Story = {
  args: { user, notificationFns: makeNotificationFns(3) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // User menu trigger shows the initials fallback (image is null).
    expect(await canvas.findByText(/^al$/i)).toBeInTheDocument()
    // Every other page keeps its 52 px bar: only the inbox shrinks it to 44 px.
    // A class pin: the real check is `inbox-phone-chrome.metrics.ts` ("app top bar").
    const bar = canvasElement.querySelector('header')
    expect(bar).toHaveClass('h-13')
    expect(bar).not.toHaveClass('max-md:h-11')
  },
}

// Avatar image supplied → the <img> renders instead of the initials block.
export const WithAvatarImage: Story = {
  args: {
    user: { ...user, image: 'https://placehold.co/64?text=avatar' },
    notificationFns: makeNotificationFns(3),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The avatar <img> uses alt="" (decorative), so it has no role="img" in
    // the accessibility tree — query the element directly and assert its src.
    const avatar = await canvas.findByAltText('')
    expect(avatar).toHaveAttribute('src', 'https://placehold.co/64?text=avatar')
  },
}

// Zero unread → no count badge on the bell.
export const NoNotifications: Story = {
  args: { user, notificationFns: makeNotificationFns(0) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Bell trigger still renders; no count badge.
    expect(
      await canvas.findByRole('button', { name: /notification/i }),
    ).toBeInTheDocument()
  },
}

// Inbox routes hold the desktop sidebar in icon mode. The trigger remains for
// the phone sheet, but disappears once the desktop navigation is visible.
export const SidebarLocked: Story = {
  args: {
    user,
    notificationFns: makeNotificationFns(0),
    sidebarLocked: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = await canvas.findByRole('button', { name: /toggle sidebar/i })
    expect(trigger).toHaveClass('md:hidden')
    // Phone grid: a 44 px bar, a 36 px trigger whose glyph (not its box) lands
    // on the 16 px gutter, and the 28 px avatar's right edge on the gutter.
    // Tailwind is not compiled in this runner, so the geometry itself is the
    // Playwright metrics gate's; this pins the classes that produce it. The
    // real check is `inbox-phone-chrome.metrics.ts` ("app top bar").
    expect(canvasElement.querySelector('header')).toHaveClass('max-md:h-11')
    expect(trigger).toHaveClass('max-md:size-9', 'max-md:-ml-2.5')
    expect(canvas.getByRole('button', { name: 'Account menu' })).toHaveClass(
      'max-md:size-9',
      'max-md:-mr-1',
    )
  },
}

// The account menu holds the theme control: Light, Dark, System (the order
// Preferences uses), reachable with the menu's own arrow keys. Choosing leaves
// the menu open and writes the choice where the page reads it.
export const ThemeInTheAccountMenu: Story = {
  args: { user, notificationFns: makeNotificationFns(0) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    const trigger = await canvas.findByRole('button', { name: 'Account menu' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')

    const group = await page.findByRole('group', { name: 'Theme' })
    expect(
      within(group)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['Light', 'Dark', 'System'])

    // Opened from the keyboard, the menu focuses its first item: the Light
    // segment. Arrow Down steps to the next segment.
    expect(page.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeChecked()
    expect(window.localStorage.getItem('theme')).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(page.getByRole('menu')).toBeVisible()
    // Sign out is still the last item, after the three segments.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus()
  },
}
