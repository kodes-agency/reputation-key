// Storybook stories for AppTopBar — the authenticated header bar.
// AppTopBar renders the sidebar trigger, the notification bell (with an unread
// count badge fed by NotificationPanel), and the signed-in user's avatar/menu.
// Stateful: useThemeMode() reads the persisted theme on mount and the menu
// cycles light/dark/auto; the sign-out item calls authClient.signOut() on click.
//
// notificationFns is a prop bundle (Phase-1 fn-as-prop channel). Each entry is
// wrapped by useAction(useServerFn(...)) inside the notification hooks, so the
// story feeds plain callables cast to each fn brand — the same pattern every
// notification/inbox story uses. No value import from #/contexts/*/server/**.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { SidebarProvider, SidebarInset } from '#/components/ui/sidebar'
import type { NotificationServerFns } from '#/components/features/notification/types'
import { AppTopBar } from './app-top-bar'

// Build a notification-fn bundle from a desired unread count. getList returns
// an empty array so the panel (mounted on open) renders its empty state
// gracefully; the mutation fns are inert.
function makeNotificationFns(count: number): NotificationServerFns {
  return {
    getUnreadCount: (async () => ({
      count,
    })) as unknown as NotificationServerFns['getUnreadCount'],
    getList: (async () => []) as unknown as NotificationServerFns['getList'],
    markRead: (async () => undefined) as unknown as NotificationServerFns['markRead'],
    markAllRead: (async () =>
      undefined) as unknown as NotificationServerFns['markAllRead'],
    dismiss: (async () => undefined) as unknown as NotificationServerFns['dismiss'],
    dismissAll: (async () => undefined) as unknown as NotificationServerFns['dismissAll'],
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
