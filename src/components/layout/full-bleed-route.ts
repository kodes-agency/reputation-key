// Whether a pathname is a full-bleed surface: one that owns its viewport below the
// top bar and scrolls its own panes (the Inbox, a Property's Reviews, the portal
// workspace). The authenticated shell (drops the `<main>` gutter, holds the sidebar
// at the icon rail) and the Property layout (gives the child full height) both ask
// this; nothing else decides. A padded body inside one wraps in `FullBleedFrame`.

import { isWorkspaceRoute } from '#/components/features/portal/portal-workspace/portal-workspace-route'

const INBOX_PATH = /^\/inbox(?:\/|$)/u
const PROPERTY_REVIEWS_PATH = /^\/properties\/[^/]+\/reviews(?:\/|$)/u

export function isFullBleedRoute(pathname: string | undefined): boolean {
  if (pathname === undefined) return false
  return (
    INBOX_PATH.test(pathname) ||
    PROPERTY_REVIEWS_PATH.test(pathname) ||
    isWorkspaceRoute(pathname)
  )
}
