import { useViewportBelow } from '#/components/hooks/use-viewport-below'
import { useSidebarIfPresent } from '#/components/ui/sidebar'

// 224 px queue rail + 320 px list + 6 px separator + 472 px detail. This is the
// room the three panes need: the width of the page beside the app sidebar, not
// of the window. Below it the strip/sheet composition is the only one that can
// honor every panel's minimum width without horizontal overflow.
const INBOX_INSET_MIN_WIDTH = 1022

// The app sidebar's two desktop widths (ui/sidebar.tsx: 16rem and 3rem).
const SIDEBAR_EXPANDED_WIDTH = 256
const SIDEBAR_RAIL_WIDTH = 48

type SidebarSpace = Readonly<{ isMobile: boolean; open: boolean }>

/**
 * How much of the window the app sidebar takes. A phone's sidebar is a sheet
 * over the page, so it takes none. Without a shell around the Inbox (Storybook,
 * tests) the rail is assumed, which is what the Inbox's own route has always
 * had.
 */
export function sidebarWidthPx(sidebar: SidebarSpace | null): number {
  if (!sidebar) return SIDEBAR_RAIL_WIDTH
  if (sidebar.isMobile) return 0
  return sidebar.open ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH
}

export function inboxUsesCompactLayout(
  viewportWidth: number,
  sidebarWidth: number,
): boolean {
  return viewportWidth < INBOX_INSET_MIN_WIDTH + sidebarWidth
}

/**
 * Whether the Inbox is too narrow for three panes. The floor follows the room
 * the sidebar leaves, so an open sidebar at 1280 px still gets three panes and
 * a rail at 1100 px does not overflow.
 */
export function useInboxCompactLayout(): boolean {
  const sidebar = useSidebarIfPresent()
  return useViewportBelow(INBOX_INSET_MIN_WIDTH + sidebarWidthPx(sidebar))
}
